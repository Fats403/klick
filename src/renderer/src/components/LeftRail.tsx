import { Image, MousePointer2, ZoomIn, Upload, HelpCircle } from 'lucide-react';
import { useEditor, type InspectorTab } from '../store';

interface TabDef {
  id: InspectorTab;
  label: string;
  Icon: typeof Image;
}

const TABS: TabDef[] = [
  { id: 'look', label: 'Look', Icon: Image },
  { id: 'cursor', label: 'Cursor & Clicks', Icon: MousePointer2 },
  { id: 'zoom', label: 'Zoom', Icon: ZoomIn },
  { id: 'export', label: 'Export', Icon: Upload },
];

export function LeftRail() {
  const activeTab = useEditor((s) => s.activeTab);
  const setActiveTab = useEditor((s) => s.setActiveTab);

  return (
    <nav className="w-14 shrink-0 border-r border-border bg-surface flex flex-col items-center py-2">
      <div className="flex flex-col gap-1 flex-1">
        {TABS.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(active ? null : id)}
              title={label}
              className={
                'w-10 h-10 rounded-md flex items-center justify-center transition-colors ' +
                (active
                  ? 'bg-accent/15 text-accent border border-accent/40'
                  : 'text-muted hover:text-foreground hover:bg-surface-elevated border border-transparent')
              }
            >
              <Icon className="w-4 h-4" />
            </button>
          );
        })}
      </div>
      <button title="Help" className="w-10 h-10 rounded-md flex items-center justify-center text-muted hover:text-foreground hover:bg-surface-elevated">
        <HelpCircle className="w-4 h-4" />
      </button>
    </nav>
  );
}
