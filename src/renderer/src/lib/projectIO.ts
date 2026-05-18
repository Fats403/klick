import { useEditor, type ProjectFile } from '../store';

export async function loadVideo(filePath: string) {
  const url = await window.api.fileUrl(filePath);
  const name = filePath.split('/').pop() || filePath;
  useEditor.getState().setVideo({ videoPath: filePath, videoUrl: url, name });
}

export async function openVideoDialog() {
  const path = await window.api.openVideo();
  if (path) await loadVideo(path);
}

export async function saveProjectDialog() {
  const { videoPath } = useEditor.getState();
  if (!videoPath) { alert('Record or open a video first.'); return; }
  const dest = await window.api.saveProject('project.json');
  if (!dest) return;
  const project = useEditor.getState().toProject();
  await window.api.writeText(dest, JSON.stringify(project, null, 2));
}

export async function openProjectDialog() {
  const path = await window.api.openProject();
  if (!path) return;
  const text = await window.api.readText(path);
  try {
    const proj = JSON.parse(text) as ProjectFile;
    useEditor.getState().hydrateFromProject(proj);
    if (proj.video) {
      try { await loadVideo(proj.video); } catch { /* video may have moved */ }
    }
  } catch (err) {
    alert('Could not parse project JSON: ' + (err as Error).message);
  }
}
