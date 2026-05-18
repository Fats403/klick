import { Circle, Film, FolderOpen } from 'lucide-react';

interface Props {
  onRecord: () => void;
  onOpenVideo: () => void;
  onOpenProject: () => void;
}

export function EmptyState({ onRecord, onOpenVideo, onOpenProject }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center p-12">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl w-full">
        <Card onClick={onRecord} Icon={Circle} title="New recording" subtitle="Pick a screen or window" highlight />
        <Card onClick={onOpenVideo} Icon={Film} title="Open a video" subtitle="Add zoom + speed in post" />
        <Card onClick={onOpenProject} Icon={FolderOpen} title="Open project" subtitle="Continue a saved session" />
      </div>
    </div>
  );
}

function Card({
  onClick, Icon, title, subtitle, highlight,
}: {
  onClick: () => void;
  Icon: typeof Circle;
  title: string;
  subtitle: string;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'group p-6 rounded-xl border bg-surface text-left transition-all hover:bg-surface-elevated ' +
        (highlight ? 'border-accent/40 hover:border-accent' : 'border-border-strong hover:border-border-strong')
      }
    >
      <div
        className={
          'w-10 h-10 rounded-lg flex items-center justify-center mb-3 ' +
          (highlight ? 'bg-record/15 text-record' : 'bg-surface-elevated text-muted')
        }
      >
        <Icon className={'w-5 h-5 ' + (highlight ? 'fill-current' : '')} />
      </div>
      <div className="font-medium mb-0.5">{title}</div>
      <div className="text-xs text-muted">{subtitle}</div>
    </button>
  );
}
