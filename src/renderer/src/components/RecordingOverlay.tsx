import { Button } from './ui/Button';

interface Props {
  elapsedLabel: string;
  log: string;
  onStop: () => void;
  stopping: boolean;
}

export function RecordingOverlay({ elapsedLabel, log, onStop, stopping }: Props) {
  return (
    <div className="fixed bottom-6 right-6 z-50 bg-surface-elevated border border-border rounded-xl shadow-2xl w-80 p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-record animate-pulse" />
        <span className="text-sm font-medium">Recording</span>
        <span className="ml-auto font-mono text-xs text-muted">{stopping ? 'Saving…' : elapsedLabel}</span>
      </div>
      <pre className="bg-background border border-border rounded-md p-2 text-[10px] text-muted max-h-32 overflow-auto whitespace-pre-wrap leading-tight">
        {log || 'Capturing screen + cursor events…'}
      </pre>
      <Button onClick={onStop} variant="record" disabled={stopping} className="w-full">
        {stopping ? 'Saving…' : 'Stop recording'}
      </Button>
    </div>
  );
}
