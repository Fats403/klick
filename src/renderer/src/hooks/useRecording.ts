import { useCallback, useEffect, useRef, useState } from 'react';
import type { CaptureSource } from '../../../preload/index';
import { useEditor } from '../store';
import { loadVideo } from '../lib/projectIO';

// Renderer side of the recording lifecycle. Actual capture runs in the
// native klick-capture binary spawned by main. Flow: openPicker →
// pickSource → stop → recording loads into the editor.
export function useRecording() {
  const setEvents = useEditor((s) => s.setEvents);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [active, setActive] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [elapsedLabel, setElapsedLabel] = useState('00:00');
  const [log, setLog] = useState('');

  const recordingOutputPath = useRef<string | null>(null);
  // Captured region's geometry in global screen-points, returned by the
  // native binary at start. Used in finish() to shift uiohook event
  // positions into the captured area's local coordinate space.
  const captureGeometry = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const startedAt = useRef<number>(0);
  const elapsedTimer = useRef<number | null>(null);
  const starting = useRef(false);

  const appendLog = (source: string, text: string) =>
    setLog((s) => s + `[${source}] ${text}` + (text.endsWith('\n') ? '' : '\n'));

  const openPicker = useCallback(async () => {
    if (active || starting.current) return;
    setLog('');
    try {
      const resp = await window.api.listCaptureSources();
      if (resp.error || !resp.sources) {
        alert(resp.error || 'Could not list capture sources.');
        return;
      }
      setSources(resp.sources);
      setPickerOpen(true);
    } catch (err) {
      alert(`Failed to list sources: ${(err as Error).message}`);
    }
  }, [active]);

  const closePicker = useCallback(() => setPickerOpen(false), []);

  const pickSource = useCallback(async (src: CaptureSource) => {
    if (starting.current || active) return;
    starting.current = true;
    setPickerOpen(false);

    // Start event capture before the binary so we don't miss mouse moves
    // while SCStream is warming up. Non-fatal if it fails.
    try {
      const resp = await window.api.startEventCapture();
      if (resp.error) appendLog('events', resp.error);
    } catch (err) {
      appendLog('events', `failed: ${(err as Error).message}`);
    }

    let started: Awaited<ReturnType<typeof window.api.startNativeRecording>>;
    try {
      started = await window.api.startNativeRecording({ sourceId: src.id });
    } catch (err) {
      starting.current = false;
      await window.api.stopEventCapture().catch(() => undefined);
      alert((err as Error).message);
      return;
    }

    if (started.error || !started.ok || !started.outputPath) {
      starting.current = false;
      await window.api.stopEventCapture().catch(() => undefined);
      const msg = started.error || 'Native capture failed to start.';
      appendLog('recorder', msg);
      alert(
        `${msg}\n\n` +
          `If this is the first time recording, macOS may need Screen Recording ` +
          `permission. Open System Settings → Privacy & Security → Screen Recording ` +
          `and enable Klick (or Electron in dev), then try again.`,
      );
      return;
    }

    recordingOutputPath.current = started.outputPath;
    captureGeometry.current = started.geometry ?? null;
    startedAt.current = Date.now();
    appendLog('recorder', `recording "${src.name}" → ${started.outputPath}`);
    setActive(true);
    starting.current = false;
    startElapsed();
  }, [active]);

  const finish = async (outputPath: string) => {
    let resp: { events: import('../../../preload/index').EventsObject | null } = { events: null };
    try { resp = await window.api.stopEventCapture(); }
    catch (err) { appendLog('events', `stop failed: ${(err as Error).message}`); }

    // Shift uiohook events from global screen-coords into the captured
    // region's local coords, so a window recorded at screen (200, 100) gets
    // events relative to the window's top-left rather than the screen's.
    // screen_width / _height get overwritten to match the captured region
    // so downstream renderers' "events × videoW/screenW" math stays correct.
    const events = resp.events;
    const geom = captureGeometry.current;
    if (events && geom) {
      events.events = events.events.map((e) => ({
        ...e,
        x: Math.round(e.x - geom.x),
        y: Math.round(e.y - geom.y),
      }));
      events.screen_width = Math.round(geom.w);
      events.screen_height = Math.round(geom.h);
    }
    captureGeometry.current = null;

    setEvents(events);
    setActive(false);
    setStopping(false);
    await loadVideo(outputPath);
    // Drop one follow-cursor zoom segment per click cluster as a starting
    // point. Users can drag the handles or delete what they don't want.
    useEditor.getState().applyAutoZooms();
  };

  const stop = useCallback(async () => {
    if (!recordingOutputPath.current || stopping) return;
    setStopping(true);
    stopElapsed();

    let resp: { ok?: true; outputPath?: string; error?: string; stderr?: string } = {};
    try { resp = await window.api.stopNativeRecording(); }
    catch (err) {
      appendLog('error', (err as Error).message);
      setActive(false);
      setStopping(false);
      recordingOutputPath.current = null;
      return;
    }

    if (resp.stderr) appendLog('capture', resp.stderr);

    if (resp.error || !resp.outputPath) {
      appendLog('error', resp.error || 'stopNativeRecording returned no path');
      setActive(false);
      setStopping(false);
      recordingOutputPath.current = null;
      alert('Recording stop failed: ' + (resp.error || 'unknown'));
      return;
    }

    const out = resp.outputPath;
    recordingOutputPath.current = null;
    appendLog('saved', out);
    try { await finish(out); }
    catch (err) {
      appendLog('error', (err as Error).message);
      setActive(false);
      setStopping(false);
      alert('Save failed: ' + (err as Error).message);
    }
  }, [stopping]);

  const startElapsed = () => {
    stopElapsed();
    const tick = () => {
      const s = Math.floor((Date.now() - startedAt.current) / 1000);
      setElapsedLabel(`${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
    };
    tick();
    elapsedTimer.current = window.setInterval(tick, 500);
  };
  const stopElapsed = () => {
    if (elapsedTimer.current) { clearInterval(elapsedTimer.current); elapsedTimer.current = null; }
  };

  useEffect(() => () => stopElapsed(), []);

  return { pickerOpen, sources, active, stopping, elapsedLabel, log, openPicker, closePicker, pickSource, stop };
}
