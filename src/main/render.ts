// ffmpeg-driven export of a Klick project to MP4.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import {
  drawOverlayFrame,
  hasActiveOverlay,
  type ClickAnimationConfig,
  type CursorConfig,
} from '@shared/clickOverlay';

// Types mirror src/renderer/src/store.ts ProjectFile.

type AspectRatio = 'native' | '16:9' | '9:16' | '1:1' | '4:5';

interface Padding { top: number; right: number; bottom: number; left: number }
interface Background { color: string; padding: Padding; paddingLinked?: boolean; radius: number }
interface GlobalZoomConfig { enabled: boolean; scale: number }

interface ZoomSegment { id: string; type: 'zoom'; start: number; end: number; scale: number; x: number; y: number; ease: number; followCursor?: boolean }
interface SpeedSegment { id: string; type: 'speed'; start: number; end: number; factor: number }
interface CutSegment { id: string; type: 'cut'; start: number; end: number }
type Segment = ZoomSegment | SpeedSegment | CutSegment;

interface InputEvent { type: 'move' | 'click'; t: number; x: number; y: number; button?: string }
interface EventsObject { version: number; started_at_wall: number; duration: number; screen_width: number; screen_height: number; events: InputEvent[] }

export interface ProjectFile {
  version: 1;
  video: string;
  video_width: number;
  video_height: number;
  duration: number;
  events: EventsObject | null;
  trim: { start: number; end: number };
  segments: Segment[];
  background: Background;
  aspect: AspectRatio;
  cursor_smoothing?: { enabled: boolean };
  output: string;
  export_quality?: ExportQuality;
  global_zoom?: GlobalZoomConfig;
  click_animation?: ClickAnimationConfig;
  cursor?: CursorConfig;
}

type ExportQuality = 'high' | 'balanced' | 'fast';

// Quality tier knobs. `maxDim` caps the longer side of the output (null =
// source resolution). `fps` is the output frame rate — 30 is fine for
// landing-page demos where most content is static; 60 is meaningfully
// smoother on fast camera motion and cursor movement.
//
// Downscaling + lower fps + a faster x264 preset together drop a 20-second
// retina-source export from "5+ minutes" to "well under a minute" because
// every filter in the pipeline (overlay composite, alphamerge, scale, crop,
// and h264 encode) scales with pixel-count × frame-count.
const QUALITY_PRESETS: Record<ExportQuality, { crf: string; preset: string; maxDim: number | null; fps: number }> = {
  high:     { crf: '18', preset: 'medium',    maxDim: null, fps: 60 },
  balanced: { crf: '22', preset: 'fast',      maxDim: 1920, fps: 30 },
  fast:     { crf: '26', preset: 'ultrafast', maxDim: 1280, fps: 30 },
};

interface SrcInfo { width: number; height: number; fps: number; duration: number }

export interface ExportOptions {
  project: ProjectFile;
  videoPath: string;
  outPath: string;
  onLog?: (text: string) => void;
  signal?: AbortSignal;
}

export type ExportResult =
  | { ok: true; outPath: string }
  | { error: string; stderr?: string };

