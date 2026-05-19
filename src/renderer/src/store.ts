import { create } from 'zustand';
import type { EventsObject } from '../../preload/index';
import type {
  ClickAnimationConfig as SharedClickAnimationConfig,
  ClickAnimationStyle as SharedClickAnimationStyle,
  CursorConfig as SharedCursorConfig,
  CursorStyle as SharedCursorStyle,
} from '@shared/clickOverlay';

export type SegmentType = 'zoom' | 'speed' | 'cut';

export interface ZoomSegment {
  id: string;
  type: 'zoom';
  start: number;
  end: number;
  scale: number;
  x: number; // center, in source-video pixels (used when followCursor is false)
  y: number;
  ease: number;
  followCursor: boolean; // when true, x/y track the recorded cursor through this segment
}
export interface SpeedSegment {
  id: string;
  type: 'speed';
  start: number;
  end: number;
  factor: number;
}
export interface CutSegment {
  id: string;
  type: 'cut';
  start: number;
  end: number;
}
export type Segment = ZoomSegment | SpeedSegment | CutSegment;

export type AspectRatio = 'native' | '16:9' | '9:16' | '1:1' | '4:5';
export type InspectorTab = 'look' | 'cursor' | 'zoom' | 'export';

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BackgroundConfig {
  color: string;
  padding: Padding;
  paddingLinked: boolean; // when true, the UI edits one value that mirrors to all sides
  radius: number;
}

export interface GlobalZoomConfig {
  enabled: boolean;
  scale: number;
}

// Tiers map to (CRF, x264 preset) pairs in render.ts. Discrete because
// perceptual quality doesn't change smoothly with CRF anyway.
export type ExportQuality = 'high' | 'balanced' | 'fast';

// Canonical types live in @shared/clickOverlay so preview and export can't
// drift.
export type ClickAnimationStyle = SharedClickAnimationStyle;
export type ClickAnimationConfig = SharedClickAnimationConfig;
export type CursorStyle = SharedCursorStyle;
export type CursorConfig = SharedCursorConfig;

export interface EditorState {
  // Video
  videoPath: string | null;
  videoUrl: string | null;
  videoName: string | null;
  videoDuration: number;
  videoWidth: number;
  videoHeight: number;

  // Events (cursor + clicks)
  events: EventsObject | null;

  // Edit decisions
  trim: { start: number; end: number };
  segments: Segment[];
  selectedSegmentId: string | null;

  // Style
  background: BackgroundConfig;
  aspect: AspectRatio;
  cursorSmoothing: boolean;
  outputName: string;
  exportQuality: ExportQuality;

  globalZoom: GlobalZoomConfig;
  zoomTab: 'segment' | 'global';

  clickAnimation: ClickAnimationConfig;

  // OS cursor is excluded from capture by the native binary, so this is the
  // only pointer in the final video.
  cursor: CursorConfig;

  activeTab: InspectorTab | null;
  inspectorOpen: boolean;
  timelineZoom: number;
}

interface EditorActions {
  setVideo: (info: { videoPath: string; videoUrl: string; name: string }) => void;
  setVideoMetadata: (m: { duration: number; width: number; height: number }) => void;
  setEvents: (events: EventsObject | null) => void;
  setTrim: (trim: { start: number; end: number }) => void;
  setBackground: (patch: Partial<BackgroundConfig>) => void;
  setPadding: (patch: Partial<Padding>) => void;
  setPaddingAll: (n: number) => void;
  setPaddingLinked: (b: boolean) => void;
  setAspect: (a: AspectRatio) => void;
  setCursorSmoothing: (v: boolean) => void;
  setOutputName: (s: string) => void;
  setExportQuality: (q: ExportQuality) => void;
  setActiveTab: (t: InspectorTab | null) => void;
  setTimelineZoom: (z: number) => void;
  setGlobalZoom: (patch: Partial<GlobalZoomConfig>) => void;
  setZoomTab: (t: 'segment' | 'global') => void;
  setClickAnimation: (patch: Partial<ClickAnimationConfig>) => void;
  setCursor: (patch: Partial<CursorConfig>) => void;

