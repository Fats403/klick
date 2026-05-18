import { useEditor } from '../store';
import { StyleTab } from './tabs/StyleTab';
import { ZoomTab } from './tabs/ZoomTab';
import { ExportTab } from './tabs/ExportTab';

export function Inspector() {
  const activeTab = useEditor((s) => s.activeTab);

  if (!activeTab) return null;

  return (
    <aside className="w-80 shrink-0 border-l border-border bg-surface overflow-y-auto">
      {activeTab === 'style' && <StyleTab />}
      {activeTab === 'zoom' && <ZoomTab />}
      {activeTab === 'crop' && <PlaceholderTab title="Crop" message="Crop controls coming soon." />}
      {activeTab === 'export' && <ExportTab />}
    </aside>
  );
}

function PlaceholderTab({ title, message }: { title: string; message: string }) {
  return (
    <div className="p-4">
      <h2 className="text-sm font-semibold mb-2">{title}</h2>
      <p className="text-xs text-muted">{message}</p>
    </div>
  );
}
