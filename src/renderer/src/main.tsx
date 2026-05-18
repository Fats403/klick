import ReactDOM from 'react-dom/client';
import App from './App';
import './globals.css';

// Note: not wrapping in <React.StrictMode>. StrictMode's dev-only double
// mount caused real bugs in long-running async effects (e.g. the export
// flow's `cancelled` closure flipping to true between the two mounts and
// short-circuiting success state). Production never runs effects twice
// anyway, so we skip the dev-only check.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
