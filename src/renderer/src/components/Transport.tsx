import { useEffect, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { videoRef } from '../hooks/videoRef';
import { useEditor } from '../store';
import { fmtTime } from '../lib/format';

export function Transport() {
  const duration = useEditor((s) => s.videoDuration);
  const trim = useEditor((s) => s.trim);
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  // Ref so the RAF closure reads the live value. useState here caused a
  // stale-closure race where the tick kept syncing from videoRef while the
  // user was already dragging, snapping the slider.
  const scrubbing = useRef(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [duration]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (videoRef.current && !scrubbing.current) setTime(videoRef.current.currentTime);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toggle = () => {
    const v = videoRef.current;
    if (!v || !duration) return;
    if (v.paused) v.play(); else v.pause();
  };

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    const t = (parseFloat(e.target.value) / 1000) * duration;
    setTime(t);
    v.currentTime = t;
  };

  const display = duration
    ? `${fmtTime(time)} / ${fmtTime(trim.end - trim.start)}`
    : '00:00.00 / 00:00.00';

  return (
    <div className="h-10 flex items-center gap-3 px-4 border-t border-border bg-surface text-xs">
      <button
        onClick={toggle}
        className="w-7 h-7 rounded-md flex items-center justify-center text-muted hover:text-foreground hover:bg-surface-elevated"
        disabled={!duration}
      >
        {paused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
      </button>
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        value={duration ? (time / duration) * 1000 : 0}
        onChange={onSeek}
        onPointerDown={() => { scrubbing.current = true; }}
        onPointerUp={() => { scrubbing.current = false; }}
        onPointerCancel={() => { scrubbing.current = false; }}
        className="flex-1 accent-accent"
      />
      <span className="font-mono text-muted min-w-[110px] text-right">{display}</span>
    </div>
  );
}
