// klick-capture — native screen recorder. Klick spawns this binary because
// Chromium's getDisplayMedia path won't reliably exclude the OS cursor on
// macOS; SCStreamConfiguration.showsCursor = false here does.
//
// Subcommands:
//   klick-capture list                                 → JSON of sources
//   klick-capture record --source <id> --output <path> → record until SIGTERM
//                       [--fps <n>]
//
// Source ids: "display:<displayID>" or "window:<windowID>". macOS 13+.

import Foundation
import AppKit
import ScreenCaptureKit
import AVFoundation
import CoreMedia
import CoreVideo
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// Initialise AppKit's connection to the window server. Touching
// NSApplication.shared triggers [NSApplication sharedApplication] which
// boots the connection — without it CG calls into the window-server-aware
// paths can hit `Assertion failed: did_initialize` in CGS.
_ = NSApplication.shared

// MARK: - JSON output

struct SourceInfo: Codable {
    let id: String
    let kind: String  // "display" or "window"
    let name: String
    let width: Int
    let height: Int
    // data:image/png;base64,...  Empty when the snapshot couldn't be
    // captured (e.g. window closed mid-enumeration).
    let thumbnail: String
}

// MARK: - CLI entry

func die(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

func parseArgs() -> (String, [String: String]) {
    let argv = CommandLine.arguments
    if argv.count < 2 { die("usage: klick-capture <list|record> [args]") }
    let cmd = argv[1]
    var flags: [String: String] = [:]
    var i = 2
    while i < argv.count {
        let a = argv[i]
        guard a.hasPrefix("--") else { die("unexpected positional arg: \(a)") }
        let key = String(a.dropFirst(2))
        if i + 1 >= argv.count { die("missing value for --\(key)") }
        flags[key] = argv[i + 1]
        i += 2
    }
    return (cmd, flags)
}

let (cmd, flags) = parseArgs()

// MARK: - thumbnails

// Thumbnails via the older sync Core Graphics APIs (~10ms each) rather than
// SCScreenshotManager — that one's async per-source and macOS 14+ only.
// The deprecation warnings are noise; the calls still work on every macOS
// version Klick targets.

func resize(_ image: CGImage, maxW: Int = 320, maxH: Int = 200) -> CGImage {
    let srcW = image.width
    let srcH = image.height
    if srcW <= maxW && srcH <= maxH { return image }
    let scale = min(Double(maxW) / Double(srcW), Double(maxH) / Double(srcH))
    let w = max(1, Int(Double(srcW) * scale))
    let h = max(1, Int(Double(srcH) * scale))
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(
        data: nil, width: w, height: h,
        bitsPerComponent: 8, bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue,
    ) else { return image }
    ctx.interpolationQuality = .medium
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    return ctx.makeImage() ?? image
}

func encodeAsBase64PNG(_ image: CGImage) -> String {
    let data = NSMutableData()
    let type = UTType.png.identifier as CFString
    guard let dest = CGImageDestinationCreateWithData(data, type, 1, nil) else { return "" }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { return "" }
    return "data:image/png;base64," + (data as Data).base64EncodedString()
}

func displayThumbnail(displayID: CGDirectDisplayID) -> String {
    guard let raw = CGDisplayCreateImage(displayID) else { return "" }
    return encodeAsBase64PNG(resize(raw))
}

func windowThumbnail(windowID: CGWindowID) -> String {
    guard let raw = CGWindowListCreateImage(.null, .optionIncludingWindow, windowID, [.bestResolution]) else { return "" }
    return encodeAsBase64PNG(resize(raw))
}

// Backing scale factor for the main display, derived via Core Graphics so
// the call works in a CLI context without an NSApplication run loop.
func mainDisplayBackingScale() -> Double {
    let displayID = CGMainDisplayID()
    guard let mode = CGDisplayCopyDisplayMode(displayID) else { return 2.0 }
    let pointW = mode.width
    let pixelW = mode.pixelWidth
    guard pointW > 0 else { return 2.0 }
    return Double(pixelW) / Double(pointW)
}

// MARK: - list

func listSources() async {
    let content: SCShareableContent
    do {
        // Don't include desktop windows (icons, the menu bar pseudo-windows); do
        // restrict to on-screen windows so we don't list every minimised app.
        content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
    } catch {
        die("SCShareableContent failed: \(error.localizedDescription)")
    }

    var sources: [SourceInfo] = []
    for d in content.displays {
        sources.append(.init(
            id: "display:\(d.displayID)",
            kind: "display",
            name: "Display \(d.displayID) (\(d.width)×\(d.height))",
            width: d.width,
            height: d.height,
            thumbnail: displayThumbnail(displayID: d.displayID),
        ))
    }
    for w in content.windows {
        guard let app = w.owningApplication else { continue }
        // Skip our own helper windows and any zero-size oddities.
        if app.bundleIdentifier == Bundle.main.bundleIdentifier { continue }
        if w.frame.width < 50 || w.frame.height < 50 { continue }
        let title = (w.title?.isEmpty == false) ? w.title! : app.applicationName
        sources.append(.init(
            id: "window:\(w.windowID)",
            kind: "window",
            name: "\(app.applicationName) — \(title)",
            width: Int(w.frame.width),
            height: Int(w.frame.height),
            thumbnail: windowThumbnail(windowID: w.windowID),
        ))
    }

    let data: Data
    do { data = try JSONEncoder().encode(sources) }
    catch { die("JSON encode failed: \(error.localizedDescription)") }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

// MARK: - record

// SCKit only emits frames when the screen content changes — efficient but
// gives QuickTime / VLC / scrubbers a VFR file they don't handle well. Fix:
// a dispatch timer pumps the *most recent* pixel buffer into an
// AVAssetWriterInputPixelBufferAdaptor at the configured fps. SCK callbacks
// just refresh the latched buffer; the timer writes whatever's current
// with a wall-clock-derived PTS. Static content becomes duplicate frames
// (h.264 stores those as ~16-byte P-frames, file size barely changes) and
// the output mp4 is true CFR.
final class CaptureSink: NSObject, SCStreamOutput, SCStreamDelegate {
    let writer: AVAssetWriter
    let videoInput: AVAssetWriterInput
    let adaptor: AVAssetWriterInputPixelBufferAdaptor
    let fps: Int

    private var lastBuffer: CVPixelBuffer?
    private var startedAt: Date?
    private var pumpTimer: DispatchSourceTimer?
    private var started = false
    private let lock = NSLock()

    init(writer: AVAssetWriter, videoInput: AVAssetWriterInput, fps: Int, width: Int, height: Int) {
        self.writer = writer
        self.videoInput = videoInput
        self.fps = fps
        let attrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
        ]
        self.adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: videoInput,
            sourcePixelBufferAttributes: attrs,
        )
        super.init()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid else { return }
        // .complete and .idle samples both carry pixel data — .idle just
        // re-sends the previous frame because nothing changed, which our
        // latched-buffer model handles transparently.
        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        var startPump = false
        var firstFrameMs: Int64? = nil
        lock.lock()
        lastBuffer = imageBuffer
        if !started {
            writer.startWriting()
            writer.startSession(atSourceTime: .zero)
            startedAt = Date()
            started = true
            startPump = true
            firstFrameMs = Int64(startedAt!.timeIntervalSince1970 * 1000)
        }
        lock.unlock()
        // First-frame wall-clock so Electron can align uiohook event
        // timestamps to the video timeline (uiohook starts ~200ms before
        // SCStream emits its first sample, which otherwise leaves the
        // rendered cursor lagging the actual cursor in the recording).
        if let ms = firstFrameMs {
            FileHandle.standardOutput.write(Data("first-frame \(ms)\n".utf8))
        }
        if startPump { startPumpTimer() }
    }

    private func startPumpTimer() {
        let interval = DispatchTimeInterval.nanoseconds(1_000_000_000 / fps)
        let q = DispatchQueue(label: "klick.frame-pump", qos: .userInteractive)
        let timer = DispatchSource.makeTimerSource(queue: q)
        timer.schedule(deadline: .now(), repeating: interval, leeway: .nanoseconds(1_000_000))
        timer.setEventHandler { [weak self] in self?.pumpFrame() }
        timer.resume()
        pumpTimer = timer
    }

    private func pumpFrame() {
        lock.lock()
        let buf = lastBuffer
        let t0 = startedAt
        lock.unlock()
        guard let pixelBuffer = buf, let startTime = t0 else { return }
        guard videoInput.isReadyForMoreMediaData else { return }

        // PTS from wall-clock elapsed (not a frame counter) so timer jitter
        // self-corrects against real time — playback rate always matches
        // what actually happened on screen.
        let elapsed = max(0, Date().timeIntervalSince(startTime))
        let pts = CMTime(seconds: elapsed, preferredTimescale: 600)
        adaptor.append(pixelBuffer, withPresentationTime: pts)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        FileHandle.standardError.write(Data("stream stopped with error: \(error.localizedDescription)\n".utf8))
    }

    func finish() async {
        pumpTimer?.cancel()
        pumpTimer = nil
        lock.lock(); let didStart = started; lock.unlock()
        guard didStart else { return }
        videoInput.markAsFinished()
        await writer.finishWriting()
    }
}

