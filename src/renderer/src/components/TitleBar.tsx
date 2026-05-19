import { Circle, FilePlus, FolderOpen, Save, Upload } from 'lucide-react';
import { useEditor } from '../store';
import { Button } from './ui/Button';

interface Props {
  onRecord: () => void;
  onExport: () => void;
  onOpenVideo: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
}

export function TitleBar({ onRecord, onExport, onOpenVideo, onOpenProject, onSaveProject }: Props) {
  const videoName = useEditor((s) => s.videoName);
  const videoPath = useEditor((s) => s.videoPath);
  // Save / Export only make sense once there's a recording loaded.
  const hasVideo = videoPath !== null;

  return (
    <header className="drag-region h-12 flex items-center px-3 border-b border-border bg-surface">
      {/* Reserve space for macOS traffic lights */}
      <div className="w-20" />
      <div className="no-drag-region flex items-center gap-2">
        <span className="text-sm font-semibold tracking-tight mr-2">Klick</span>
        <Button onClick={onRecord} variant="record" size="sm">
          <Circle className="w-3 h-3 fill-current" /> Record
        </Button>
        <Button onClick={onOpenVideo} variant="ghost" size="sm">
          <FilePlus className="w-3.5 h-3.5" /> Open video
        </Button>
      </div>

      <div className="flex-1 text-center text-xs text-muted truncate px-4 select-none">
        {videoName || 'Klick'}
      </div>

      <div className="no-drag-region flex items-center gap-2">
        <Button onClick={onOpenProject} variant="ghost" size="sm">
          <FolderOpen className="w-3.5 h-3.5" /> Open project
        </Button>
        <Button onClick={onSaveProject} variant="ghost" size="sm" disabled={!hasVideo} title={hasVideo ? undefined : 'Record or open a video first'}>
          <Save className="w-3.5 h-3.5" /> Save
        </Button>
        <Button onClick={onExport} variant="primary" size="sm" disabled={!hasVideo} title={hasVideo ? undefined : 'Record or open a video first'}>
          <Upload className="w-3.5 h-3.5" /> Export
        </Button>
      </div>
    </header>
  );
}
