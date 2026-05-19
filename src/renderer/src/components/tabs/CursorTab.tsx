import { useEditor, type ClickAnimationStyle, type CursorStyle } from '../../store';
import { Field, Row, Section, Toggle } from '../ui/Field';

// Everything that's drawn over the recording to make a demo readable: the
// custom cursor, click animations, and how the zoom camera tracks the
// recorded cursor.
export function CursorTab() {
  const cursorCfg = useEditor((s) => s.cursor);
  const setCursor = useEditor((s) => s.setCursor);
  const cursorSmoothing = useEditor((s) => s.cursorSmoothing);
  const setCursorSmoothing = useEditor((s) => s.setCursorSmoothing);
  const clickAnim = useEditor((s) => s.clickAnimation);
  const setClickAnimation = useEditor((s) => s.setClickAnimation);

  return (
    <div className="p-4">
      <Section title="Cursor">
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
              <div className="grid grid-cols-3 gap-1.5">
                {(['default', 'pointer', 'dot', 'ring', 'crosshair'] as Exclude<CursorStyle, 'none'>[]).map((s) => (
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
            {(cursorCfg.style === 'default' || cursorCfg.style === 'pointer') && (
              <Row>
                <span className="text-xs text-muted">Outline</span>
                <input
                  type="color"
                  value={cursorCfg.outlineColor}
                  onChange={(e) => setCursor({ outlineColor: e.target.value })}
                  className="w-7 h-7 rounded-md border border-border bg-transparent cursor-pointer"
                />
              </Row>
            )}
            <Field label={`Size · ${cursorCfg.size}px`}>
              <input
                type="range"
                min={12} max={120} step={2}
                value={cursorCfg.size}
                onChange={(e) => setCursor({ size: parseInt(e.target.value) })}
                className="w-full accent-accent"
              />
            </Field>
          </>
        )}
      </Section>

      <Section title="Zoom follow">
        <Row>
          <span className="text-xs">Smooth follow</span>
          <Toggle checked={cursorSmoothing} onChange={setCursorSmoothing} />
        </Row>
        <div className="text-[11px] text-muted">Eases the zoom camera toward the cursor instead of snapping every frame.</div>
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