export async function runExport(opts: ExportOptions): Promise<ExportResult> {
  const { project, videoPath, outPath, onLog, signal } = opts;

  const ffmpegBin = await findBinary('ffmpeg');
  const ffprobeBin = await findBinary('ffprobe');
  if (!ffmpegBin) return { error: 'ffmpeg not found. Install with `brew install ffmpeg` and retry.' };
  if (!ffprobeBin) return { error: 'ffprobe not found. Install with `brew install ffmpeg` and retry.' };

  try {
    assertSafePath(videoPath, 'video');
    assertSafePath(outPath, 'out');
  } catch (err) {
    return { error: (err as Error).message };
  }
  try {
    const st = await fs.stat(videoPath);
    if (!st.isFile()) return { error: `Video is not a regular file: ${videoPath}` };
  } catch {
    return { error: `Video not found: ${videoPath}` };
  }
  try {
    await fs.access(path.dirname(outPath), fs.constants.W_OK);
  } catch {
    return { error: `Output directory is not writable: ${path.dirname(outPath)}` };
  }

  let validated: ValidatedProject;
  try {
    validated = validateProject(project);
  } catch (err) {
    return { error: `Invalid project: ${(err as Error).message}` };
  }

  let src: SrcInfo;
  try {
    src = await probe(ffprobeBin, videoPath, signal);
  } catch (err) {
    return { error: `ffprobe failed: ${(err as Error).message}` };
  }
  onLog?.(`Source: ${src.width}×${src.height} @ ${src.fps.toFixed(2)} fps · ${src.duration.toFixed(2)}s\n`);

  const hasAudio = await probeHasAudio(ffprobeBin, videoPath, signal).catch(() => false);
  onLog?.(`Audio: ${hasAudio ? 'yes' : 'no'}\n`);

  // Plan the timeline once. Filter graph and overlay renderer derive timing
  // from the same chunks list so they can't drift.
  let plan: ExportPlan;
  try {
    plan = planExport(validated);
  } catch (err) {
    return { error: (err as Error).message };
  }
  const outputFps = computeOutputFps(src, validated.quality);

  // Sum of chunk durations after speed adjustment — what the output should
  // be. We use this both to log expectation and to cap ffmpeg with `-t`
  // so a runaway filter graph (looped input mis-bounding, infinite color
  // canvas escaping shortest=1, etc.) can't produce a multi-minute output
  // for what should be a 6-second video.
  const expectedDurationSec = plan.chunks.reduce((s, c) => s + (c.b - c.a) / c.sp, 0);
  onLog?.(`Expected output duration: ${expectedDurationSec.toFixed(2)}s (trim=${validated.trim.start.toFixed(2)}–${validated.trim.end.toFixed(2)}, ${plan.chunks.length} chunk(s))\n`);

  // Segment + zoom diagnostics so we can see exactly what the export is
  // being told to apply. If zoom segments live in the project but aren't
  // listed here, something stripped them in validation; if they're listed
  // but the output looks un-zoomed, the issue is downstream in the filter
  // graph.
  const zoomSegs = validated.segments.filter((s) => s.type === 'zoom');
  const speedSegs = validated.segments.filter((s) => s.type === 'speed');
  const cutSegs = validated.segments.filter((s) => s.type === 'cut');
  onLog?.(`Segments: ${zoomSegs.length} zoom, ${speedSegs.length} speed, ${cutSegs.length} cut\n`);
  for (const z of zoomSegs) {
    const zz = z as { start: number; end: number; scale: number; followCursor?: boolean; x: number; y: number };
    onLog?.(`  zoom ${zz.start.toFixed(2)}–${zz.end.toFixed(2)}s ${zz.scale}x ${zz.followCursor ? 'follow' : `@(${Math.round(zz.x)},${Math.round(zz.y)})`}\n`);
  }
  onLog?.(`Global zoom: ${validated.globalZoom.enabled ? validated.globalZoom.scale + 'x' : 'off'}\n`);

  // Per-tier output downscale. Apply once at the start of the filter chain
  // so every subsequent filter operates at the cheaper size. Overlay PNG
  // dimensions, mask PNG dimensions, and zoom cx/cy expressions all get
  // multiplied through by exportScale below.
  const tierMaxDim = QUALITY_PRESETS[validated.quality].maxDim;
  const longestSide = Math.max(src.width, src.height);
  const exportScale = tierMaxDim != null && longestSide > tierMaxDim
    ? tierMaxDim / longestSide
    : 1.0;
  const evenify = (n: number) => (n % 2 === 0 ? n : n - 1);
  const exportW = evenify(Math.max(4, Math.round(src.width * exportScale)));
  const exportH = evenify(Math.max(4, Math.round(src.height * exportScale)));
  if (exportScale < 1) {
    onLog?.(`Downscaling pipeline ${src.width}x${src.height} → ${exportW}x${exportH} (tier=${validated.quality})\n`);
  }

  const events = validated.events?.events ?? [];
  const hasMoves = events.some((e) => e.type === 'move');
  const hasClicks = events.some((e) => e.type === 'click');
  const wantsCursor =
    validated.cursor.enabled && validated.cursor.style !== 'none' && hasMoves;
  const wantsClickRings =
    validated.clickAnimation.enabled &&
    validated.clickAnimation.style !== 'none' &&
    hasClicks;
  const wantsOverlay = validated.events !== null && (wantsCursor || wantsClickRings);

  let overlayTmpDir: string | null = null;
  if (wantsOverlay) {
    const overlayStart = Date.now();
    try {
      overlayTmpDir = await renderOverlayFrames(
        exportW,
        exportH,
        validated.clickAnimation,
        validated.cursor,
        validated.events!,
        plan.chunks,
        outputFps,
        signal,
        onLog,
      );
    } catch (err) {
      return { error: `Overlay render failed: ${(err as Error).message}` };
    }
    onLog?.(`Overlay frames rendered in ${((Date.now() - overlayStart) / 1000).toFixed(1)}s\n`);
  }
  const cleanupOverlayTmpDir = async () => {
    if (overlayTmpDir) {
      await fs.rm(overlayTmpDir, { recursive: true, force: true }).catch(() => {});
      overlayTmpDir = null;
    }
  };

  // Pre-render the rounded-corner alpha mask if the project has one.
  // Replaces ffmpeg's per-pixel `geq` mask, which was the single biggest
  // CPU hog in the export pipeline. Generated at the *scaled* post-crop
  // dimensions so it matches the video stream that alphamerge will apply
  // it to.
  let maskPath: string | null = null;
  if (validated.background.radius > 0) {
    const padding = validated.background.padding;
    const cropL = Math.round(Math.max(0, -padding.left) * exportScale);
    const cropR = Math.round(Math.max(0, -padding.right) * exportScale);
    const cropT = Math.round(Math.max(0, -padding.top) * exportScale);
    const cropB = Math.round(Math.max(0, -padding.bottom) * exportScale);
    const cropW = exportW - cropL - cropR;
    const cropH = exportH - cropT - cropB;
    const scaledRadius = Math.round(validated.background.radius * exportScale);
    if (cropW > 4 && cropH > 4 && scaledRadius > 0) {
      const maskTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'klick-mask-'));
      maskPath = path.join(maskTmp, 'mask.png');
      await writeRoundedMask(maskPath, cropW, cropH, scaledRadius);
    }
  }
  const cleanupMaskDir = async () => {
    if (maskPath) {
      await fs.rm(path.dirname(maskPath), { recursive: true, force: true }).catch(() => {});
      maskPath = null;
    }
  };

  let graph: string;
  let outLabels: [string, string | null];
  let activeFilters: string[] = [];
  try {
    const built = buildFilterGraph(
      plan, validated, src, hasAudio, outputFps,
      overlayTmpDir !== null, maskPath !== null,
      exportScale, exportW, exportH,
    );
    graph = built.graph;
    outLabels = built.outLabels;
    activeFilters = built.activeFilters;
  } catch (err) {
    await cleanupOverlayTmpDir();
    await cleanupMaskDir();
    return { error: (err as Error).message };
  }
  onLog?.(`Filter chain: ${activeFilters.join(' → ')}\n`);
  onLog?.(`Filter graph (${graph.length} chars, output ${outputFps} fps)\n`);
  // Persist the graph to a temp file so it can be inspected without
  // spamming the live log with 30k+ chars on one line.
  try {
    const graphDumpPath = path.join(os.tmpdir(), `klick-graph-${Date.now()}.txt`);
    await fs.writeFile(graphDumpPath, graph);
    onLog?.(`Filter graph dumped to: ${graphDumpPath}\n`);
  } catch { /* non-fatal */ }

  const args: string[] = ['-y', '-i', videoPath];
  if (overlayTmpDir) {
    // -start_number 0 is explicit so older ffmpeg builds don't try to
    // auto-detect the first frame.
    args.push(
      '-framerate', String(outputFps),
      '-start_number', '0',
      '-i', path.join(overlayTmpDir, 'f_%06d.png'),
    );
  }
  if (maskPath) {
    // -loop 1 makes ffmpeg treat the single PNG as an endlessly-repeating
    // stream so it lasts the whole video.
    args.push('-loop', '1', '-i', maskPath);
  }
  args.push('-filter_complex', graph, '-map', outLabels[0]);
  if (hasAudio && outLabels[1]) {
    args.push('-map', outLabels[1]);
  }
  const { crf, preset } = QUALITY_PRESETS[validated.quality];
  onLog?.(`Quality: ${validated.quality} (CRF ${crf}, preset ${preset}, ${outputFps}fps, ${exportW}x${exportH})\n`);
  args.push(
    '-r', String(outputFps),
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', crf,
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    // Hard cap on output duration. With the looped mask input and infinite
    // color canvas, any single missing `shortest=1` in the filter graph
    // can let the output run away. Bound it.
    '-t', expectedDurationSec.toFixed(3),
    outPath,
  );

  const ffmpegStart = Date.now();
  onLog?.(`Spawning ffmpeg…\n`);
  const result = await new Promise<ExportResult>((resolve) => {
    const proc = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let aborted = false;

    const onAbort = () => {
      aborted = true;
      try { proc.kill('SIGTERM'); } catch { /* */ }
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* */ } }, 1500);
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    proc.stdout?.on('data', (d) => onLog?.(d.toString()));
    proc.stderr?.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      onLog?.(s);
    });
    proc.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      resolve({ error: err.message });
    });
    proc.on('exit', (code) => {
      signal?.removeEventListener('abort', onAbort);
      onLog?.(`ffmpeg finished in ${((Date.now() - ffmpegStart) / 1000).toFixed(1)}s (exit ${code})\n`);
      if (aborted) resolve({ error: 'Export cancelled.' });
      else if (code === 0) resolve({ ok: true, outPath });
      else resolve({ error: `ffmpeg exited with code ${code}`, stderr });
    });
  });

  await cleanupOverlayTmpDir();
  await cleanupMaskDir();
  return result;
}

