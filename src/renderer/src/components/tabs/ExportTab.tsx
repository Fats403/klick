import { useEditor, type ExportQuality } from '../../store';
import { Field, Section } from '../ui/Field';

const QUALITY_OPTIONS: Array<{ value: ExportQuality; label: string; hint: string }> = [
  { value: 'high',     label: 'High',     hint: 'Visually lossless. Larger file.' },
  { value: 'balanced', label: 'Balanced', hint: 'Roughly half the size. Hard to tell apart.' },
  { value: 'fast',     label: 'Fast',     hint: 'Smallest + fastest. Some compression artifacts.' },
];

export function ExportTab() {
  const outputName = useEditor((s) => s.outputName);
  const setOutputName = useEditor((s) => s.setOutputName);
  const exportQuality = useEditor((s) => s.exportQuality);
  const setExportQuality = useEditor((s) => s.setExportQuality);

  const activeHint = QUALITY_OPTIONS.find((o) => o.value === exportQuality)?.hint ?? '';

  return (
    <div className="p-4">
      <Section title="Export">
        <Field label="Output filename">
          <input
            type="text"
            value={outputName}
            onChange={(e) => setOutputName(e.target.value || 'demo.mp4')}
            className="w-full bg-background border border-border-strong rounded-md px-2.5 py-1.5 text-xs"
          />
        </Field>
        <Field label="Quality">
          <div className="grid grid-cols-3 gap-1.5">
            {QUALITY_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setExportQuality(o.value)}
                className={
                  'px-2 py-1.5 rounded-md text-[11px] border transition-colors ' +
                  (exportQuality === o.value
                    ? 'bg-accent/15 text-accent border-accent/40'
                    : 'text-muted hover:text-foreground border-border')
                }
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="text-[11px] text-muted mt-1.5">{activeHint}</div>
        </Field>
        <p className="text-[11px] text-muted mt-4">Press Export in the title bar to render. Requires ffmpeg on your PATH.</p>
      </Section>
    </div>
  );
}
