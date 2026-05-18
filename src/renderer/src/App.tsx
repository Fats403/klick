import { useEffect, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { LeftRail } from './components/LeftRail';
import { Inspector } from './components/Inspector';
import { Preview } from './components/Preview';
import { Transport } from './components/Transport';
import { Toolbar } from './components/Toolbar';
import { Timeline } from './components/Timeline';
import { EmptyState } from './components/EmptyState';
import { SourcePicker } from './components/SourcePicker';
import { RecordingOverlay } from './components/RecordingOverlay';
import { ExportOverlay } from './components/ExportOverlay';
import { useRecording } from './hooks/useRecording';
import { useEditor } from './store';
import { openVideoDialog, openProjectDialog, saveProjectDialog } from './lib/projectIO';

export default function App() {
  const videoPath = useEditor((s) => s.videoPath);
  const [exportOpen, setExportOpen] = useState(false);

  const recording = useRecording();

  // Menu shortcuts → in-app actions
  useEffect(() => {
    const unsub = window.api.onMenuAction((action) => {
      if (action === 'menu:new-recording') recording.openPicker();
      else if (action === 'menu:open-video') openVideoDialog();
      else if (action === 'menu:save-project') saveProjectDialog();
      else if (action === 'menu:export') setExportOpen(true);
    });
    return unsub;
  }, [recording]);

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      <TitleBar
        onRecord={recording.openPicker}
        onExport={() => setExportOpen(true)}
        onOpenVideo={openVideoDialog}
        onOpenProject={openProjectDialog}
        onSaveProject={saveProjectDialog}
      />

      <div className="flex-1 flex min-h-0">
        <LeftRail />

        <main className="flex-1 flex flex-col min-w-0">
          {videoPath ? (
            <>
              <Preview />
              <Transport />
              <Toolbar />
              <Timeline />
            </>
          ) : (
            <EmptyState onRecord={recording.openPicker} onOpenVideo={openVideoDialog} onOpenProject={openProjectDialog} />
          )}
        </main>

        <Inspector />
      </div>

      {recording.pickerOpen && (
        <SourcePicker
          sources={recording.sources}
          onPick={recording.pickSource}
          onClose={recording.closePicker}
        />
      )}
      {recording.active && (
        <RecordingOverlay
          elapsedLabel={recording.elapsedLabel}
          log={recording.log}
          onStop={recording.stop}
          stopping={recording.stopping}
        />
      )}
      {exportOpen && <ExportOverlay onClose={() => setExportOpen(false)} />}
    </div>
  );
}