async function probe(ffprobeBin: string, videoPath: string, signal?: AbortSignal): Promise<SrcInfo> {
  const args = [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,duration',
    '-show_entries', 'format=duration',
    '-of', 'json',
    videoPath,
  ];
  const out = await collect(ffprobeBin, args, signal);
  const data = JSON.parse(out);
  const stream = data.streams?.[0];
  if (!stream) throw new Error('No video stream found');
  const [num, den] = String(stream.r_frame_rate ?? '30/1').split('/');
  const fps = (Number(num) / (Number(den) || 1)) || 30;
  const duration = Number(stream.duration) || Number(data.format?.duration) || 0;
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    fps,
    duration,
  };
}

async function probeHasAudio(ffprobeBin: string, videoPath: string, signal?: AbortSignal): Promise<boolean> {
  const args = ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', videoPath];
  try {
    const out = (await collect(ffprobeBin, args, signal)).trim();
    return out === 'audio';
  } catch {
    return false;
  }
}

function collect(bin: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const onAbort = () => { try { proc.kill('SIGTERM'); } catch { /* */ } };
    signal?.addEventListener('abort', onAbort, { once: true });
    proc.stdout?.on('data', (d) => { out += d.toString(); });
    proc.stderr?.on('data', (d) => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (code === 0) resolve(out);
      else reject(new Error(err || `exited code ${code}`));
    });
  });
}

