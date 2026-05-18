import { useEditor, type ZoomSegment } from '../../store';
import { Field, Section, Toggle } from '../ui/Field';

export function ZoomTab() {
  const zoomTab = useEditor((s) => s.zoomTab);
  const setZoomTab = useEditor((s) => s.setZoomTab);

  return (
    <div className="p-4">
      <div className="flex p-0.5 bg-background border border-border-strong rounded-md mb-4">
        <TabPill active={zoomTab === 'segment'} onClick={() => setZoomTab('segment')}>Segment</TabPill>
        <TabPill active={zoomTab === 'global'} onClick={() => setZoomTab('global')}>Global</TabPill>
      </div>
      {zoomTab === 'segment' ? <SegmentZoom /> : <GlobalZoom />}
    </div>
  );
}

function TabPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        'flex-1 text-xs h-7 rounded-sm font-medium transition-colors ' +
        (active ? 'bg-accent text-white' : 'text-muted hover:text-foreground')
      }
    >
      {children}
    </button>
  );
}

function SegmentZoom() {
  const segments = useEditor((s) => s.segments);
  const selectedId = useEditor((s) => s.selectedSegmentId);
  const updateSegment = useEditor((s) => s.updateSegment);
  const selected = segments.find((s) => s.id === selectedId);

  if (!selected || selected.type !== 'zoom') {
    return (
      <p className="text-xs text-muted leading-relaxed">
        Add a Zoom segment from the toolbar, or click an existing one on the timeline. Each segment can either follow the recorded cursor or stay locked on a fixed point.
      </p>
    );
  }
  return <ZoomEditor zoom={selected} onChange={(p) => updateSegment(selected.id, p)} />;
}

function ZoomEditor({ zoom, onChange }: { zoom: ZoomSegment; onChange: (p: Partial<ZoomSegment>) => void }) {
  return (
    <>
      <Section title="Position">
        <div className="flex p-0.5 bg-background border border-border-strong rounded-md mb-2">
          <PositionPill active={zoom.followCursor} onClick={() => onChange({ followCursor: true })}>Follow cursor</PositionPill>
          <PositionPill active={!zoom.followCursor} onClick={() => onChange({ followCursor: false })}>Fixed</PositionPill>
        </div>
        {zoom.followCursor ? (
          <p className="text-[11px] text-muted">Tracks the recorded cursor through this segment.</p>
        ) : (
          <Field label="Center" hint="Pixel coordinates in the source video">
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                value={Math.round(zoom.x)}
                onChange={(e) => onChange({ x: parseFloat(e.target.value) || 0 })}
                className="bg-background border border-border-strong rounded-md px-2 py-1 text-xs font-mono"
              />
              <input
                type="number"
                value={Math.round(zoom.y)}
                onChange={(e) => onChange({ y: parseFloat(e.target.value) || 0 })}
                className="bg-background border border-border-strong rounded-md px-2 py-1 text-xs font-mono"
              />
            </div>
          </Field>
        )}
      </Section>

      <Section title="Depth">
        <Field label="Scale">
          <SliderRow value={zoom.scale} min={1} max={4} step={0.1} onChange={(v) => onChange({ scale: v })} formatter={(v) => `${v.toFixed(1)}×`} />
        </Field>
        <Field label="Ease (seconds)">
          <SliderRow value={zoom.ease} min={0} max={2} step={0.05} onChange={(v) => onChange({ ease: v })} formatter={(v) => `${v.toFixed(2)}s`} />
        </Field>
      </Section>
    </>
  );
}

function GlobalZoom() {
  const cfg = useEditor((s) => s.globalZoom);
  const setGlobalZoom = useEditor((s) => s.setGlobalZoom);

  return (
    <>
      <Section title="Global zoom">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs">Enabled</span>
          <Toggle checked={cfg.enabled} onChange={(b) => setGlobalZoom({ enabled: b })} />
        </div>
        <p className="text-[11px] text-muted">When on, the whole video is slightly zoomed in and follows the recorded cursor. Segments still take over their time range.</p>
      </Section>

      <Section title="Depth">
        <Field label="Scale">
          <SliderRow
            value={cfg.scale}
            min={1}
            max={2}
            step={0.05}
            onChange={(v) => setGlobalZoom({ scale: v })}
            formatter={(v) => `${v.toFixed(2)}×`}
          />
        </Field>
      </Section>
    </>
  );
}

function PositionPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        'flex-1 text-[11px] h-7 rounded-sm font-medium transition-colors ' +
        (active ? 'bg-surface-elevated text-foreground border border-border-strong' : 'text-muted hover:text-foreground')
      }
    >
      {children}
    </button>
  );
}

function SliderRow({
  value, min, max, step, onChange, formatter,
}: {
  value: number; min: number; max: number; step: number; onChange: (n: number) => void; formatter: (n: number) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 accent-accent"
      />
      <span className="text-xs font-mono w-12 text-right">{formatter(value)}</span>
    </div>
  );
}
