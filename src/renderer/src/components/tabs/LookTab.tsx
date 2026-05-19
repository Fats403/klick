import { Link, Unlink } from 'lucide-react';
import { useEditor, type AspectRatio } from '../../store';
import { Field, NumberInput, Row, Section, Select } from '../ui/Field';

const PRESET_COLORS = ['#0f172a', '#1e293b', '#000000', '#ffffff', '#1d4ed8', '#7c3aed', '#db2777', '#16a34a'];

// Video-level visual styling: bg frame, padding, corner radius, aspect ratio.
// Things that change how the recorded pixels are presented inside the export
// canvas. Per-segment styling (zoom, speed, cuts) is in the Zoom tab and on
// the timeline.
export function LookTab() {
  const bg = useEditor((s) => s.background);
  const setBackground = useEditor((s) => s.setBackground);
  const setPadding = useEditor((s) => s.setPadding);
  const setPaddingAll = useEditor((s) => s.setPaddingAll);
  const setPaddingLinked = useEditor((s) => s.setPaddingLinked);
  const aspect = useEditor((s) => s.aspect);
  const setAspect = useEditor((s) => s.setAspect);

  return (
    <div className="p-4">
      <Section title="Background">
        <Field label="Color">
          <div className="flex flex-wrap gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setBackground({ color: c })}
                className={`w-7 h-7 rounded-md border-2 ${bg.color === c ? 'border-foreground' : 'border-border'}`}
                style={{ background: c }}
                title={c}
              />
            ))}
            <input
              type="color"
              value={bg.color}
              onChange={(e) => setBackground({ color: e.target.value })}
              className="w-7 h-7 rounded-md border border-border bg-transparent cursor-pointer"
            />
          </div>
        </Field>
        <Field label="Padding">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-muted">{bg.paddingLinked ? 'All sides' : 'Per side'}</span>
            <button
              onClick={() => setPaddingLinked(!bg.paddingLinked)}
              title={bg.paddingLinked ? 'Unlink sides' : 'Link sides'}
              className={
                'w-6 h-6 rounded-md flex items-center justify-center transition-colors ' +
                (bg.paddingLinked
                  ? 'bg-accent/15 text-accent border border-accent/40'
                  : 'text-muted hover:text-foreground border border-border')
              }
            >
              {bg.paddingLinked ? <Link className="w-3 h-3" /> : <Unlink className="w-3 h-3" />}
            </button>
          </div>
          {bg.paddingLinked ? (
            <NumberInput value={bg.padding.top} min={-400} max={400} onChange={setPaddingAll} />
          ) : (
            <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 items-center">
              <PaddingLabel side="Top" />
              <NumberInput value={bg.padding.top} min={-400} max={400} onChange={(n) => setPadding({ top: n })} />
              <PaddingLabel side="Right" />
              <NumberInput value={bg.padding.right} min={-400} max={400} onChange={(n) => setPadding({ right: n })} />
              <PaddingLabel side="Bottom" />
              <NumberInput value={bg.padding.bottom} min={-400} max={400} onChange={(n) => setPadding({ bottom: n })} />
              <PaddingLabel side="Left" />
              <NumberInput value={bg.padding.left} min={-400} max={400} onChange={(n) => setPadding({ left: n })} />
            </div>
          )}
          <div className="text-[11px] text-muted mt-1.5">Negative values crop the recording on that side.</div>
        </Field>
        <Row>
          <span className="text-xs text-muted">Corner radius</span>
          <NumberInput value={bg.radius} min={0} max={80} onChange={(n) => setBackground({ radius: n })} />
        </Row>
      </Section>

      <Section title="Aspect ratio">
        <Row>
          <span className="text-xs text-muted">Output</span>
          <Select<AspectRatio>
            value={aspect}
            onChange={setAspect}
            options={[
              { value: 'native', label: 'Native' },
              { value: '16:9', label: '16:9' },
              { value: '9:16', label: '9:16 (vertical)' },
              { value: '1:1', label: '1:1' },
              { value: '4:5', label: '4:5' },
            ]}
          />
        </Row>
      </Section>
    </div>
  );
}

function PaddingLabel({ side }: { side: string }) {
  return <span className="text-[11px] text-muted">{side}</span>;
}
