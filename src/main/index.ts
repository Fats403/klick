// Electron main: window, IPC, uiohook event capture, native capture driver,
// ffmpeg export driver. Screen capture itself happens in native/klick-capture
// (see README → "Why a Swift binary").

import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  screen,
  protocol,
  type IpcMainInvokeEvent,
} from 'electron';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable as NodeReadable } from 'node:stream';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { uIOhook, type UiohookMouseEvent } from 'uiohook-napi';
import { runExport, type ProjectFile } from './render';

// Custom scheme so the renderer can load local video files in dev. file:// is
// cross-origin from the Vite dev server, so we route through klick:// instead.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'klick',
    privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type InputEvent =
  | { type: 'move'; t: number; x: number; y: number }
  | { type: 'click'; t: number; x: number; y: number; button: string };

interface EventCapture {
  events: InputEvent[];
  startMs: number;
  lastMoveMs: number;
  screenW: number;
  screenH: number;
  handlers: {
    mousemove: (e: UiohookMouseEvent) => void;
    mousedown: (e: UiohookMouseEvent) => void;
  };
}

let mainWindow: BrowserWindow | null = null;
let eventCapture: EventCapture | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#0b1020',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

// ---------- App lifecycle ----------

app.whenReady().then(() => {
  // klick://local<absolute-path>. The 'local' host is a placeholder so the
  // path lives entirely in url.pathname — klick:///Users/foo would have URL
  // treat 'Users' as the host (and lowercase it).
  //
  // We honour HTTP Range requests ourselves so <video> can seek inside the
  // file. Without 206 + Content-Range, every `currentTime = X` outside the
  // initially-buffered region snaps back to 0.
  protocol.handle('klick', async (request) => {
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname);
    let stat;
    try { stat = await fs.promises.stat(filePath); }
    catch { return new Response(null, { status: 404 }); }
    if (!stat.isFile()) return new Response(null, { status: 404 });
    const total = stat.size;
    const mime = mimeFromExt(path.extname(filePath));

    const rangeHeader = request.headers.get('range');
    if (rangeHeader) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
      if (!m) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
      }
      const start = parseInt(m[1], 10);
      const end = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
      if (Number.isNaN(start) || start >= total || end < start) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
      }
      const stream = fs.createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
          'Content-Type': mime,
          'Cache-Control': 'no-store',
        },
      });
    }

    const stream = fs.createReadStream(filePath);
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(total),
        'Content-Type': mime,
        'Cache-Control': 'no-store',
      },
    });
  });

  createWindow();
  setupMenu();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopEventCapture();
  killActiveCapture();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  stopEventCapture();
  killActiveCapture();
});

function stopEventCapture() {
  if (eventCapture) {
    try { uIOhook.stop(); } catch { /* swallow */ }
    eventCapture = null;
  }
}

function killActiveCapture() {
  if (activeCapture) {
    try { activeCapture.proc.kill('SIGTERM'); } catch { /* swallow */ }
    activeCapture = null;
  }
}

// ---------- Native capture binary ----------

interface ActiveCapture {
  proc: ChildProcessByStdio<null, NodeReadable, NodeReadable>;
  outputPath: string;
  stderr: string;
}

let activeCapture: ActiveCapture | null = null;

function getCaptureBinaryPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'native', 'klick-capture');
  }
  // electron-vite runs main from out/main/, so the binary is two up at
  // out/native/.
  return path.join(__dirname, '..', 'native', 'klick-capture');
}