  addSegment: (type: SegmentType, atTime: number, video: { width: number; height: number }) => void;
  updateSegment: (id: string, patch: Partial<Segment>) => void;
  removeSegment: (id: string) => void;
  splitSegment: (id: string, atTime: number) => void;
  selectSegment: (id: string | null) => void;
  resetTimeline: () => void;
  applyAutoZooms: () => void;

  hydrateFromProject: (proj: ProjectFile) => void;
  toProject: () => ProjectFile;
}

export interface ProjectFile {
  version: 1;
  video: string;
  video_width: number;
  video_height: number;
  duration: number;
  events: EventsObject | null;
  trim: { start: number; end: number };
  segments: Segment[];
  background: BackgroundConfig;
  aspect: AspectRatio;
  cursor_smoothing: { enabled: boolean };
  output: string;
  export_quality?: ExportQuality;
  global_zoom?: GlobalZoomConfig;
  click_animation?: ClickAnimationConfig;
  cursor?: CursorConfig;
}

let nextId = 1;
const makeId = () => `s${nextId++}`;

const DEFAULTS = {
  background: {
    color: '#0f172a',
    padding: { top: 80, right: 80, bottom: 80, left: 80 },
    paddingLinked: true,
    radius: 16,
  } as BackgroundConfig,
  aspect: 'native' as AspectRatio,
  cursorSmoothing: true,
  outputName: 'demo.mp4',
  exportQuality: 'high' as ExportQuality,
  globalZoom: { enabled: false, scale: 1.25 } as GlobalZoomConfig,
  clickAnimation: {
    enabled: true,
    style: 'ring',
    color: '#ffffff',
    size: 80,
    duration: 0.6,
  } as ClickAnimationConfig,
  cursor: {
    enabled: true,
    style: 'default',
    color: '#ffffff',
    outlineColor: '#1d1d1f',
    size: 28,
  } as CursorConfig,
};

