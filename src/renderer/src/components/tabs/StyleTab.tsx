import { Link, Unlink } from 'lucide-react';
import { useEditor, type AspectRatio, type ClickAnimationStyle, type CursorStyle } from '../../store';
import { Field, NumberInput, Row, Section, Select, Toggle } from '../ui/Field';

const PRESET_COLORS = ['#0f172a', '#1e293b', '#000000', '#ffffff', '#1d4ed8', '#7c3aed', '#db2777', '#16a34a'];

export function StyleTab() {
  const bg = useEditor((s) => s.background);
  const setBackground = useEditor((s) => s.setBackground);
  const setPadding = useEditor((s) => s.setPadding);
  const setPaddingAll = useEditor((s) => s.setPaddingAll);
  const setPaddingLinked = useEditor((s) => s.setPaddingLinked);
  const aspect = useEditor((s) => s.aspect);
  const setAspect = useEditor((s) => s.setAspect);
  const cursorSmoothing = useEditor((s) => s.cursorSmoothing);
  const setCursorSmoothing = useEditor((s) => s.setCursorSmoothing);
  const cursorCfg = useEditor((s) => s.cursor);
  const setCursor = useEditor((s) => s.setCursor);
  const clickAnim = useEditor((s) => s.clickAnimation);
  const setClickAnimation = useEditor((s) => s.setClickAnimation);

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

      <Section title="Cursor">
        <Row>
          <span className="text-xs">Smooth follow</span>
          <Toggle checked={cursorSmoothing} onChange={setCursorSmoothing} />
        </Row>
        <div className="text-[11px] text-muted">Eases the zoom camera toward the cursor instead of snapping every frame.</div>
      </Section>

      <Section title="Custom cursor">
        <Row>
          <span className="text-xs">Enabled</span>
          <Toggle checked={cursorCfg.enabled} onChange={(b) => setCursor({ enabled: b })} />
        </Row>
        <div className="text-[11px] text-muted">
          Custom pointer drawn over the recording. The OS cursor is excluded from capture, so this is the only cursor that appears in the final video.
        </div>
        {cursorCfg.enabled && (
          <>
            <Field label="Style">
              <div className="grid grid-cols-2 gap-1.5">
                {(['default', 'dot'] as Exclude<CursorStyle, 'none'>[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setCursor({ style: s })}
                    className={
                      'px-2 py-1.5 rounded-md text-[11px] capitalize border transition-colors ' +
                      (cursorCfg.style === s
                        ? 'bg-accent/15 text-accent border-accent/40'
                        : 'text-muted hover:text-foreground border-border')
                    }
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Field>
            <Row>
              <span className="text-xs text-muted">Color</span>
              <input
                type="color"
                value={cursorCfg.color}
                onChange={(e) => setCursor({ color: e.target.value })}
                className="w-7 h-7 rounded-md border border-border bg-transparent cursor-pointer"
              />
            </Row>
            <Field label={`Size · ${cursorCfg.size}px`}>
              <input
                type="range"
                min={12} max={80} step={2}
                value={cursorCfg.size}
                onChange={(e) => setCursor({ size: parseInt(e.target.value) })}
                className="w-full accent-accent"
              />
            </Field>
          </>
        )}
      </Section>

      <Section title="Click animation">
        <Row>
          <span className="text-xs">Enabled</span>
          <Toggle checked={clickAnim.enabled} onChange={(b) => setClickAnimation({ enabled: b })} />
        </Row>
        {clickAnim.enabled && (
          <>
            <Field label="Style">
              <div className="grid grid-cols-3 gap-1.5">
                {(['ring', 'pulse', 'halo'] as ClickAnimationStyle[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setClickAnimation({ style: s })}
                    className={
                      'px-2 py-1.5 rounded-md text-[11px] capitalize border transition-colors ' +
                      (clickAnim.style === s
                        ? 'bg-accent/15 text-accent border-accent/40'
                        : 'text-muted hover:text-foreground border-border')
                    }
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Field>
            <Row>
              <span className="text-xs text-muted">Color</span>
              <input
                type="color"
                value={clickAnim.color}
                onChange={(e) => setClickAnimation({ color: e.target.value })}
                className="w-7 h-7 rounded-md border border-border bg-transparent cursor-pointer"
              />
            </Row>
            <Field label={`Size · ${clickAnim.size}px`}>
              <input
                type="range"
                min={20} max={200} step={5}
                value={clickAnim.size}
                onChange={(e) => setClickAnimation({ size: parseInt(e.target.value) })}
                className="w-full accent-accent"
              />
            </Field>
            <Field label={`Duration · ${clickAnim.duration.toFixed(2)}s`}>
              <input
                type="range"
                min={0.2} max={1.5} step={0.05}
                value={clickAnim.duration}
                onChange={(e) => setClickAnimation({ duration: parseFloat(e.target.value) })}
                className="w-full accent-accent"
              />
            </Field>
          </>
        )}
      </Section>
    </div>
  );
}

function PaddingLabel({ side }: { side: string }) {
  return <span className="text-[11px] text-muted">{side}</span>;
}
