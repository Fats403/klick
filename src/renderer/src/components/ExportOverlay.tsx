import { useEffect, useState } from 'react';
import { useEditor } from '../store';
import { Button } from './ui/Button';

interface Props {
  onClose: () => void;
}

export function ExportOverlay({ onClose }: Props) {
  const videoPath = useEditor((s) => s.videoPath);
  const toProject = useEditor((s) => s.toProject);
  const outputName = useEditor((s) => s.outputName);

  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [log, setLog] = useState('');
  const [outPath, setOutPath] = useState<string | null>(null);
  const [stderr, setStderr] = useState('');

  useEffect(() => {
    if (!videoPath) { onClose(); return; }
    let cancelled = false;
    let unsub: (() => void) | null = null;

    (async () => {
      const dest = await window.api.saveExport(outputName);
      if (!dest) { if (!cancelled) onClose(); return; }
      setStatus('running');
      setOutPath(dest);

      unsub = window.api.onExportLog((text) => {
        setLog((s) => s + text);
      });

      const result = await window.api.runExport({
        projectJson: toProject(),
        videoPath,
        outPath: dest,
      });
      if (cancelled) return;
      if (result.error) {
        setLog((s) => s + `\n✗ ${result.error}\n`);
        setStatus('error');
        setStderr(result.error + (result.stderr ? `\n${result.stderr}` : ''));
      } else {
        setLog((s) => s + `\n✓ Export complete — ${dest}\n`);
        setStatus('done');
      }
    })().catch((err) => {
      if (!cancelled) {
        setLog((s) => s + `\n✗ ${(err as Error).message}\n`);
        setStatus('error');
        setStderr((err as Error).message);
      }
    });

    return () => { cancelled = true; unsub?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title =
    status === 'idle' ? 'Preparing…' :
    status === 'running' ? 'Exporting…' :
    status === 'done' ? 'Export complete' :
    'Export failed';

  const handleClose = () => {
    if (status === 'running') {
      window.api.cancelExport();
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm">
      <div className="bg-surface-elevated border border-border rounded-xl w-[min(560px,90vw)] shadow-2xl p-5">
        <h2 className="text-base font-semibold mb-1">{title}</h2>
        <p className="text-xs text-muted mb-3">Encoding with ffmpeg.</p>
        <pre className="bg-background border border-border rounded-md p-2 text-[10px] text-muted max-h-56 overflow-auto whitespace-pre-wrap leading-tight">
          {log || (status === 'idle' ? 'Choose a destination…' : '...')}
          {stderr && '\n\n[error]\n' + stderr}
        </pre>
        <div className="flex justify-end gap-2 mt-3">
          {status === 'done' && outPath && (
            <Button variant="secondary" size="sm" onClick={() => window.api.revealInFinder(outPath)}>Show in Finder</Button>
          )}
          <Button onClick={handleClose} variant={status === 'done' ? 'primary' : 'ghost'} size="sm">
            {status === 'running' ? 'Cancel' : 'Close'}
          </Button>
        </div>
      </div>
    </div>
  );
}