export const useEditor = create<EditorState & EditorActions>((set, get) => ({
  videoPath: null,
  videoUrl: null,
  videoName: null,
  videoDuration: 0,
  videoWidth: 0,
  videoHeight: 0,
  events: null,
  trim: { start: 0, end: 0 },
  segments: [],
  selectedSegmentId: null,
  background: DEFAULTS.background,
  aspect: DEFAULTS.aspect,
  cursorSmoothing: DEFAULTS.cursorSmoothing,
  outputName: DEFAULTS.outputName,
  exportQuality: DEFAULTS.exportQuality,
  activeTab: 'look',
  inspectorOpen: true,
  timelineZoom: 1,
  globalZoom: DEFAULTS.globalZoom,
  zoomTab: 'segment',
  clickAnimation: DEFAULTS.clickAnimation,
  cursor: DEFAULTS.cursor,

  setVideo: ({ videoPath, videoUrl, name }) =>
    set({ videoPath, videoUrl, videoName: name, segments: [], trim: { start: 0, end: 0 }, selectedSegmentId: null }),

  setVideoMetadata: ({ duration, width, height }) =>
    set((s) => ({
      videoDuration: duration,
      videoWidth: width,
      videoHeight: height,
      trim: s.trim.end === 0 || !isFinite(s.trim.end) ? { start: 0, end: duration } : s.trim,
    })),

  setEvents: (events) => set({ events }),
  setTrim: (trim) => set({ trim }),
  setBackground: (patch) => set((s) => ({ background: { ...s.background, ...patch } })),
  setPadding: (patch) =>
    set((s) => ({ background: { ...s.background, padding: { ...s.background.padding, ...patch } } })),
  setPaddingAll: (n) =>
    set((s) => ({
      background: { ...s.background, padding: { top: n, right: n, bottom: n, left: n } },
    })),
  setPaddingLinked: (b) =>
    set((s) => {
      if (!b) return { background: { ...s.background, paddingLinked: false } };
      // Re-linking: normalize all four sides to the top value as a baseline.
      const v = s.background.padding.top;
      return {
        background: {
          ...s.background,
          paddingLinked: true,
          padding: { top: v, right: v, bottom: v, left: v },
        },
      };
    }),
  setAspect: (a) => set({ aspect: a }),
  setCursorSmoothing: (v) => set({ cursorSmoothing: v }),
  setOutputName: (s) => set({ outputName: s }),
  setExportQuality: (q) => set({ exportQuality: q }),
  setActiveTab: (t) => set({ activeTab: t }),
  setTimelineZoom: (z) => set({ timelineZoom: z }),
  setGlobalZoom: (patch) => set((s) => ({ globalZoom: { ...s.globalZoom, ...patch } })),
  setZoomTab: (t) => set({ zoomTab: t }),
  setClickAnimation: (patch) =>
    set((s) => ({ clickAnimation: { ...s.clickAnimation, ...patch } })),

  setCursor: (patch) =>
    set((s) => ({ cursor: { ...s.cursor, ...patch } })),

  addSegment: (type, atTime, video) => {
    const dur = get().videoDuration;
    const len = Math.min(2, dur - atTime);
    if (len < 0.1) return;
    const id = makeId();
    let seg: Segment;
    if (type === 'zoom') {
      const click = findNearestClick(get().events, atTime);
      seg = {
        id, type, start: atTime, end: atTime + len,
        scale: 1.6,
        x: click?.x ?? video.width / 2,
        y: click?.y ?? video.height / 2,
        ease: 0.4,
        followCursor: true,
      };
    } else if (type === 'speed') {
      seg = { id, type, start: atTime, end: atTime + len, factor: 2.0 };
    } else {
      seg = { id, type, start: atTime, end: atTime + len };
    }
    set((s) => ({ segments: [...s.segments, seg], selectedSegmentId: id }));
  },

  updateSegment: (id, patch) =>
    set((s) => ({
      segments: s.segments.map((seg) => (seg.id === id ? ({ ...seg, ...patch } as Segment) : seg)),
    })),

  removeSegment: (id) =>
    set((s) => ({
      segments: s.segments.filter((seg) => seg.id !== id),
      selectedSegmentId: s.selectedSegmentId === id ? null : s.selectedSegmentId,
    })),

  splitSegment: (id, atTime) => {
    set((s) => {
      const seg = s.segments.find((x) => x.id === id);
      if (!seg || atTime <= seg.start || atTime >= seg.end) return s;
      const right: Segment = { ...seg, id: makeId(), start: atTime };
      const left: Segment = { ...seg, end: atTime };
      return { segments: s.segments.map((x) => (x.id === id ? left : x)).concat(right) };
    });
  },

  selectSegment: (id) => set({ selectedSegmentId: id }),

  resetTimeline: () =>
    set((s) => ({
      segments: [],
      selectedSegmentId: null,
      trim: { start: 0, end: s.videoDuration || 0 },
    })),

  applyAutoZooms: () => {
    const s = get();
    const evs = s.events?.events;
    // events.duration is captured during recording; falling back to
    // videoDuration covers the case where this is called before <video>'s
    // onLoadedMetadata has committed.
    const duration = s.events?.duration ?? s.videoDuration;
    if (!evs?.length || !duration || duration <= 0) return;
    const zooms = computeAutoZooms(evs, duration, s.videoWidth || 1, s.videoHeight || 1, makeId);
    if (!zooms.length) return;
    set((state) => ({ segments: [...state.segments, ...zooms] }));
  },

  hydrateFromProject: (proj) =>
    set({
      trim: proj.trim,
      // Old projects may have had no followCursor field — default to true.
      segments: (proj.segments ?? []).map((seg) =>
        seg.type === 'zoom' ? { ...seg, followCursor: seg.followCursor ?? true } : seg,
      ),
      background: normalizeBackground(proj.background),
      aspect: proj.aspect,
      cursorSmoothing: proj.cursor_smoothing?.enabled ?? true,
      outputName: proj.output,
      exportQuality: proj.export_quality ?? DEFAULTS.exportQuality,
      events: proj.events,
      globalZoom: proj.global_zoom ?? DEFAULTS.globalZoom,
      clickAnimation: proj.click_animation ?? DEFAULTS.clickAnimation,
      cursor: proj.cursor ?? DEFAULTS.cursor,
    }),

  toProject: (): ProjectFile => {
    const s = get();
    return {
      version: 1,
      video: s.videoPath || s.videoName || 'video.webm',
      video_width: s.videoWidth,
      video_height: s.videoHeight,
      duration: s.videoDuration,
      events: s.events,
      trim: s.trim,
      segments: s.segments,
      background: s.background,
      aspect: s.aspect,
      cursor_smoothing: { enabled: s.cursorSmoothing },
      output: s.outputName,
      export_quality: s.exportQuality,
      global_zoom: s.globalZoom,
      click_animation: s.clickAnimation,
      cursor: s.cursor,
    };
  },
}));