interface ValidatedProject {
  trim: { start: number; end: number };
  segments: Segment[];
  background: { color: string; padding: Padding; radius: number };
  aspect: AspectRatio;
  globalZoom: GlobalZoomConfig;
  events: EventsObject | null;
  quality: ExportQuality;
  clickAnimation: ClickAnimationConfig;
  cursor: CursorConfig;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ASPECTS = new Set<AspectRatio>(['native', '16:9', '9:16', '1:1', '4:5']);

function validateProject(p: ProjectFile): ValidatedProject {
  if (!p || typeof p !== 'object') throw new Error('Project is not an object');

  const trim = {
    start: clampNum(p.trim?.start, 0, 1e6, 'trim.start'),
    end: clampNum(p.trim?.end, 0, 1e6, 'trim.end'),
  };
  if (trim.end <= trim.start) throw new Error('trim.end must be > trim.start');

  const segments: Segment[] = [];
  for (const raw of p.segments ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const start = clampNum(raw.start, 0, 1e6, 'segment.start');
    const end = clampNum(raw.end, 0, 1e6, 'segment.end');
    if (end <= start) continue;
    if (raw.type === 'zoom') {
      const z = raw as ZoomSegment;
      segments.push({
        id: String(z.id ?? ''),
        type: 'zoom',
        start, end,
        scale: clampNum(z.scale, 1, 10, 'zoom.scale'),
        x: clampNum(z.x, -1e5, 1e5, 'zoom.x'),
        y: clampNum(z.y, -1e5, 1e5, 'zoom.y'),
        ease: clampNum(z.ease, 0, 5, 'zoom.ease'),
        followCursor: !!z.followCursor,
      });
    } else if (raw.type === 'speed') {
      const s = raw as SpeedSegment;
      segments.push({
        id: String(s.id ?? ''),
        type: 'speed',
        start, end,
        factor: clampNum(s.factor, 0.1, 16, 'speed.factor'),
      });
    } else if (raw.type === 'cut') {
      segments.push({ id: String(raw.id ?? ''), type: 'cut', start, end });
    }
  }

  const bgIn = p.background ?? {} as Background;
  const padIn = (typeof bgIn.padding === 'number'
    ? { top: bgIn.padding, right: bgIn.padding, bottom: bgIn.padding, left: bgIn.padding }
    : bgIn.padding) ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const color = typeof bgIn.color === 'string' && HEX_COLOR_RE.test(bgIn.color) ? bgIn.color : '#000000';
  // Negative padding values are valid — they crop the source on that side.
  const padding: Padding = {
    top: clampNum(padIn.top, -1000, 1000, 'padding.top'),
    right: clampNum(padIn.right, -1000, 1000, 'padding.right'),
    bottom: clampNum(padIn.bottom, -1000, 1000, 'padding.bottom'),
    left: clampNum(padIn.left, -1000, 1000, 'padding.left'),
  };
  const radius = clampNum(bgIn.radius ?? 0, 0, 200, 'background.radius');

  const aspect: AspectRatio = ASPECTS.has(p.aspect) ? p.aspect : 'native';

  const gz = p.global_zoom ?? { enabled: false, scale: 1 };
  const globalZoom: GlobalZoomConfig = {
    enabled: !!gz.enabled,
    scale: clampNum(gz.scale ?? 1, 1, 4, 'global_zoom.scale'),
  };

  const quality: ExportQuality = p.export_quality && p.export_quality in QUALITY_PRESETS
    ? p.export_quality
    : 'balanced';

  const ca = p.click_animation;
  const clickAnimation: ClickAnimationConfig = {
    enabled: !!ca?.enabled,
    style: (ca?.style === 'ring' || ca?.style === 'pulse' || ca?.style === 'halo' || ca?.style === 'none')
      ? ca.style
      : 'ring',
    color: typeof ca?.color === 'string' && HEX_COLOR_RE.test(ca.color) ? ca.color : '#22d3ee',
    size: clampNum(ca?.size ?? 80, 4, 4000, 'click_animation.size'),
    duration: clampNum(ca?.duration ?? 0.45, 0.05, 10, 'click_animation.duration'),
  };

  const cu = p.cursor;
  const validCursorStyles = new Set(['none', 'default', 'pointer', 'dot', 'ring', 'crosshair']);
  const cursor: CursorConfig = {
    enabled: !!cu?.enabled,
    style: validCursorStyles.has(cu?.style ?? '') ? (cu!.style as CursorConfig['style']) : 'default',
    color: typeof cu?.color === 'string' && HEX_COLOR_RE.test(cu.color) ? cu.color : '#ffffff',
    outlineColor: typeof cu?.outlineColor === 'string' && HEX_COLOR_RE.test(cu.outlineColor) ? cu.outlineColor : '#1d1d1f',
    size: clampNum(cu?.size ?? 28, 4, 200, 'cursor.size'),
  };

  return { trim, segments, background: { color, padding, radius }, aspect, globalZoom, events: p.events ?? null, quality, clickAnimation, cursor };
}

function clampNum(v: unknown, min: number, max: number, name: string): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`Not a number: ${name} = ${v}`);
  return Math.max(min, Math.min(max, n));
}

function assertSafePath(p: string, label: string): void {
  if (typeof p !== 'string' || !p) throw new Error(`Missing ${label} path`);
  if (!path.isAbsolute(p)) throw new Error(`${label} must be an absolute path: ${p}`);
  const norm = path.normalize(p);
  if (norm.includes('/../') || norm.endsWith('/..')) throw new Error(`Invalid ${label} path: ${p}`);
}

function keepRanges(trim: { start: number; end: number }, cuts: CutSegment[]): [number, number][] {
  const { start, end } = trim;
  const cs = cuts
    .map((c) => [Math.max(c.start, start), Math.min(c.end, end)] as [number, number])
    .filter(([s, e]) => e > start && s < end)
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cur = start;
  for (const [s0, e0] of cs) {
    if (s0 > cur) out.push([cur, s0]);
    cur = Math.max(cur, e0);
  }
  if (cur < end) out.push([cur, end]);
  return out;
}

function overlappingSpeed(t: number, speeds: SpeedSegment[]): number {
  for (const s of speeds) {
    if (s.start <= t && t < s.end) return s.factor;
  }
  return 1.0;
}

function integrateSpeed(a: number, b: number, speeds: SpeedSegment[], step = 0.01): number {
  if (b <= a) return 0;
  let total = 0, t = a;
  while (t < b) {
    const nxt = Math.min(t + step, b);
    const sp = overlappingSpeed((t + nxt) / 2, speeds);
    total += (nxt - t) / sp;
    t = nxt;
  }
  return total;
}

function mapOrigToOutput(tOrig: number, ranges: [number, number][], speeds: SpeedSegment[]): number | null {
  let outT = 0;
  for (const [rs, re] of ranges) {
    if (tOrig < rs) return null;
    if (tOrig <= re) return outT + integrateSpeed(rs, tOrig, speeds);
    outT += integrateSpeed(rs, re, speeds);
  }
  return null;
}

interface Chunk { a: number; b: number; sp: number }

interface ExportPlan {
  cuts: CutSegment[];
  speeds: SpeedSegment[];
  zooms: ZoomSegment[];
  ranges: [number, number][];
  chunks: Chunk[];
}

// Slice the source timeline into single-speed chunks aligned to surviving
// (post-cut) ranges. Shared between the filter-graph builder and the overlay
// renderer so they see the same time mapping.
function planExport(project: ValidatedProject): ExportPlan {
  const cuts = project.segments.filter((s): s is CutSegment => s.type === 'cut');
  const speeds = project.segments.filter((s): s is SpeedSegment => s.type === 'speed').sort((a, b) => a.start - b.start);
  const zooms = project.segments.filter((s): s is ZoomSegment => s.type === 'zoom').sort((a, b) => a.start - b.start);

  const ranges = keepRanges(project.trim, cuts);
  if (!ranges.length) throw new Error('Trim + cuts removed the entire video.');

  const boundaries = new Set<number>();
  for (const sp of speeds) { boundaries.add(sp.start); boundaries.add(sp.end); }
  const chunks: Chunk[] = [];
  for (const [rs, re] of ranges) {
    const points = Array.from(new Set([rs, re, ...Array.from(boundaries).filter((b) => rs < b && b < re)])).sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      chunks.push({ a, b, sp: overlappingSpeed((a + b) / 2, speeds) });
    }
  }
  return { cuts, speeds, zooms, ranges, chunks };
}

