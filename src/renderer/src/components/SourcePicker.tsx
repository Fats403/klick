import { useMemo, useState } from 'react';
import type { CaptureSource } from '../../../preload/index';

// Thumbnails come straight from klick-capture's `list` output as base64 PNGs,
// so we drop them into <img src> without a fetch.

interface Props {
  sources: CaptureSource[];
  onPick: (source: CaptureSource) => void;
  onClose: () => void;
}

export function SourcePicker({ sources, onPick, onClose }: Props) {
  const { displays, windows } = useMemo(() => {
    const displays = sources.filter((s) => s.kind === 'display');
    const windows = sources.filter((s) => s.kind === 'window');
    return { displays, windows };
  }, [sources]);

  // Default to the tab that has anything in it.
  const [tab, setTab] = useState<'display' | 'window'>(
    displays.length > 0 ? 'display' : 'window',
  );

  const list = tab === 'display' ? displays : windows;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[800px] max-w-[92vw] max-h-[82vh] flex flex-col bg-background border border-border rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Choose what to record</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-foreground text-xs px-2 py-1 rounded hover:bg-foreground/5"
          >
            Cancel
          </button>
        </div>

        <div className="flex gap-1 px-6 pt-4">
          <TabButton
            label={`Screens (${displays.length})`}
            active={tab === 'display'}
            onClick={() => setTab('display')}
          />
          <TabButton
            label={`Windows (${windows.length})`}
            active={tab === 'window'}
            onClick={() => setTab('window')}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {list.length === 0 ? (
            <div className="text-center text-muted text-xs py-16">
              No {tab === 'display' ? 'displays' : 'windows'} available.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {list.map((src) => (
                <SourceCard key={src.id} source={src} onPick={onPick} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
        active
          ? 'bg-foreground/10 text-foreground'
          : 'text-muted hover:text-foreground hover:bg-foreground/5'
      }`}
    >
      {label}
    </button>
  );
}

function SourceCard({
  source,
  onPick,
}: {
  source: CaptureSource;
  onPick: (s: CaptureSource) => void;
}) {
  return (
    <button
      onClick={() => onPick(source)}
      // min-w-0 prevents the button (a grid item) from expanding past its
      // column to fit a long source name. Without it, .truncate inside has
      // no width constraint to clip against and the text bleeds horizontally.
      className="group min-w-0 flex flex-col gap-2 p-2 rounded-lg border border-border bg-foreground/[0.02] hover:bg-foreground/5 hover:border-foreground/20 transition-colors text-left"
    >
      <div className="aspect-[16/10] w-full rounded-md overflow-hidden bg-black/40 flex items-center justify-center">
        {source.thumbnail ? (
          <img
            src={source.thumbnail}
            alt={source.name}
            className="w-full h-full object-contain"
          />
        ) : (
          <span className="text-[10px] text-muted">no preview</span>
        )}
      </div>
      <div className="w-full px-1 pb-1 min-w-0">
        <div className="text-xs text-foreground truncate">{source.name}</div>
        <div className="text-[10px] text-muted mt-0.5">
          {source.width}×{source.height}
        </div>
      </div>
    </button>
  );
}
