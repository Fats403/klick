// contextBridge wall between Node and the renderer. Renderer sees window.api.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

export interface InputEvent {
  type: 'move' | 'click';
  t: number;
  x: number;
  y: number;
  button?: string;
}

export interface EventsObject {
  version: number;
  started_at_wall: number;
  duration: number;
  screen_width: number;
  screen_height: number;
  events: InputEvent[];
}

export type MenuAction = 'menu:new-recording' | 'menu:open-video' | 'menu:save-project' | 'menu:export';

// Mirrors klick-capture's SourceInfo from `klick-capture list`.
export interface CaptureSource {
  id: string;
  kind: 'display' | 'window';
  name: string;
  width: number;
  height: number;
  // data:image/png;base64,... — goes straight into <img src=>. Empty when
  // the binary couldn't capture a snapshot.
  thumbnail: string;
}

export interface Api {
  openVideo: () => Promise<string | null>;
  openProject: () => Promise<string | null>;
  saveProject: (defaultName?: string) => Promise<string | null>;
  saveExport: (defaultName?: string) => Promise<string | null>;
  readText: (filePath: string) => Promise<string>;
  writeText: (filePath: string, content: string) => Promise<true>;
  fileUrl: (filePath: string) => Promise<string>;
  revealInFinder: (filePath: string) => Promise<true>;
  listCaptureSources: () => Promise<{ sources?: CaptureSource[]; error?: string }>;
  startNativeRecording: (payload: { sourceId: string; fps?: number }) => Promise<{ ok?: true; outputPath?: string; error?: string }>;
  stopNativeRecording: () => Promise<{ ok?: true; outputPath?: string; error?: string; stderr?: string }>;
  startEventCapture: () => Promise<{ ok?: true; error?: string }>;
  stopEventCapture: () => Promise<{ events: EventsObject | null }>;
  runExport: (payload: { projectJson: unknown; videoPath: string; outPath: string }) => Promise<{ ok?: true; outPath?: string; error?: string; stderr?: string }>;
  cancelExport: () => Promise<{ ok: true }>;
  onExportLog: (handler: (text: string) => void) => () => void;
  onMenuAction: (handler: (action: MenuAction) => void) => () => void;
}

const api: Api = {
  openVideo: () => ipcRenderer.invoke('dialog:open-video'),
  openProject: () => ipcRenderer.invoke('dialog:open-project'),
  saveProject: (defaultName) => ipcRenderer.invoke('dialog:save-project', defaultName),
  saveExport: (defaultName) => ipcRenderer.invoke('dialog:save-export', defaultName),
  readText: (filePath) => ipcRenderer.invoke('fs:read-text', filePath),
  writeText: (filePath, content) => ipcRenderer.invoke('fs:write-text', filePath, content),
  fileUrl: (filePath) => ipcRenderer.invoke('fs:file-url', filePath),
  revealInFinder: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  listCaptureSources: () => ipcRenderer.invoke('record:list-sources'),
  startNativeRecording: (payload) => ipcRenderer.invoke('record:start-native', payload),
  stopNativeRecording: () => ipcRenderer.invoke('record:stop-native'),
  startEventCapture: () => ipcRenderer.invoke('record:start-events'),
  stopEventCapture: () => ipcRenderer.invoke('record:stop-events'),
  runExport: (payload) => ipcRenderer.invoke('export:run', payload),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  onExportLog: (handler) => {
    const wrapped = (_evt: IpcRendererEvent, text: string) => handler(text);
    ipcRenderer.on('export:log', wrapped);
    return () => ipcRenderer.removeListener('export:log', wrapped);
  },
  onMenuAction: (handler) => {
    const channels: MenuAction[] = ['menu:new-recording', 'menu:open-video', 'menu:save-project', 'menu:export'];
    const wrappers = channels.map((ch) => {
      const w = () => handler(ch);
      ipcRenderer.on(ch, w);
      return [ch, w] as const;
    });
    return () => wrappers.forEach(([ch, w]) => ipcRenderer.removeListener(ch, w));
  },
};

contextBridge.exposeInMainWorld('api', api);
