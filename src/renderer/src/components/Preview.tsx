import { useEffect, useRef, useState } from 'react';
import {
  useEditor,
  type Segment,
  type Padding,
  type GlobalZoomConfig,
} from '../store';
import type { EventsObject } from '../../../preload/index';
import { videoRef as sharedVideoRef } from '../hooks/videoRef';
import { cursorAt } from '../lib/cursor';
import { drawOverlayFrame } from '@shared/clickOverlay';

// ~120 ms feels alive without visibly lagging behind the cursor.
const CAMERA_TAU = 0.12;

// Stage tree: padded outer frame → bg panel → clip (overflow:hidden) →
// zoom-wrap (carries the camera transform) → <video> + <canvas> as siblings.
// The overlay canvas sits at the source-video's pixel dimensions and is
// drawn via the shared drawOverlayFrame() that the exporter also uses.

export function Preview() {
  const videoUrl = useEditor((s) => s.videoUrl);
  const videoWidth = useEditor((s) => s.videoWidth);
  const videoHeight = useEditor((s) => s.videoHeight);
  const videoDuration = useEditor((s) => s.videoDuration);
  const background = useEditor((s) => s.background);
  const aspect = useEditor((s) => s.aspect);
  const segments = useEditor((s) => s.segments);
  const events = useEditor((s) => s.events);
  const globalZoom = useEditor((s) => s.globalZoom);
  const cursorSmoothing = useEditor((s) => s.cursorSmoothing);
  const clickAnim = useEditor((s) => s.clickAnimation);
  const cursorCfg = useEditor((s) => s.cursor);
  const setVideoMetadata = useEditor((s) => s.setVideoMetadata);
  const trim = useEditor((s) => s.trim);

  const stageRef = useRef<HTMLDivElement>(null);
  const videoEl = useRef<HTMLVideoElement>(null);
  const clickCanvas = useRef<HTMLCanvasElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [currentTime, setCurrentTime] = useState(0);

  // Eased camera position. We smooth (cx, cy) only — scale is already eased
  // by the segment's own smoothstep window.
  const camera = useRef<{ cx: number; cy: number; lastT: number } | null>(null);
  const [transform, setTransform] = useState('translate(0px, 0px) scale(1)');

  useEffect(() => { sharedVideoRef.current = videoEl.current; });

  useEffect(() => {
    if (!stageRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setStageSize({ w: r.width, h: r.height });
    });
    ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = videoEl.current;
      if (!v) return;
      const t = v.currentTime;
      setCurrentTime(t);

      // Drive trim / cut / speed every RAF tick. The `timeupdate` event only
      // fires at 4–15 Hz which lets the playhead visibly cross a boundary
      // before we react.
      if (!v.paused) {
        if (t >= trim.end) {
          v.pause();
          v.currentTime = trim.end;
          return;
        }
        if (t < trim.start) {
          v.currentTime = trim.start;
          return;
        }
        for (const seg of segments) {
          if (seg.type === 'cut' && t >= seg.start && t < seg.end) {
            v.currentTime = seg.end;
            return;
          }
        }
        const sp = activeSpeed(segments, t);
        if (Math.abs(v.playbackRate - sp) > 0.01) v.playbackRate = sp;
      }

      const target = activeZoom(segments, globalZoom, events, t, videoWidth, videoHeight);
      const now = performance.now() / 1000;
      const cam = camera.current;
      let cx: number, cy: number;
      if (!cam || !cursorSmoothing) {
        cx = target.cx;
        cy = target.cy;
      } else {
        const dt = Math.max(0, Math.min(0.1, now - cam.lastT));
        const alpha = 1 - Math.exp(-dt / CAMERA_TAU);
        cx = cam.cx + (target.cx - cam.cx) * alpha;
        cy = cam.cy + (target.cy - cam.cy) * alpha;
      }

      // Clamp the camera so the scaled viewport stays inside the recording.
      // ffmpeg's crop filter does this automatically on the export side; CSS
      // transform doesn't, so without it the video slides past the clip box
      // when the cursor is near a corner. Valid camera-center range at
      // scale s is [w/(2s), w - w/(2s)].
      if (target.scale >= 1 && videoWidth > 0 && videoHeight > 0) {
        const halfW = videoWidth / (2 * target.scale);
        const halfH = videoHeight / (2 * target.scale);
        cx = Math.max(halfW, Math.min(videoWidth - halfW, cx));
        cy = Math.max(halfH, Math.min(videoHeight - halfH, cy));
      }
      camera.current = { cx, cy, lastT: now };

      const previewScale = computePreviewScale(stageSize, videoWidth, videoHeight, background.padding, aspect);
      const clipW = videoWidth * previewScale;
      const clipH = videoHeight * previewScale;
      const tx = clipW / 2 - cx * previewScale * target.scale;
      const ty = clipH / 2 - cy * previewScale * target.scale;
      setTransform(`translate(${tx}px, ${ty}px) scale(${target.scale})`);

      const canvas = clickCanvas.current;
      if (canvas && events?.events && videoWidth > 0 && videoHeight > 0) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          drawOverlayFrame(
            ctx,
            t,
            events.events,
            clickAnim,
            cursorCfg,
            videoWidth,
            videoHeight,
            events.screen_width || videoWidth,
            events.screen_height || videoHeight,
          );
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [segments, globalZoom, events, cursorSmoothing, clickAnim, cursorCfg, videoWidth, videoHeight, background.padding, aspect, stageSize, trim.start, trim.end]);

  // Match canvas resolution to the source-video on load. Setting width/height
  // clears the canvas but that's fine — the RAF loop redraws every frame.
  useEffect(() => {
    const c = clickCanvas.current;
    if (!c) return;
    if (videoWidth > 0 && videoHeight > 0) {
      c.width = videoWidth;
      c.height = videoHeight;
    }
  }, [videoWidth, videoHeight]);

  useEffect(() => { camera.current = null; }, [videoUrl]);

  const handleLoadedMetadata = () => {
    const v = videoEl.current;
    if (!v) return;
    if (!isFinite(v.duration)) {
      v.currentTime = 1e101;
      return;
    }
    applyMeta();
  };

  const handleDurationChange = () => {
    const v = videoEl.current;
    if (!v) return;
    if (isFinite(v.duration) && v.duration !== videoDuration) applyMeta();
  };

  const applyMeta = () => {
    const v = videoEl.current!;
    if (!isFinite(v.duration)) return;
    setVideoMetadata({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    if (v.currentTime > v.duration) v.currentTime = 0;
  };

  const { previewScale, frameW, frameH, bgW, bgH } = layout(stageSize, videoWidth, videoHeight, background.padding, aspect);

  return (
    <div ref={stageRef} className="flex-1 min-h-0 bg-background flex items-center justify-center p-6 relative">
      <div className="relative shadow-2xl" style={{ width: frameW, height: frameH, background: '#000' }}>
        <div
          className="absolute overflow-hidden"
          style={{
            width: bgW,
            height: bgH,
            left: (frameW - bgW) / 2,
            top: (frameH - bgH) / 2,
            background: background.color,
            borderRadius: background.radius * previewScale,
          }}
        >
          {/* Negative padding pushes the video past the bg frame's edges
              and overflow:hidden clips it — that's how it becomes a crop. */}
          <div
            className="absolute"
            style={{
              width: videoWidth * previewScale,
              height: videoHeight * previewScale,
              left: background.padding.left * previewScale,
              top: background.padding.top * previewScale,
              overflow: 'hidden',
            }}
          >
            <div
              className="absolute inset-0"
              style={{ transform, transformOrigin: '0 0', willChange: 'transform' }}
            >
              <video
                ref={videoEl}
                src={videoUrl ?? undefined}
                playsInline
                onLoadedMetadata={handleLoadedMetadata}
                onDurationChange={handleDurationChange}
                className="absolute inset-0 w-full h-full"
                style={{ objectFit: 'fill' }}
              />
              <canvas
                ref={clickCanvas}
                className="absolute inset-0 w-full h-full pointer-events-none"
              />
            </div>
          </div>
        </div>
      </div>
      <div className="absolute bottom-2 right-3 text-[10px] text-muted/60 select-none">
        {Math.round(videoWidth)} × {Math.round(videoHeight)} · t={currentTime.toFixed(2)}s
      </div>
    </div>
  );
}

function smoothstep(p: number) {
  const c = p < 0 ? 0 : p > 1 ? 1 : p;
  return c * c * (3 - 2 * c);
}

function activeSpeed(segments: Segment[], t: number): number {
  for (const seg of segments) {
    if (seg.type === 'speed' && t >= seg.start && t < seg.end) return seg.factor;
  }
  return 1;
}

function activeZoom(
  segments: Segment[],
  globalZoom: GlobalZoomConfig,
  events: EventsObject | null,
  t: number,
  w: number,
  h: number,
) {
  const baseScale = globalZoom.enabled ? globalZoom.scale : 1;
  const cursorOrCenter = (): { x: number; y: number } => {
    const c = cursorAt(events, t, w, h);
    return c ?? { x: w / 2, y: h / 2 };
  };

  let active: Extract<Segment, { type: 'zoom' }> | null = null;
  for (const seg of segments) {
    if (seg.type !== 'zoom') continue;
    if (t >= seg.start && t <= seg.end) active = seg;
  }

  if (!active) {
    if (globalZoom.enabled) {
      const c = cursorOrCenter();
      return { scale: baseScale, cx: c.x, cy: c.y };
    }
    return { scale: 1, cx: w / 2, cy: h / 2 };
  }

  const ease = Math.max(0.05, active.ease);
  const dur = active.end - active.start;
  const effEase = Math.min(ease, dur / 2);
  const inEnd = active.start + effEase;
  const outStart = active.end - effEase;
  let s: number;
  if (t < inEnd) s = baseScale + (active.scale - baseScale) * smoothstep((t - active.start) / effEase);
  else if (t < outStart) s = active.scale;
  else s = baseScale + (active.scale - baseScale) * smoothstep((active.end - t) / effEase);

  const center = active.followCursor ? cursorOrCenter() : { x: active.x, y: active.y };
  return { scale: s, cx: center.x, cy: center.y };
}

function layout(stage: { w: number; h: number }, vw: number, vh: number, pad: Padding, aspect: string) {
  if (!vw || !vh || !stage.w || !stage.h) {
    return { previewScale: 1, frameW: 0, frameH: 0, bgW: 0, bgH: 0 };
  }
  const availW = stage.w - 48;
  const availH = stage.h - 48;
  const padX = pad.left + pad.right;
  const padY = pad.top + pad.bottom;

  // Negative padding can crop the source below 1px — clamp so the aspect
  // math doesn't divide by zero.
  const safeOutW = Math.max(1, vw + padX);
  const safeOutH = Math.max(1, vh + padY);

  let outW: number, outH: number;
  if (aspect === 'native') {
    outW = safeOutW;
    outH = safeOutH;
  } else {
    const [aw, ah] = aspect.split(':').map(Number);
    const target = aw / ah;
    if (safeOutW / safeOutH > target) { outW = safeOutW; outH = safeOutW / target; }
    else { outH = safeOutH; outW = safeOutH * target; }
  }
  const scale = Math.min(availW / outW, availH / outH);
  const frameW = outW * scale;
  const frameH = outH * scale;
  const bgW = Math.max(0, vw + padX) * scale;
  const bgH = Math.max(0, vh + padY) * scale;
  return { previewScale: scale, frameW, frameH, bgW, bgH };
}

function computePreviewScale(stage: { w: number; h: number }, vw: number, vh: number, pad: Padding, aspect: string) {
  return layout(stage, vw, vh, pad, aspect).previewScale || 1;
}