// Output fps is whatever the tier specifies. ffmpeg's `fps=` filter handles
// up/down resampling — duplicating frames when the source is slower, or
// dropping when faster. Tying fps to the tier means Fast can halve all the
// per-frame work while High/Balanced stay smooth.
function computeOutputFps(_src: SrcInfo, quality: ExportQuality): number {
  return QUALITY_PRESETS[quality].fps;
}

function buildFilterGraph(
  plan: ExportPlan,
  project: ValidatedProject,
  src: SrcInfo,
  hasAudio: boolean,
  outputFps: number,
  hasClickOverlay: boolean,
  hasRoundedMask: boolean,
  exportScale: number,
  exportW: number,
  exportH: number,
): { graph: string; outLabels: [string, string | null]; activeFilters: string[] } {
  const { speeds, zooms, ranges, chunks } = plan;

  const parts: string[] = [];
  const segLabels: { v: string; a: string | null }[] = [];
  const activeFilters: string[] = [`trim+concat(${chunks.length})`];

  chunks.forEach(({ a, b, sp }, i) => {
    const vIn = '[0:v]';
    const vOut = `[v${i}]`;
    let vChain = `${vIn}trim=start=${a}:end=${b},setpts=PTS-STARTPTS`;
    if (sp !== 1.0) vChain += `,setpts=${1 / sp}*PTS`;
    vChain += vOut;
    parts.push(vChain);

    let aOut: string | null = null;
    if (hasAudio) {
      aOut = `[a${i}]`;
      let aChain = `[0:a]atrim=start=${a}:end=${b},asetpts=PTS-STARTPTS`;
      if (sp !== 1.0) aChain += ',' + atempoChain(sp);
      aChain += aOut;
      parts.push(aChain);
    }
    segLabels.push({ v: vOut, a: aOut });
  });

  let vCur: string, aCur: string | null;
  if (chunks.length === 1) {
    vCur = segLabels[0].v;
    aCur = segLabels[0].a;
  } else {
    const inputs = segLabels.map((s) => s.v + (s.a ?? '')).join('');
    if (hasAudio) {
      parts.push(`${inputs}concat=n=${chunks.length}:v=1:a=1[vc][ac]`);
      vCur = '[vc]'; aCur = '[ac]';
    } else {
      parts.push(`${inputs}concat=n=${chunks.length}:v=1:a=0[vc]`);
      vCur = '[vc]'; aCur = null;
    }
  }

  if (outputFps !== Math.round(src.fps)) {
    parts.push(`${vCur}fps=${outputFps}[vfps]`);
    vCur = '[vfps]';
    activeFilters.push(`fps=${outputFps}`);
  }

  // Apply the tier-based downscale up front so every filter below operates
  // at the cheaper resolution. flags=bilinear is plenty for downscaling
  // and is a chunk faster than the default lanczos.
  if (exportScale < 1) {
    parts.push(`${vCur}scale=${exportW}:${exportH}:flags=bilinear[v_dn]`);
    vCur = '[v_dn]';
    activeFilters.push(`downscale-${exportW}x${exportH}`);
  }

  // Composite the overlay PNG sequence here, BEFORE the zoom filter, so the
  // click rings + cursor share a coordinate system with the video pixels and
  // get scaled together. The overlay PNGs are rendered at exportW × exportH
  // upstream so we can composite at 0,0 with no scaling. eof_action=pass
  // lets the video continue past the overlay if rounded frame counts differ
  // by one — better than the default `repeat` which would smear the last
  // overlay state.
  if (hasClickOverlay) {
    parts.push(`${vCur}[1:v]overlay=0:0:format=auto:eof_action=pass[vclick]`);
    vCur = '[vclick]';
    activeFilters.push('overlay-click+cursor');
  }

  // Baseline center for sampleCursorPath — follow-cursor segments ease into
  // the cursor from here rather than snapping at the segment's first frame.
  const previewBaseCx = src.width / 2;
  const previewBaseCy = src.height / 2;

  // The surviving timeline ends at the last kept range. Auto-zooms anchored
  // to events.duration can land a frame or two past the actual mp4 duration
  // (wall-clock event timing vs AVAssetWriter's finalized file duration),
  // which would silently drop the segment. Clamp so a hair-over zoom snaps
  // back in-bounds instead of disappearing.
  const lastRangeEnd = ranges.length ? ranges[ranges.length - 1][1] : 0;
  const zoomKeys: ZoomKey[] = zooms
    .map((z): ZoomKey | null => {
      const effEnd = Math.min(z.end, lastRangeEnd);
      if (effEnd <= z.start + 0.05) return null;
      const zs = mapOrigToOutput(z.start, ranges, speeds);
      const ze = mapOrigToOutput(effEnd, ranges, speeds);
      if (zs === null || ze === null) return null;

      let cx = z.x, cy = z.y;
      let cxExpr: string | undefined;
      let cyExpr: string | undefined;

      if (z.followCursor && project.events) {
        const path = sampleCursorPath(z, project.events, src, ranges, speeds, previewBaseCx, previewBaseCy);
        if (path && path.length >= 2) {
          cxExpr = piecewiseLinearExpr(path.map((p) => [p.tOut, p.x]));
          cyExpr = piecewiseLinearExpr(path.map((p) => [p.tOut, p.y]));
          cx = path[0].x;
          cy = path[0].y;
        } else {
          const sampled = cursorAt(project.events, z.start, src.width, src.height);
          if (sampled) { cx = sampled.x; cy = sampled.y; }
        }
      }
      return { start: zs, end: ze, scale: z.scale, x: cx, y: cy, ease: z.ease, cxExpr, cyExpr };
    })
    .filter((k): k is ZoomKey => k !== null);

  const useGlobalZoom = project.globalZoom.enabled && project.globalZoom.scale > 1;
  if (zoomKeys.length || useGlobalZoom) {
    activeFilters.push(`zoom(keys=${zoomKeys.length}, global=${useGlobalZoom})`);
    const baseScale = useGlobalZoom ? project.globalZoom.scale : 1;
    const baseCx = src.width / 2;
    const baseCy = src.height / 2;
    const { cx, cy, s } = buildZoomExpr(zoomKeys, baseScale, baseCx, baseCy);
    // When the source is below the tier max (exportScale === 1) we don't
    // wrap the expression — extra parens / multiply-by-1 widens the AST
    // for no benefit and risks tripping ffmpeg's expression depth limits
    // on long piecewise paths. When we are downscaling, multiply by the
    // export scale so cx/cy land in the downscaled coordinate space.
    const cxOut = exportScale === 1 ? `(${cx})` : `((${cx})*${exportScale})`;
    const cyOut = exportScale === 1 ? `(${cy})` : `((${cy})*${exportScale})`;
    // Single-quoted because the inner expressions contain commas the
    // filter-graph parser would otherwise read as filter-chain separators.
    // scale needs eval=frame to re-evaluate per frame; crop reads x/y as
    // expressions implicitly.
    const scaleFilter = `scale='iw*(${s})':'ih*(${s})':eval=frame`;
    const cropFilter =
      `crop=${exportW}:${exportH}:` +
      `'${cxOut}*(${s})-${exportW}/2':` +
      `'${cyOut}*(${s})-${exportH}/2'`;
    parts.push(`${vCur}${scaleFilter},${cropFilter}[vz]`);
    vCur = '[vz]';
  }

  // Background frame: positive padding adds bg, negative crops the source.
  // Pipeline: (1) crop by negative parts, (2) round corners, (3) overlay
  // onto a solid color canvas.
  // Padding / radius values are stored in source-pixel coords; the pipeline
  // now operates at exportW × exportH, so scale everything through by
  // exportScale (= 1.0 for the High tier, no-op).
  const { padding, color, radius } = project.background;

  const cropLeft = Math.round(Math.max(0, -padding.left) * exportScale);
  const cropRight = Math.round(Math.max(0, -padding.right) * exportScale);
  const cropTop = Math.round(Math.max(0, -padding.top) * exportScale);
  const cropBottom = Math.round(Math.max(0, -padding.bottom) * exportScale);
  const cropW = exportW - cropLeft - cropRight;
  const cropH = exportH - cropTop - cropBottom;
  if (cropW < 4 || cropH < 4) {
    throw new Error('Padding crops the entire recording. Make at least one side less negative.');
  }

  const padLeft = Math.round(Math.max(0, padding.left) * exportScale);
  const padRight = Math.round(Math.max(0, padding.right) * exportScale);
  const padTop = Math.round(Math.max(0, padding.top) * exportScale);
  const padBottom = Math.round(Math.max(0, padding.bottom) * exportScale);

  const innerW = cropW + padLeft + padRight;
  const innerH = cropH + padTop + padBottom;

  let targetW: number, targetH: number;
  if (project.aspect === 'native') {
    targetW = innerW;
    targetH = innerH;
  } else {
    const [aw, ah] = project.aspect.split(':').map(Number);
    const targetAR = aw / ah;
    if (innerW / innerH > targetAR) {
      targetW = innerW;
      targetH = Math.round(innerW / targetAR);
    } else {
      targetH = innerH;
      targetW = Math.round(innerH * targetAR);
    }
  }
  // yuv420p needs even dimensions.
  if (targetW % 2) targetW++;
  if (targetH % 2) targetH++;

  const overlayX = padLeft + Math.round((targetW - innerW) / 2);
  const overlayY = padTop + Math.round((targetH - innerH) / 2);

  const colorHex = color.slice(1);

  if (cropLeft > 0 || cropRight > 0 || cropTop > 0 || cropBottom > 0) {
    parts.push(`${vCur}crop=${cropW}:${cropH}:${cropLeft}:${cropTop}[vc]`);
    vCur = '[vc]';
    activeFilters.push('pad-crop');
  }

  if (radius > 0 && hasRoundedMask) {
    activeFilters.push('rounded-corners');
    // Pre-rendered alpha mask at input index (1 if no overlay, 2 if there
    // is). format=yuva420p promotes the video to RGBA so alphamerge has an
    // alpha channel to replace; alphamerge then takes its alpha from the
    // mask's grayscale (white = visible, black = transparent corner).
    const maskIdx = hasClickOverlay ? 2 : 1;
    parts.push(`${vCur}format=yuva420p[v_a]`);
    parts.push(`[v_a][${maskIdx}:v]alphamerge[vr]`);
    vCur = '[vr]';
  }

  // Pin the color source's rate to outputFps; otherwise it defaults to 25
  // and the overlay output runs at the slower side.
  parts.push(`color=c=0x${colorHex}:s=${targetW}x${targetH}:r=${outputFps}[bgc]`);
  parts.push(`[bgc]${vCur}overlay=x=${overlayX}:y=${overlayY}:shortest=1[vout]`);
  activeFilters.push('bg-composite');

  return { graph: parts.join(';'), outLabels: ['[vout]', hasAudio ? aCur : null], activeFilters };
}

