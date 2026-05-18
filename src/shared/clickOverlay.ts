// Overlay renderer (clicks + cursor) shared by the preview canvas and the
// export-side node-canvas. No DOM or node types — builds under both the
// web and node tsconfigs.

export type ClickAnimationStyle = "none" | "ring" | "pulse" | "halo";

export interface ClickAnimationConfig {
  enabled: boolean;
  style: ClickAnimationStyle;
  color: string;
  // Diameter at the at-rest scale, in source-video pixels.
  size: number;
  // Lifetime in *source* time seconds. Both preview and export age clicks by
  // source time, so a 2× speed segment shortens the wall-time lifetime the
  // same way on both sides.
  duration: number;
}

export interface ClickOverlayEvent {
  type: string;
  t: number;
  x: number;
  y: number;
}

// Minimal 2D-context surface — both browser CanvasRenderingContext2D and
// @napi-rs/canvas's SKRSContext2D satisfy this. fillStyle/strokeStyle are
// loose because the W3C type is `string | CanvasGradient | CanvasPattern`
// and the DOM type isn't available under the node tsconfig.
export interface ClickOverlayCtx {
  save(): void;
  restore(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(
    x: number,
    y: number,
    r: number,
    start: number,
    end: number,
    ccw?: boolean,
  ): void;
  fill(): void;
  stroke(): void;
  translate(x: number, y: number): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fillStyle: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  strokeStyle: any;
  lineWidth: number;
  globalAlpha: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

// Custom cursor drawn over the recording. The OS cursor is excluded at
// capture time, so this is the only cursor in the final video.
export type CursorStyle = "none" | "default" | "dot";

export interface CursorConfig {
  enabled: boolean;
  style: CursorStyle;
  // Arrow body fill (the outline + drop shadow are auto-derived for contrast).
  color: string;
  // Vertical extent in source-video pixels. Width derives from the style.
  size: number;
}

// Draw the overlay frame (cursor + click animations) at source-time t. The
// canvas is sized in source-video pixels; the preview's CSS transform and
// the export's zoom filter both scale this output the same way, which is
// what keeps the two pixel-aligned. Events arrive in screen coords from
// uiohook, so we rescale to video pixels here. Clears the canvas first so
// callers can re-render every frame.
export function drawOverlayFrame(
  ctx: ClickOverlayCtx,
  t: number,
  events: ReadonlyArray<ClickOverlayEvent>,
  clickCfg: ClickAnimationConfig,
  cursorCfg: CursorConfig,
  videoWidth: number,
  videoHeight: number,
  screenWidth: number,
  screenHeight: number,
): void {
  ctx.clearRect(0, 0, videoWidth, videoHeight);

  const sx = screenWidth > 0 ? videoWidth / screenWidth : 1;
  const sy = screenHeight > 0 ? videoHeight / screenHeight : 1;

  // Clicks under cursor so a co-temporal click+cursor reads as "the cursor
  // clicked here".
  if (clickCfg.enabled && clickCfg.style !== "none" && clickCfg.duration > 0) {
    for (const e of events) {
      if (e.type !== "click") continue;
      const age = t - e.t;
      if (age < 0 || age > clickCfg.duration) continue;
      drawOneClick(ctx, e.x * sx, e.y * sy, age, clickCfg);
    }
  }

  if (cursorCfg.enabled && cursorCfg.style !== "none") {
    const pos = cursorAt(events, t, sx, sy);
    if (pos) drawCursor(ctx, pos.x, pos.y, cursorCfg);
  }
}

// Linear-interp the recorded cursor at source-time t. Null if there are no
// move events. Caller-supplied scale factors so the result lands in whatever
// coordinate system the caller wants.
function cursorAt(
  events: ReadonlyArray<ClickOverlayEvent>,
  t: number,
  scaleX: number,
  scaleY: number,
): { x: number; y: number } | null {
  let prev: ClickOverlayEvent | null = null;
  let next: ClickOverlayEvent | null = null;
  for (const e of events) {
    if (e.type !== "move") continue;
    if (e.t <= t) prev = e;
    else {
      next = e;
      break;
    }
  }
  if (!prev && !next) return null;
  if (!prev) return { x: next!.x * scaleX, y: next!.y * scaleY };
  if (!next || next.t === prev.t)
    return { x: prev.x * scaleX, y: prev.y * scaleY };
  const u = (t - prev.t) / (next.t - prev.t);
  return {
    x: (prev.x + (next.x - prev.x) * u) * scaleX,
    y: (prev.y + (next.y - prev.y) * u) * scaleY,
  };
}

function drawCursor(
  ctx: ClickOverlayCtx,
  x: number,
  y: number,
  cfg: CursorConfig,
): void {
  if (cfg.style === "dot") {
    const r = Math.max(1, cfg.size / 2);
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
    ctx.shadowBlur = cfg.size * 0.2;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = cfg.color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (cfg.style === "default") {
    // macOS-style pointer polygon. The (0,0) hotspot is the tip after the
    // translate, so the recorded mouse position is what tracks the cursor's
    // visible tip — not its bounding box center.
    const h = cfg.size;
    const w = h * 0.62;
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = h * 0.14;
    ctx.shadowOffsetX = h * 0.02;
    ctx.shadowOffsetY = h * 0.05;
    ctx.fillStyle = cfg.color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, h * 0.83);
    ctx.lineTo(w * 0.3, h * 0.66);
    ctx.lineTo(w * 0.5, h * 0.98);
    ctx.lineTo(w * 0.65, h * 0.92);
    ctx.lineTo(w * 0.42, h * 0.56);
    ctx.lineTo(w * 0.7, h * 0.56);
    ctx.closePath();
    ctx.fill();
    // Faint outline so the cursor stays readable on light backgrounds. No
    // shadow on the stroke or it'd double up with the fill's shadow.
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.lineWidth = Math.max(0.5, h * 0.03);
    ctx.stroke();
    ctx.restore();
    return;
  }
}

function drawOneClick(
  ctx: ClickOverlayCtx,
  cx: number,
  cy: number,
  age: number,
  cfg: ClickAnimationConfig,
): void {
  const p = clamp01(age / cfg.duration);
  // Bright at touchdown, gone smoothly.
  const fade = 1 - p * p;
  const base = cfg.size;

  if (cfg.style === "ring") {
    const animScale = 0.3 + 1.2 * smoothstep(p);
    const opacity = 0.9 * fade;
    const outerR = (base * animScale) / 2;
    const stroke = Math.max(2, base * 0.05) * animScale;
    if (outerR <= 0 || opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.lineWidth = stroke;
    ctx.strokeStyle = cfg.color;
    // arc radius is centered on the stroke, so the visible outer diameter
    // works out to base*animScale.
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.5, outerR - stroke / 2), 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (cfg.style === "pulse") {
    const animScale = 0.5 + 1.0 * smoothstep(p);
    const opacity = 0.6 * fade;
    const r = (base * animScale) / 2;
    if (r <= 0 || opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = cfg.color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (cfg.style === "halo") {
    const animScale = 0.9;
    const opacity = 0.8 * fade;
    const r = (base * animScale) / 2;
    if (r <= 0 || opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.shadowColor = cfg.color;
    ctx.shadowBlur = base * 0.5;
    ctx.fillStyle = cfg.color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.restore();
    return;
  }
}

// True if the overlay would draw anything at source-time t. The exporter
// uses this to short-circuit canvas work + emit a pre-encoded blank PNG for
// empty frames. With cursor enabled this is almost always true; the
// optimisation mostly helps the clicks-only configuration.
export function hasActiveOverlay(
  t: number,
  events: ReadonlyArray<ClickOverlayEvent>,
  clickCfg: ClickAnimationConfig,
  cursorCfg: CursorConfig,
): boolean {
  if (cursorCfg.enabled && cursorCfg.style !== "none") {
    for (const e of events) {
      if (e.type !== "move") continue;
      if (e.t <= t) return true;
    }
  }
  if (clickCfg.enabled && clickCfg.style !== "none" && clickCfg.duration > 0) {
    for (const e of events) {
      if (e.type != "click") continue;
      const age = t - e.t;
      if (age >= 0 && age <= clickCfg.duration) return true;
    }
  }
  return false;
}

function smoothstep(p: number): number {
  const c = clamp01(p);
  return c * c * (3 - 2 * c);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