ipcMain.handle('record:list-sources', async () => {
  const bin = getCaptureBinaryPath();
  try { await fs.promises.access(bin, fs.constants.X_OK); }
  catch { return { error: `Capture binary missing or not executable: ${bin}. Run \`npm run build:native\`.` }; }

  return new Promise<{ sources?: unknown[]; error?: string }>((resolve) => {
    const proc = spawn(bin, ['list'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (err) => resolve({ error: err.message }));
    proc.on('exit', (code) => {
      if (code !== 0) {
        return resolve({ error: stderr.trim() || `klick-capture list exited with code ${code}` });
      }
      try {
        const sources = JSON.parse(stdout.trim());
        resolve({ sources });
      } catch (err) {
        resolve({ error: `Failed to parse klick-capture output: ${(err as Error).message}` });
      }
    });
  });
});

ipcMain.handle('record:start-native', async (_evt: IpcMainInvokeEvent, { sourceId, fps }: { sourceId: string; fps?: number }) => {
  if (activeCapture) return { error: 'A recording is already in progress.' };
  const bin = getCaptureBinaryPath();
  try { await fs.promises.access(bin, fs.constants.X_OK); }
  catch { return { error: `Capture binary missing: ${bin}` }; }

  const dir = path.join(app.getPath('userData'), 'recordings');
  await fs.promises.mkdir(dir, { recursive: true });
  const outputPath = path.join(dir, `recording-${timestamp()}.mp4`);

  const args = ['record', '--source', sourceId, '--output', outputPath];
  if (fps && Number.isFinite(fps)) {
    args.push('--fps', String(Math.max(1, Math.min(120, Math.floor(fps)))));
  }

  const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  // The binary writes "started\n" once SCStream.startCapture() returns. We
  // resolve only after we see that line, so the renderer never thinks
  // recording is live before frames are flowing into the mp4.
  return new Promise<{ ok?: true; outputPath?: string; error?: string }>((resolve) => {
    let started = false;
    let stdoutBuf = '';
    let stderrBuf = '';

    const tryFinishStart = () => {
      if (started || !stdoutBuf.includes('started')) return;
      started = true;
      activeCapture = { proc, outputPath, stderr: stderrBuf };
      proc.stderr.removeAllListeners('data');
      proc.stderr.on('data', (d) => { if (activeCapture) activeCapture.stderr += d.toString(); });
      resolve({ ok: true, outputPath });
    };

    proc.stdout.on('data', (d) => {
      stdoutBuf += d.toString();
      tryFinishStart();
    });
    proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });

    proc.on('error', (err) => {
      if (!started) resolve({ error: err.message });
    });
    proc.on('exit', (code) => {
      if (!started) {
        resolve({ error: stderrBuf.trim() || `klick-capture exited with code ${code} during startup` });
      }
    });
  });
});

ipcMain.handle('record:stop-native', async () => {
  if (!activeCapture) return { error: 'No active recording.' };
  const cap = activeCapture;
  activeCapture = null;

  return new Promise<{ ok?: true; outputPath?: string; error?: string; stderr?: string }>((resolve) => {
    // AVAssetWriter needs a beat after SIGTERM to flush the moov atom — wait
    // for the actual exit event, not just for kill() to return.
    cap.proc.once('exit', () => {
      resolve({ ok: true, outputPath: cap.outputPath, stderr: cap.stderr });
    });
    try { cap.proc.kill('SIGTERM'); }
    catch (err) { resolve({ error: `kill failed: ${(err as Error).message}` }); return; }
    // Safety net in case SIGTERM is ignored.
    setTimeout(() => {
      try { cap.proc.kill('SIGKILL'); } catch { /* */ }
    }, 5000);
  });
});

// ---------- Menu ----------