function atempoChain(factor: number): string {
  let f = factor;
  const parts: string[] = [];
  while (f > 2.0) { parts.push('atempo=2.0'); f /= 2.0; }
  while (f < 0.5) { parts.push('atempo=0.5'); f /= 0.5; }
  parts.push(`atempo=${f}`);
  return parts.join(',');
}

interface ZoomKey {
  start: number; end: number; scale: number; ease: number;
  x: number; y: number;
  cxExpr?: string;
  cyExpr?: string;
}

function buildZoomExpr(
  zoomKeys: ZoomKey[],
  baseScale: number,
  baseCx: number,
  baseCy: number,
): { s: string; cx: string; cy: string } {
  // Default everywhere is baseScale at (baseCx, baseCy); each segment
  // overrides during its window with an eased ramp.
  let s = `${baseScale}`;
  let cx = `${baseCx}`;
  let cy = `${baseCy}`;

  for (const z of zoomKeys) {
    const eff = Math.min(Math.max(0.05, z.ease), (z.end - z.start) / 2);
    const inEnd = z.start + eff;
    const outStart = z.end - eff;
    const pIn = `((t-${z.start})/${eff})`;
    const pOut = `((${z.end}-t)/${eff})`;
    const smIn = `(${pIn}*${pIn}*(3-2*${pIn}))`;
    const smOut = `(${pOut}*${pOut}*(3-2*${pOut}))`;
    const localS =
      `if(between(t,${z.start},${inEnd}),` +
      `${baseScale}+(${z.scale}-${baseScale})*${smIn},` +
      `if(between(t,${inEnd},${outStart}),` +
      `${z.scale},` +
      `if(between(t,${outStart},${z.end}),` +
      `${baseScale}+(${z.scale}-${baseScale})*${smOut},` +
      `${baseScale})))`;
    s = `if(between(t,${z.start},${z.end}),${localS},${s})`;
    const localCx = z.cxExpr ?? String(z.x);
    const localCy = z.cyExpr ?? String(z.y);
    cx = `if(between(t,${z.start},${z.end}),${localCx},${cx})`;
    cy = `if(between(t,${z.start},${z.end}),${localCy},${cy})`;
  }
  return { s, cx, cy };
}