func recordCommand(flags: [String: String]) async {
    guard let sourceID = flags["source"] else { die("--source required") }
    guard let outputPath = flags["output"] else { die("--output required") }
    let fps = Int(flags["fps"] ?? "60") ?? 60

    let content: SCShareableContent
    do {
        content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
    } catch {
        die("SCShareableContent failed: \(error.localizedDescription)")
    }

    // Resolve "<kind>:<id>" to a real SCContentFilter. Capture dimensions
    // come from the source itself — for a display that's its native size,
    // for a window the window's current frame.
    let filter: SCContentFilter
    let outWidth: Int
    let outHeight: Int
    // Geometry of the capture region in the global screen-points coordinate
    // system. Emitted to stdout on start so the renderer can translate
    // uiohook click positions (which are in global screen coords) into the
    // captured region's local space.
    let captureOriginX: CGFloat
    let captureOriginY: CGFloat
    let captureWidth: CGFloat
    let captureHeight: CGFloat

    if sourceID.hasPrefix("display:") {
        let raw = String(sourceID.dropFirst("display:".count))
        guard let id = UInt32(raw), let display = content.displays.first(where: { $0.displayID == id }) else {
            die("display not found: \(sourceID)")
        }
        filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        outWidth = display.width
        outHeight = display.height
        captureOriginX = display.frame.origin.x
        captureOriginY = display.frame.origin.y
        captureWidth = display.frame.width
        captureHeight = display.frame.height
    } else if sourceID.hasPrefix("window:") {
        let raw = String(sourceID.dropFirst("window:".count))
        guard let id = UInt32(raw), let window = content.windows.first(where: { $0.windowID == id }) else {
            die("window not found: \(sourceID)")
        }
        filter = SCContentFilter(desktopIndependentWindow: window)
        // SCKit returns window dimensions in points; convert to physical
        // pixels via the main display's backing scale.
        let scale = mainDisplayBackingScale()
        outWidth = Int(window.frame.width * scale)
        outHeight = Int(window.frame.height * scale)
        captureOriginX = window.frame.origin.x
        captureOriginY = window.frame.origin.y
        captureWidth = window.frame.width
        captureHeight = window.frame.height
    } else {
        die("source id must start with 'display:' or 'window:'")
    }

    // h264 needs even dimensions.
    let evenW = outWidth % 2 == 0 ? outWidth : outWidth - 1
    let evenH = outHeight % 2 == 0 ? outHeight : outHeight - 1

    let config = SCStreamConfiguration()
    config.width = evenW
    config.height = evenH
    config.pixelFormat = kCVPixelFormatType_32BGRA
    config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
    config.showsCursor = false  // the whole reason this binary exists
    config.queueDepth = 6
    config.colorSpaceName = CGColorSpace.sRGB

    let url = URL(fileURLWithPath: outputPath)
    try? FileManager.default.removeItem(at: url)
    let writer: AVAssetWriter
    do { writer = try AVAssetWriter(outputURL: url, fileType: .mp4) }
    catch { die("AVAssetWriter init failed: \(error.localizedDescription)") }
    writer.shouldOptimizeForNetworkUse = true

    let videoSettings: [String: Any] = [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: evenW,
        AVVideoHeightKey: evenH,
        AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: 10_000_000,
            AVVideoMaxKeyFrameIntervalKey: fps * 2,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        ],
    ]
    let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
    videoInput.expectsMediaDataInRealTime = true
    if writer.canAdd(videoInput) {
        writer.add(videoInput)
    } else {
        die("AVAssetWriter cannot add video input")
    }

    let sink = CaptureSink(writer: writer, videoInput: videoInput, fps: fps, width: evenW, height: evenH)
    let stream = SCStream(filter: filter, configuration: config, delegate: sink)
    do {
        try stream.addStreamOutput(sink, type: .screen, sampleHandlerQueue: DispatchQueue.global(qos: .userInteractive))
    } catch {
        die("addStreamOutput failed: \(error.localizedDescription)")
    }
    do {
        try await stream.startCapture()
    } catch {
        die("startCapture failed: \(error.localizedDescription)")
    }

    // Tell Electron we're actually recording (not still warming up SCStream).
    // The trailing JSON is the captured region's geometry in global
    // screen-points so the renderer can translate event positions into the
    // captured region's local coordinate space.
    struct StartGeometry: Codable {
        let x: Double
        let y: Double
        let w: Double
        let h: Double
    }
    let geom = StartGeometry(
        x: Double(captureOriginX),
        y: Double(captureOriginY),
        w: Double(captureWidth),
        h: Double(captureHeight),
    )
    let geomBytes = (try? JSONEncoder().encode(geom)) ?? Data("{}".utf8)
    let geomStr = String(data: geomBytes, encoding: .utf8) ?? "{}"
    FileHandle.standardOutput.write(Data("started \(geomStr)\n".utf8))

    // SIGTERM from Electron on stop; SIGINT for interactive ^C.
    let semaphore = DispatchSemaphore(value: 0)
    var stopping = false

    let onStop: @Sendable () -> Void = {
        if stopping { return }
        stopping = true
        Task {
            do { try await stream.stopCapture() }
            catch { FileHandle.standardError.write(Data("stopCapture: \(error.localizedDescription)\n".utf8)) }
            await sink.finish()
            semaphore.signal()
        }
    }

    signal(SIGTERM, SIG_IGN)
    let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    term.setEventHandler(handler: onStop)
    term.resume()
    signal(SIGINT, SIG_IGN)
    let int_ = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
    int_.setEventHandler(handler: onStop)
    int_.resume()

    // Drive the run loop on a background queue and wait on the semaphore
    // from main so we exit only after finishWriting() returns.
    // Drive the run loop on a background queue and block main on the
    // semaphore so we exit only after finishWriting() returns.
    DispatchQueue.global().async {
        RunLoop.main.run()
    }
    semaphore.wait()
}

// MARK: - dispatch

let task = Task {
    switch cmd {
    case "list":
        await listSources()
        exit(0)
    case "record":
        await recordCommand(flags: flags)
        exit(0)
    default:
        die("unknown command: \(cmd)")
    }
}
_ = task

// The Task calls exit(), so this RunLoop never returns. It's just here to
// keep the process alive while the async work runs.
RunLoop.main.run()
