import { useEditor } from '../store';
import { LookTab } from './tabs/LookTab';
import { CursorTab } from './tabs/CursorTab';
import { ZoomTab } from './tabs/ZoomTab';
import { ExportTab } from './tabs/ExportTab';

export function Inspector() {
  const activeTab = useEditor((s) => s.activeTab);

  if (!activeTab) return null;

  return (
    <aside className="w-80 shrink-0 border-l border-border bg-surface overflow-y-auto">
      {activeTab === 'look' && <LookTab />}
      {activeTab === 'cursor' && <CursorTab />}
      {activeTab === 'zoom' && <ZoomTab />}
      {activeTab === 'export' && <ExportTab />}
    </aside>
  );
}