// Linear-interpolated cursor position at source-time t. Duplicated from
// renderer's lib/cursor.ts because main can't import across boundaries.
function cursorAt(events: EventsObject, t: number, vw: number, vh: number): { x: number; y: number } | null {
  if (!events?.events?.length) return null;
  const sx = events.screen_width > 0 ? vw / events.screen_width : 1;
  const sy = events.screen_height > 0 ? vh / events.screen_height : 1;
  let prev: InputEvent | null = null;
  let next: InputEvent | null = null;
  for (const e of events.events) {
    if (e.type !== 'move') continue;
    if (e.t <= t) prev = e;
    else { next = e; break; }
  }
  if (!prev && !next) return null;
  if (!prev) return { x: next!.x * sx, y: next!.y * sy };
  if (!next || next.t === prev.t) return { x: prev.x * sx, y: prev.y * sy };
  const u = (t - prev.t) / (next.t - prev.t);
  return {
    x: (prev.x + (next.x - prev.x) * u) * sx,
    y: (prev.y + (next.y - prev.y) * u) * sy,
  };
}

// 60 Hz matches the preview's RAF rate so baked samples line up with what
// the camera ref sees live.
const CURSOR_SAMPLE_RATE_HZ = 60;
const CURSOR_SMOOTHING_TAU = 0.12;

interface Sample { tOut: number; x: number; y: number }

// Walk the zoom segment's source-time range, sample the cursor at each tick,
// exponential-smooth in output time. Returns samples in output time ready
// for piecewise-linear interpolation in an ffmpeg crop expression. Smoother
// starts at the baseline so the camera eases into the cursor instead of
// snapping at the segment's first frame.
function sampleCursorPath(
  z: ZoomSegment,
  events: EventsObject,
  src: SrcInfo,
  ranges: [number, number][],
  speeds: SpeedSegment[],
  baseCx: number,
  baseCy: number,
): Sample[] | null {
  const dtSrc = 1 / CURSOR_SAMPLE_RATE_HZ;
  const raw: Sample[] = [];
  for (let tSrc = z.start; tSrc <= z.end; tSrc += dtSrc) {
    const tOut = mapOrigToOutput(tSrc, ranges, speeds);
    if (tOut === null) continue;
    const pos = cursorAt(events, tSrc, src.width, src.height);
    if (!pos) continue;
    raw.push({ tOut, x: pos.x, y: pos.y });
  }
  if (raw.length < 2) return null;

  const smoothed: Sample[] = [];
  let sx = baseCx;
  let sy = baseCy;
  for (let i = 0; i < raw.length; i++) {
    if (i > 0) {
      const dt = Math.max(0.001, raw[i].tOut - raw[i - 1].tOut);
      const alpha = 1 - Math.exp(-dt / CURSOR_SMOOTHING_TAU);
      sx += (raw[i].x - sx) * alpha;
      sy += (raw[i].y - sy) * alpha;
    }
    smoothed.push({ tOut: raw[i].tOut, x: sx, y: sy });
  }
  return smoothed;
}

// Linearly interpolate between (t, value) keypoints as an ffmpeg expression.
// Balanced binary tree of `if(lt(t,t_mid),...)` calls so parser depth is
// O(log N) — a right-nested chain blows ffmpeg's expression-parser stack at
// the ~720 keypoints a 12s 60Hz baked path produces.
function piecewiseLinearExpr(points: Array<[number, number]>): string {
  const r2 = (n: number) => n.toFixed(2);
  const r4 = (n: number) => n.toFixed(4);

  if (points.length === 0) return '0';
  if (points.length === 1) return r2(points[0][1]);

  const build = (lo: number, hi: number): string => {
    if (hi - lo === 1) {
      const [t0, v0] = points[lo];
      const [t1, v1] = points[hi];
      const span = t1 - t0;
      if (span <= 0) return r2(v1);
      return `(${r2(v0)}+(${r2(v1)}-${r2(v0)})*(t-${r4(t0)})/${r4(span)})`;
    }
    const mid = (lo + hi) >> 1;
    return `if(lt(t,${r4(points[mid][0])}),${build(lo, mid)},${build(mid, hi)})`;
  };

  const firstT = r4(points[0][0]);
  const lastT = r4(points[points.length - 1][0]);
  const firstV = r2(points[0][1]);
  const lastV = r2(points[points.length - 1][1]);
  return `if(lt(t,${firstT}),${firstV},if(gte(t,${lastT}),${lastV},${build(0, points.length - 1)}))`;
}

