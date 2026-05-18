import { Plus, Scissors, Gauge, Trash2, SplitSquareHorizontal, RotateCcw, ZoomIn } from 'lucide-react';
import { useEditor } from '../store';
import { videoRef } from '../hooks/videoRef';
import { Button } from './ui/Button';

export function Toolbar() {
  const segments = useEditor((s) => s.segments);
  const selectedId = useEditor((s) => s.selectedSegmentId);
  const addSegment = useEditor((s) => s.addSegment);
  const removeSegment = useEditor((s) => s.removeSegment);
  const splitSegment = useEditor((s) => s.splitSegment);
  const resetTimeline = useEditor((s) => s.resetTimeline);
  const videoWidth = useEditor((s) => s.videoWidth);
  const videoHeight = useEditor((s) => s.videoHeight);
  const duration = useEditor((s) => s.videoDuration);
  const timelineZoom = useEditor((s) => s.timelineZoom);
  const setTimelineZoom = useEditor((s) => s.setTimelineZoom);

  const at = () => videoRef.current?.currentTime ?? 0;

  return (
    <div className="h-11 flex items-center gap-1.5 px-4 border-t border-border bg-surface">
      <Button onClick={() => addSegment('zoom', at(), { width: videoWidth, height: videoHeight })} variant="ghost" size="sm" disabled={!duration}>
        <ZoomIn className="w-3.5 h-3.5" /> Zoom
      </Button>
      <Button onClick={() => addSegment('speed', at(), { width: videoWidth, height: videoHeight })} variant="ghost" size="sm" disabled={!duration}>
        <Gauge className="w-3.5 h-3.5" /> Speed
      </Button>
      <Button onClick={() => addSegment('cut', at(), { width: videoWidth, height: videoHeight })} variant="ghost" size="sm" disabled={!duration}>
        <Scissors className="w-3.5 h-3.5" /> Cut
      </Button>

      <div className="w-px h-5 bg-border mx-1" />

      <Button
        onClick={() => selectedId && splitSegment(selectedId, at())}
        variant="ghost"
        size="sm"
        disabled={!selectedId}
      >
        <SplitSquareHorizontal className="w-3.5 h-3.5" /> Split
      </Button>
      <Button
        onClick={() => selectedId && removeSegment(selectedId)}
        variant="ghost"
        size="sm"
        disabled={!selectedId}
      >
        <Trash2 className="w-3.5 h-3.5" /> Delete
      </Button>
      <Button onClick={resetTimeline} variant="ghost" size="sm" disabled={!segments.length}>
        <RotateCcw className="w-3.5 h-3.5" /> Reset
      </Button>

      <div className="flex-1" />

      <label className="text-[11px] text-muted mr-1">Zoom</label>
      <input
        type="range"
        min={1}
        max={10}
        step={0.5}
        value={timelineZoom}
        onChange={(e) => setTimelineZoom(parseFloat(e.target.value))}
        className="w-28 accent-accent"
      />
    </div>
  );
}