function setupMenu() {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: 'Klick',
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Recording', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.send('menu:new-recording') },
        { label: 'Open Video…', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu:open-video') },
        { type: 'separator' },
        { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu:save-project') },
        { label: 'Export Video…', accelerator: 'CmdOrCtrl+E', click: () => mainWindow?.webContents.send('menu:export') },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- File dialog IPC ----------

ipcMain.handle('dialog:open-video', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open video',
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mov', 'mp4', 'm4v', 'webm'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:open-project', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open project',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:save-project', async (_evt: IpcMainInvokeEvent, defaultName?: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save project',
    defaultPath: defaultName || 'project.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('dialog:save-export', async (_evt: IpcMainInvokeEvent, defaultName?: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export video',
    defaultPath: defaultName || 'demo.mp4',
    filters: [{ name: 'MP4', extensions: ['mp4'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('fs:read-text', async (_evt: IpcMainInvokeEvent, filePath: string) => {
  return fs.promises.readFile(filePath, 'utf-8');
});

ipcMain.handle('fs:write-text', async (_evt: IpcMainInvokeEvent, filePath: string, content: string) => {
  await fs.promises.writeFile(filePath, content, 'utf-8');
  return true;
});

ipcMain.handle('fs:file-url', async (_evt: IpcMainInvokeEvent, filePath: string) => {
  return 'klick://local' + encodeURI(filePath);
});

ipcMain.handle('shell:reveal', async (_evt: IpcMainInvokeEvent, filePath: string) => {
  shell.showItemInFolder(filePath);
  return true;
});

// ---------- Event capture (uiohook) ----------

const UIOHOOK_BUTTON: Record<number, string> = { 1: 'left', 2: 'right', 3: 'middle' };
const MOVE_MIN_INTERVAL_MS = 1000 / 60;

ipcMain.handle('record:start-events', async () => {
  if (eventCapture) return { error: 'Event capture is already running.' };
  const display = screen.getPrimaryDisplay();

  const cap: EventCapture = {
    events: [],
    startMs: Date.now(),
    lastMoveMs: 0,
    screenW: display.bounds.width,
    screenH: display.bounds.height,
    handlers: {
      mousemove: () => {},
      mousedown: () => {},
    },
  };

  cap.handlers.mousemove = (e: UiohookMouseEvent) => {
    const now = Date.now();
    if (now - cap.lastMoveMs < MOVE_MIN_INTERVAL_MS) return;
    cap.lastMoveMs = now;
    cap.events.push({
      type: 'move',
      t: +((now - cap.startMs) / 1000).toFixed(4),
      x: Math.round(e.x),
      y: Math.round(e.y),
    });
  };
  cap.handlers.mousedown = (e: UiohookMouseEvent) => {
    cap.events.push({
      type: 'click',
      t: +((Date.now() - cap.startMs) / 1000).toFixed(4),
      x: Math.round(e.x),
      y: Math.round(e.y),
      button: UIOHOOK_BUTTON[e.button as number] || String(e.button),
    });
  };

  uIOhook.on('mousemove', cap.handlers.mousemove);
  uIOhook.on('mousedown', cap.handlers.mousedown);

  try {
    uIOhook.start();
  } catch (err) {
    return {
      error: `uiohook failed to start: ${(err as Error).message}. ` +
        `Grant Accessibility permission to Electron in System Settings → Privacy & Security.`,
    };
  }

  eventCapture = cap;
  return { ok: true };
});

ipcMain.handle('record:stop-events', async () => {
  if (!eventCapture) return { events: null };
  const cap = eventCapture;
  eventCapture = null;
  try {
    uIOhook.off('mousemove', cap.handlers.mousemove);
    uIOhook.off('mousedown', cap.handlers.mousedown);
    uIOhook.stop();
  } catch { /* swallow */ }
  return {
    events: {
      version: 1,
      started_at_wall: cap.startMs / 1000,
      duration: +((Date.now() - cap.startMs) / 1000).toFixed(4),
      screen_width: cap.screenW,
      screen_height: cap.screenH,
      events: cap.events,
    },
  };
});

// ---------- Export ----------

// One in-flight export at a time.
let exportAbort: AbortController | null = null;

ipcMain.handle('export:run', async (
  _evt: IpcMainInvokeEvent,
  { projectJson, videoPath, outPath }: { projectJson: ProjectFile; videoPath: string; outPath: string },
) => {
  if (exportAbort) return { error: 'An export is already in progress.' };
  exportAbort = new AbortController();
  try {
    return await runExport({
      project: projectJson,
      videoPath,
      outPath,
      signal: exportAbort.signal,
      onLog: (text) => mainWindow?.webContents.send('export:log', text),
    });
  } finally {
    exportAbort = null;
  }
});

ipcMain.handle('export:cancel', async () => {
  exportAbort?.abort();
  return { ok: true };
});

// ---------- helpers ----------

function timestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function mimeFromExt(ext: string): string {
  const t: Record<string, string> = {
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.mov': 'video/quicktime',
  };
  return t[ext.toLowerCase()] || 'application/octet-stream';
}