// Pre-render the overlay track (cursor + clicks) as a transparent PNG
// sequence in a temp dir. ffmpeg reads it back as the second input. Blank
// frames are hardlinked to one pre-encoded PNG so a clicks-only export
// doesn't write thousands of duplicate empty files.
async function renderOverlayFrames(
  srcWidth: number,
  srcHeight: number,
  clickCfg: ClickAnimationConfig,
  cursorCfg: CursorConfig,
  events: EventsObject,
  chunks: Chunk[],
  outputFps: number,
  signal?: AbortSignal,
  onLog?: (text: string) => void,
): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'klick-overlay-'));

  // One blank PNG that every empty frame hardlinks to. PNG (vs WebP) is
  // load-bearing here — @napi-rs/canvas's WebP output gets interpreted as
  // multi-frame by ffmpeg's image2 demuxer (each file expands into ~30
  // frames), which made exports run 30x longer than the source. PNG is
  // single-frame by construction.
  const blankCanvas = createCanvas(srcWidth, srcHeight);
  const blankPath = path.join(tmpDir, '_blank.png');
  await fs.writeFile(blankPath, await blankCanvas.encode('png'));

  // One canvas reused for the whole pass. Allocating a fresh 24MB canvas
  // per frame was a significant chunk of the export time on retina sources;
  // drawOverlayFrame already clearRects before drawing so reuse is safe.
  const canvas = createCanvas(srcWidth, srcHeight);
  const ctx = canvas.getContext('2d');

  const sw = events.screen_width > 0 ? events.screen_width : srcWidth;
  const sh = events.screen_height > 0 ? events.screen_height : srcHeight;
  const evs = events.events ?? [];

  const totalDuration = chunks.reduce((s, c) => s + (c.b - c.a) / c.sp, 0);
  const frameCount = Math.max(1, Math.ceil(totalDuration * outputFps));
  onLog?.(`Overlay: ${frameCount} frames @ ${outputFps} fps → ${tmpDir}\n`);

  let activeFrames = 0;
  const loopStart = Date.now();
  for (let i = 0; i < frameCount; i++) {
    if (signal?.aborted) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      throw new Error('aborted');
    }
    const tSrc = outputFrameToSource(i, outputFps, chunks);
    const fname = `f_${String(i).padStart(6, '0')}.png`;
    const fpath = path.join(tmpDir, fname);

    if (hasActiveOverlay(tSrc, evs, clickCfg, cursorCfg)) {
      drawOverlayFrame(ctx, tSrc, evs, clickCfg, cursorCfg, srcWidth, srcHeight, sw, sh);
      const buf = await canvas.encode('png');
      await fs.writeFile(fpath, buf);
      activeFrames++;
    } else {
      await fs.link(blankPath, fpath);
    }
    if (i > 0 && i % 100 === 0) {
      const elapsed = (Date.now() - loopStart) / 1000;
      const fps = i / elapsed;
      onLog?.(`Overlay: ${i}/${frameCount} (${fps.toFixed(0)} fps)\n`);
    }
  }

  onLog?.(`Overlay: ${activeFrames}/${frameCount} frames had visible overlay\n`);
  return tmpDir;
}

// Pre-render the rounded-corner alpha mask as a single PNG so ffmpeg can
// apply it via `alphamerge` instead of computing the round shape with a
// per-pixel `geq` expression every frame. geq's hypot() call inside the
// corner-zone test was the dominant export-time cost on retina sources —
// billions of sqrt evaluations per export. Generating the mask once is
// effectively free; alphamerge is then a hardware-cheap alpha replacement
// per frame.
async function writeRoundedMask(filePath: string, w: number, h: number, radius: number): Promise<void> {
  const r = Math.min(radius, Math.floor(w / 2), Math.floor(h / 2));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  // Black = fully transparent in alphamerge (alpha 0), white = fully opaque.
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.arcTo(w, 0, w, r, r);
  ctx.lineTo(w, h - r);
  ctx.arcTo(w, h, w - r, h, r);
  ctx.lineTo(r, h);
  ctx.arcTo(0, h, 0, h - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
  ctx.fill();
  await fs.writeFile(filePath, await canvas.encode('png'));
}

// Inverse of mapOrigToOutput for single-speed chunks: source time visible at
// a given output frame.
function outputFrameToSource(frameIdx: number, outputFps: number, chunks: Chunk[]): number {
  const tOut = frameIdx / outputFps;
  let acc = 0;
  for (const c of chunks) {
    const chunkDur = (c.b - c.a) / c.sp;
    if (tOut <= acc + chunkDur + 1e-9) {
      return c.a + (tOut - acc) * c.sp;
    }
    acc += chunkDur;
  }
  // Past the last chunk (the final ceil()'d frame) — clamp to the source-
  // time end so a late click animation can still finish.
  const last = chunks[chunks.length - 1];
  return last ? last.b : tOut;
}

// Closed candidate list so a tampered PATH can't redirect us anywhere
// besides the user's own shell environment.
export async function findBinary(name: 'ffmpeg' | 'ffprobe'): Promise<string | null> {
  const candidates = [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    name,
  ];
  for (const bin of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn(bin, ['-version'], { stdio: 'ignore' });
      p.on('exit', (code) => resolve(code === 0));
      p.on('error', () => resolve(false));
    });
    if (ok) return bin;
  }
  return null;
}
