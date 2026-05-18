import type { EventsObject } from '../../../preload/index';

// Linear-interp the recorded cursor at video-time t, returned in source-
// video pixels. Null when there's no event log or t lies before the first
// move. uiohook reports logical pixels — for Retina screens those are half
// the video's pixel dimensions, hence the per-axis scale factor.
export function cursorAt(
  events: EventsObject | null,
  t: number,
  videoW: number,
  videoH: number,
): { x: number; y: number } | null {
  if (!events?.events?.length) return null;
  const sx = events.screen_width > 0 ? videoW / events.screen_width : 1;
  const sy = events.screen_height > 0 ? videoH / events.screen_height : 1;

  let prev: { t: number; x: number; y: number } | null = null;
  let next: { t: number; x: number; y: number } | null = null;
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