// Projects saved before per-side padding stored a single number. Coerce to the
// new shape so old saves keep loading without errors.
function normalizeBackground(bg: unknown): BackgroundConfig {
  const b = (bg ?? {}) as Partial<BackgroundConfig> & { padding?: number | Padding };
  const rawPadding = b.padding;
  const padding: Padding =
    typeof rawPadding === 'number'
      ? { top: rawPadding, right: rawPadding, bottom: rawPadding, left: rawPadding }
      : rawPadding ?? DEFAULTS.background.padding;
  return {
    color: b.color ?? DEFAULTS.background.color,
    padding,
    paddingLinked: b.paddingLinked ?? sidesAreEqual(padding),
    radius: b.radius ?? DEFAULTS.background.radius,
  };
}

function sidesAreEqual(p: Padding) {
  return p.top === p.right && p.right === p.bottom && p.bottom === p.left;
}

function findNearestClick(events: EventsObject | null, t: number) {
  if (!events?.events) return null;
  let best: { x: number; y: number; t: number } | null = null;
  let bestDt = Infinity;
  for (const e of events.events) {
    if (e.type !== 'click') continue;
    const dt = Math.abs(e.t - t);
    if (dt < bestDt) {
      bestDt = dt;
      best = { x: e.x, y: e.y, t: e.t };
    }
  }
  return best;
}

// Tunables for auto-placed zoom segments. Pre-roll < post-roll so the zoom
// is fully in when the click lands and lingers afterward for the user to
// read the result.
const AUTO_ZOOM_CLUSTER_WINDOW = 1.5;
const AUTO_ZOOM_PRE_ROLL = 0.4;
const AUTO_ZOOM_POST_ROLL = 1.2;
const AUTO_ZOOM_MIN_GAP = 0.5;
const AUTO_ZOOM_SCALE = 1.6;
const AUTO_ZOOM_EASE = 0.4;

function computeAutoZooms(
  events: EventsObject['events'],
  duration: number,
  videoWidth: number,
  videoHeight: number,
  makeIdFn: () => string,
): ZoomSegment[] {
  const clickTimes: number[] = [];
  for (const e of events) if (e.type === 'click') clickTimes.push(e.t);
  clickTimes.sort((a, b) => a - b);
  if (clickTimes.length === 0) return [];

  // Cluster consecutive clicks within AUTO_ZOOM_CLUSTER_WINDOW seconds.
  const clusters: number[][] = [];
  let cur: number[] = [clickTimes[0]];
  for (let i = 1; i < clickTimes.length; i++) {
    if (clickTimes[i] - cur[cur.length - 1] < AUTO_ZOOM_CLUSTER_WINDOW) {
      cur.push(clickTimes[i]);
    } else {
      clusters.push(cur);
      cur = [clickTimes[i]];
    }
  }
  clusters.push(cur);

  const out: ZoomSegment[] = [];
  for (const c of clusters) {
    const first = c[0];
    const last = c[c.length - 1];
    let start = Math.max(0, first - AUTO_ZOOM_PRE_ROLL);
    const end = Math.min(duration, last + AUTO_ZOOM_POST_ROLL);
    if (out.length > 0) {
      const prev = out[out.length - 1];
      if (start < prev.end + AUTO_ZOOM_MIN_GAP) start = prev.end + AUTO_ZOOM_MIN_GAP;
    }
    if (end - start < 0.5) continue;
    out.push({
      id: makeIdFn(),
      type: 'zoom',
      start,
      end,
      scale: AUTO_ZOOM_SCALE,
      x: videoWidth / 2,
      y: videoHeight / 2,
      ease: AUTO_ZOOM_EASE,
      followCursor: true,
    });
  }
  return out;
}
