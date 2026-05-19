import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, XCircle, ChevronDown, ChevronRight, Folder, Copy, ExternalLink, RotateCcw } from 'lucide-react';
import { useEditor } from '../store';
import { Button } from './ui/Button';

const ISSUES_URL = 'https://github.com/Fats403/klick/issues/new';

interface Props {
  onClose: () => void;
}

type Status = 'idle' | 'running' | 'done' | 'error';

export function ExportOverlay({ onClose }: Props) {
  const videoPath = useEditor((s) => s.videoPath);
  const toProject = useEditor((s) => s.toProject);
  const outputName = useEditor((s) => s.outputName);

  const [status, setStatus] = useState<Status>('idle');
  const [outPath, setOutPath] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorLog, setErrorLog] = useState('');
  // Live log buffer kept only so we can attach the tail to error reports.
  // Not rendered during the running state — most users don't care about
  // ffmpeg's output unless something failed.
  const logBuf = useRef('');

  useEffect(() => {
    if (!videoPath) { onClose(); return; }
    let cancelled = false;
    let unsub: (() => void) | null = null;

    (async () => {
      const dest = await window.api.saveExport(outputName);
      if (!dest) { if (!cancelled) onClose(); return; }
      setOutPath(dest);
      setStatus('running');

      unsub = window.api.onExportLog((text) => { logBuf.current += text; });

      const result = await window.api.runExport({
        projectJson: toProject(),
        videoPath,
        outPath: dest,
      });
      if (cancelled) return;
      if (result.error) {
        setErrorMessage(result.error);
        setErrorLog(combineLog(logBuf.current, result.stderr));
        setStatus('error');
      } else {
        setStatus('done');
      }
    })().catch((err) => {
      if (!cancelled) {
        setErrorMessage((err as Error).message);
        setErrorLog(combineLog(logBuf.current));
        setStatus('error');
      }
    });

    return () => { cancelled = true; unsub?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    if (status === 'running') window.api.cancelExport();
    onClose();
  };

  const handleRetry = () => {
    if (!videoPath || !outPath) return;
    setStatus('running');
    setErrorMessage('');
    setErrorLog('');
    logBuf.current = '';
    const unsub = window.api.onExportLog((text) => { logBuf.current += text; });
    window.api.runExport({
      projectJson: toProject(),
      videoPath,
      outPath,
    }).then((result) => {
      unsub();
      if (result.error) {
        setErrorMessage(result.error);
        setErrorLog(combineLog(logBuf.current, result.stderr));
        setStatus('error');
      } else {
        setStatus('done');
      }
    }).catch((err) => {
      unsub();
      setErrorMessage((err as Error).message);
      setErrorLog(combineLog(logBuf.current));
      setStatus('error');
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-xl w-[min(480px,92vw)] shadow-2xl">
        {status === 'running' && (
          <RunningView outPath={outPath} onCancel={handleClose} />
        )}
        {status === 'done' && outPath && (
          <DoneView outPath={outPath} onClose={onClose} />
        )}
        {status === 'error' && (
          <ErrorView
            message={errorMessage}
            log={errorLog}
            onClose={onClose}
            onRetry={outPath ? handleRetry : undefined}
          />
        )}
        {status === 'idle' && <IdleView />}
      </div>
    </div>
  );
}

function IdleView() {
  return (
    <div className="px-6 py-8 text-center">
      <Loader2 className="w-5 h-5 text-muted animate-spin mx-auto mb-3" />
      <div className="text-sm text-muted">Choose a destination…</div>
    </div>
  );
}

function RunningView({ outPath, onCancel }: { outPath: string | null; onCancel: () => void }) {
  return (
    <div className="px-6 py-6">
      <div className="flex items-center gap-2.5 mb-1">
        <Loader2 className="w-4 h-4 text-accent animate-spin" />
        <h2 className="text-sm font-semibold">Exporting your video</h2>
      </div>
      <p className="text-xs text-muted mb-5 truncate">
        {outPath ? filename(outPath) : 'Encoding with ffmpeg.'}
      </p>
      <div className="h-1.5 bg-border/60 rounded-full overflow-hidden relative">
        <div className="absolute inset-y-0 left-0 w-1/3 bg-accent rounded-full indeterminate-bar" />
      </div>
      <p className="text-[11px] text-muted mt-3">
        This usually takes a few seconds. Don't close the app.
      </p>
      <div className="flex justify-end mt-5">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function DoneView({ outPath, onClose }: { outPath: string; onClose: () => void }) {
  return (
    <div className="px-6 py-6">
      <div className="flex items-center gap-2.5 mb-1">
        <CheckCircle2 className="w-5 h-5 text-success" />
        <h2 className="text-sm font-semibold">Export complete</h2>
      </div>
      <p className="text-xs text-muted mb-5 break-all">
        Saved to <span className="text-foreground">{outPath}</span>
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => window.api.revealInFinder(outPath)}>
          <Folder className="w-3.5 h-3.5" /> Show in Finder
        </Button>
        <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

function ErrorView({
  message,
  log,
  onClose,
  onRetry,
}: {
  message: string;
  log: string;
  onClose: () => void;
  onRetry?: () => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyDetails = async () => {
    const body = `Error: ${message}\n\n---\n${log || '(no log captured)'}`;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — fail silently */ }
  };

  const openIssue = () => {
    // Pre-fill the title; body is kept short because the URL itself has a
    // length limit. The user pastes the technical details from clipboard
    // into the body once GitHub opens.
    const title = encodeURIComponent('Export failed');
    const body = encodeURIComponent(
      `**Error**\n\`\`\`\n${message}\n\`\`\`\n\n` +
      `**Technical details** (paste from clipboard — they were copied to it):\n\n`,
    );
    copyDetails();
    window.api.openExternal(`${ISSUES_URL}?title=${title}&body=${body}`);
  };

  return (
    <div className="px-6 py-6">
      <div className="flex items-center gap-2.5 mb-1">
        <XCircle className="w-5 h-5 text-record" />
        <h2 className="text-sm font-semibold">Export failed</h2>
      </div>
      <p className="text-xs text-muted mb-4">
        {message || 'Something went wrong during encoding.'}
      </p>

      <button
        type="button"
        onClick={() => setLogOpen((b) => !b)}
        className="text-xs text-muted hover:text-foreground flex items-center gap-1"
      >
        {logOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Technical details
      </button>
      {logOpen && (
        <pre className="bg-background border border-border rounded-md p-2 mt-2 text-[10px] text-muted max-h-48 overflow-auto whitespace-pre-wrap leading-tight">
          {log || '(no log captured)'}
        </pre>
      )}

      <div className="flex justify-end gap-2 mt-5 flex-wrap">
        <Button variant="ghost" size="sm" onClick={copyDetails}>
          <Copy className="w-3.5 h-3.5" /> {copied ? 'Copied' : 'Copy details'}
        </Button>
        <Button variant="ghost" size="sm" onClick={openIssue}>
          <ExternalLink className="w-3.5 h-3.5" /> Report issue
        </Button>
        {onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RotateCcw className="w-3.5 h-3.5" /> Try again
          </Button>
        )}
        <Button variant="primary" size="sm" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

function filename(p: string): string {
  return p.split('/').pop() ?? p;
}

// Trim the captured log to the most useful tail. ffmpeg outputs thousands of
// progress lines; only the last ~80 are meaningful when something dies.
function combineLog(buffer: string, stderr?: string): string {
  const parts: string[] = [];
  if (buffer.trim()) {
    const lines = buffer.split('\n');
    parts.push(lines.slice(-80).join('\n').trimEnd());
  }
  if (stderr?.trim() && stderr.trim() !== buffer.trim()) {
    parts.push(`[stderr]\n${stderr.trim()}`);
  }
  return parts.join('\n\n');
}
