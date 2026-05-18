import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, type Segment } from '../store';
import { videoRef } from '../hooks/videoRef';
import { fmtTime, clamp } from '../lib/format';

type Drag =
  | { kind: 'trim-left'; startX: number; startVal: number }
  | { kind: 'trim-right'; startX: number; startVal: number }
  | { kind: 'seg-move'; id: string; startX: number; startStart: number; startEnd: number }
  | { kind: 'seg-resize-left'; id: string; startX: number; startStart: number; startEnd: number }
  | { kind: 'seg-resize-right'; id: string; startX: number; startStart: number; startEnd: number }
  | { kind: 'playhead' };

export function Timeline() {
  const duration = useEditor((s) => s.videoDuration);
  const trim = useEditor((s) => s.trim);
  const setTrim = useEditor((s) => s.setTrim);
  const segments = useEditor((s) => s.segments);
  const updateSegment = useEditor((s) => s.updateSegment);
  const selectedId = useEditor((s) => s.selectedSegmentId);
  const selectSegment = useEditor((s) => s.selectSegment);
  const events = useEditor((s) => s.events);
  const zoom = useEditor((s) => s.timelineZoom);
  const setActiveTab = useEditor((s) => s.setActiveTab);
  const setZoomTab = useEditor((s) => s.setZoomTab);

  const setTimelineZoom = useEditor((s) => s.setTimelineZoom);

  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const drag = useRef<Drag | null>(null);
  // mousedown on a child (segment / trim handle / playhead) bubbles up as
  // a click on the wrap, which would re-seek and clobber the drag-release.
  // This flag swallows the trailing click.
  const skipNextClick = useRef(false);
  // mousedown on the empty background starts tracking. If the cursor moves
  // > PAN_THRESHOLD before release it becomes a pan; otherwise it falls
  // through as a click and seeks.
  const pan = useRef<{ startClientX: number; startScrollLeft: number; engaged: boolean } | null>(null);
  const PAN_THRESHOLD = 4;

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => { raf = requestAnimationFrame(tick); if (videoRef.current) setPlayhead(videoRef.current.currentTime); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Trackpad pinch-to-zoom. macOS reports pinches as wheel events with
  // ctrlKey synthesized to true. We anchor the zoom so the time-point under
  // the cursor stays put instead of always zooming from the left edge.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // plain scroll → let the browser handle it
      e.preventDefault();
      const oldZoom = useEditor.getState().timelineZoom;
      // Exponential so response feels consistent across pinch velocities.
      const newZoom = clamp(oldZoom * Math.exp(-e.deltaY * 0.01), 1, 10);
      if (newZoom === oldZoom) return;
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const trackXBefore = cursorX + el.scrollLeft;
      setTimelineZoom(newZoom);
      // Restore scrollLeft after the new width commits so the time-point
      // under the cursor hasn't moved.
      const trackXAfter = trackXBefore * (newZoom / oldZoom);
      requestAnimationFrame(() => {
        if (wrap.current) wrap.current.scrollLeft = trackXAfter - cursorX;
      });
    };
    // passive: false so preventDefault can stop the page from zooming.
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setTimelineZoom]);

  const pxPerSec = duration && isFinite(duration) ? (width * zoom) / duration : 0;
  const tickSpacing = useMemo(() => chooseTickSpacing(duration, zoom), [duration, zoom]);
  const trackWidth = timeToX(duration, pxPerSec);

  // Reads clientWidth on demand so handlers don't depend on ResizeObserver
  // having caught up. Returns px/sec for the *visible* width; track width
  // is visible × zoom.
  const livePxPerSec = () => {
    const w = wrap.current?.clientWidth ?? width;
    return duration && isFinite(duration) && w > 0 ? (w * zoom) / duration : 0;
  };

  // viewport-x + scrollLeft → track-x → time.
  const eventToTime = (e: MouseEvent | React.MouseEvent) => {
    if (!wrap.current) return 0;
    const pps = livePxPerSec();
    if (!pps) return 0;
    const rect = wrap.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) + wrap.current.scrollLeft;
    return clamp(x / pps, 0, duration);
  };

  const eventToTrackX = (e: MouseEvent | React.MouseEvent) => {
    if (!wrap.current) return 0;
    return (e.clientX - wrap.current.getBoundingClientRect().left) + wrap.current.scrollLeft;
  };

  // Window-level so dragging keeps working when the cursor leaves the
  // timeline.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // Pan first — only runs if no other drag started.
      if (pan.current && wrap.current) {
        const dx = e.clientX - pan.current.startClientX;
        if (!pan.current.engaged && Math.abs(dx) > PAN_THRESHOLD) {
          pan.current.engaged = true;
          // Once a pan is committed, swallow the trailing click so we don't
          // also re-seek to the release position.
          skipNextClick.current = true;
        }
        if (pan.current.engaged) {
          wrap.current.scrollLeft = pan.current.startScrollLeft - dx;
        }
      }
      if (!drag.current || !wrap.current) return;
      const pps = livePxPerSec();
      if (!pps) return;
      const d = drag.current;
      if (d.kind === 'playhead') {
        if (videoRef.current) videoRef.current.currentTime = eventToTime(e);
        return;
      }
      const dt = (eventToTrackX(e) - d.startX) / pps;
      if (d.kind === 'trim-left') setTrim({ start: clamp(d.startVal + dt, 0, trim.end - 0.05), end: trim.end });
      else if (d.kind === 'trim-right') setTrim({ start: trim.start, end: clamp(d.startVal + dt, trim.start + 0.05, duration) });
      else if (d.kind === 'seg-resize-left') {
        const seg = segments.find((s) => s.id === d.id);
        if (seg) updateSegment(d.id, { start: clamp(d.startStart + dt, 0, seg.end - 0.05) });
      } else if (d.kind === 'seg-resize-right') {
        const seg = segments.find((s) => s.id === d.id);
        if (seg) updateSegment(d.id, { end: clamp(d.startEnd + dt, seg.start + 0.05, duration) });
      } else if (d.kind === 'seg-move') {
        const len = d.startEnd - d.startStart;
        const newStart = clamp(d.startStart + dt, 0, duration - len);
        updateSegment(d.id, { start: newStart, end: newStart + len });
      }
    };
    const onUp = () => {
      pan.current = null;
      drag.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [pxPerSec, segments, trim.start, trim.end, duration, updateSegment, setTrim]);

  if (!duration || !isFinite(duration)) {
    return <div ref={wrap} className="h-24 border-t border-border bg-surface" />;
  }

  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += tickSpacing) ticks.push(t);

  const startSegDrag = (e: React.MouseEvent, seg: Segment, mode: 'move' | 'left' | 'right') => {
    e.stopPropagation();
    skipNextClick.current = true;
    const x = eventToTrackX(e);
    selectSegment(seg.id);
    if (seg.type === 'zoom') {
      setActiveTab('zoom');
      setZoomTab('segment');
    }
    if (mode === 'left') drag.current = { kind: 'seg-resize-left', id: seg.id, startX: x, startStart: seg.start, startEnd: seg.end };
    else if (mode === 'right') drag.current = { kind: 'seg-resize-right', id: seg.id, startX: x, startStart: seg.start, startEnd: seg.end };
    else drag.current = { kind: 'seg-move', id: seg.id, startX: x, startStart: seg.start, startEnd: seg.end };
  };

  const startTrimDrag = (e: React.MouseEvent, side: 'left' | 'right') => {
    e.stopPropagation();
    skipNextClick.current = true;
    const x = eventToTrackX(e);
    drag.current = side === 'left'
      ? { kind: 'trim-left', startX: x, startVal: trim.start }
      : { kind: 'trim-right', startX: x, startVal: trim.end };
  };

  const onClickBg = (e: React.MouseEvent) => {
    if (skipNextClick.current) {
      skipNextClick.current = false;
      return;
    }
    if (!videoRef.current) return;
    videoRef.current.currentTime = eventToTime(e);
  };

  const onWrapMouseDown = (e: React.MouseEvent) => {
    // Children call stopPropagation on their own mousedowns, so anything
    // reaching us is on the empty background — start tracking a possible
    // pan. The mousemove handler decides pan vs click via PAN_THRESHOLD.
    if (drag.current || !wrap.current) return;
    pan.current = {
      startClientX: e.clientX,
      startScrollLeft: wrap.current.scrollLeft,
      engaged: false,
    };
  };

  return (
    <div
      ref={wrap}
      onMouseDown={onWrapMouseDown}
      onClick={onClickBg}
      className={
        'relative h-28 border-t border-border bg-surface select-none overflow-x-auto overflow-y-hidden no-scrollbar ' +
        (zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer')
      }
    >
      {/* Track: the actual content area. Width = 100% at zoom=1 so there's
          no chance of pixel-rounding overflow; grows with zoom otherwise so
          the wrap can scroll horizontally. */}
      <div className="relative h-full" style={{ width: zoom > 1 ? trackWidth : '100%' }}>
        {/* Ruler */}
        <div className="absolute top-0 left-0 right-0 h-5 border-b border-border pointer-events-none">
          {ticks.map((t) => (
            <div
              key={t}
              className="absolute top-0 bottom-0 border-l border-border-strong text-[9px] text-muted pl-1 font-mono"
              style={{ left: timeToX(t, pxPerSec) }}
            >
              {fmtTime(t).split('.')[0]}
            </div>
          ))}
        </div>

        {/* Video bar */}
        <div className="absolute h-6 rounded-sm bg-accent/30" style={{ top: 22, left: 0, width: trackWidth }} />

        {/* Trim shades */}
        <div className="absolute bg-background/70 pointer-events-none" style={{ top: 22, height: 64, left: 0, width: timeToX(trim.start, pxPerSec) }} />
        <div className="absolute bg-background/70 pointer-events-none" style={{ top: 22, height: 64, left: timeToX(trim.end, pxPerSec), width: Math.max(0, trackWidth - timeToX(trim.end, pxPerSec)) }} />

        {/* Segments */}
        {segments.map((seg) => {
          const left = timeToX(seg.start, pxPerSec);
          const w = Math.max(8, timeToX(seg.end, pxPerSec) - timeToX(seg.start, pxPerSec));
          const color =
            seg.type === 'zoom' ? 'bg-zoom' :
            seg.type === 'speed' ? 'bg-speed' : 'bg-cut';
          const top = seg.type === 'zoom' ? 22 : 46;
          const sel = selectedId === seg.id;
          return (
            <div
              key={seg.id}
              onMouseDown={(e) => startSegDrag(e, seg, 'move')}
              className={`absolute h-6 rounded-sm flex items-center px-1.5 text-[10px] font-medium text-white overflow-hidden whitespace-nowrap cursor-grab ${color} ${sel ? 'outline outline-2 outline-foreground z-10' : ''}`}
              style={{ top, left, width: w }}
            >
              <div onMouseDown={(e) => startSegDrag(e, seg, 'left')} className="absolute left-0 top-0 bottom-0 w-1.5 bg-black/30 cursor-ew-resize" />
              <span className="select-none pointer-events-none mx-2">{segLabel(seg)}</span>
              <div onMouseDown={(e) => startSegDrag(e, seg, 'right')} className="absolute right-0 top-0 bottom-0 w-1.5 bg-black/30 cursor-ew-resize" />
            </div>
          );
        })}

        {/* Click markers from events */}
        {events?.events.map((ev, i) =>
          ev.type === 'click' && ev.t <= duration ? (
            <div
              key={`click-${i}`}
              title={`click @ ${fmtTime(ev.t)}`}
              className="absolute w-1.5 h-1.5 rounded-full bg-success border border-white/80"
              style={{ top: 80, left: timeToX(ev.t, pxPerSec) - 3, boxShadow: '0 0 0 1px var(--color-success)' }}
            />
          ) : null,
        )}

        {/* Trim handles */}
        <div onMouseDown={(e) => startTrimDrag(e, 'left')} className="absolute w-2 bg-foreground/40 cursor-ew-resize z-20 flex items-center justify-center text-[9px] text-white" style={{ top: 22, height: 64, left: timeToX(trim.start, pxPerSec) - 4 }}>⟨</div>
        <div onMouseDown={(e) => startTrimDrag(e, 'right')} className="absolute w-2 bg-foreground/40 cursor-ew-resize z-20 flex items-center justify-center text-[9px] text-white" style={{ top: 22, height: 64, left: timeToX(trim.end, pxPerSec) - 4 }}>⟩</div>

        {/* Playhead — fat invisible hit area, visible line + triangle inside. */}
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
            skipNextClick.current = true;
            drag.current = { kind: 'playhead' };
            if (videoRef.current) videoRef.current.currentTime = eventToTime(e);
          }}
          className="absolute top-0 bottom-0 w-3 cursor-ew-resize z-30"
          style={{ left: timeToX(playhead, pxPerSec) - 6 }}
        >
          <div className="absolute top-0 bottom-0 left-1/2 -ml-px w-0.5 bg-record pointer-events-none" />
          <div
            className="absolute top-0 left-1/2 -ml-2 w-4 h-2.5 bg-record pointer-events-none"
            style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }}
          />
        </div>
      </div>
    </div>
  );
}

function segLabel(seg: Segment) {
  if (seg.type === 'zoom') return `Zoom ${seg.scale.toFixed(1)}×`;
  if (seg.type === 'speed') return `${seg.factor}×`;
  return 'CUT';
}

function timeToX(t: number, pxPerSec: number) {
  return t * pxPerSec;
}

function chooseTickSpacing(dur: number, zoom: number) {
  if (!isFinite(dur) || dur <= 0) return 60;
  const target = dur / zoom / 10;
  for (const c of [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]) if (c >= target) return c;
  return 60;
}
