import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { hydrateLocalStorageFromIndexedDB } from './utils/db';

async function bootstrapApp() {
  try {
    await Promise.race([
      hydrateLocalStorageFromIndexedDB(),
      new Promise<void>((resolve) => setTimeout(resolve, 600)),
    ]);
  } catch {
    // Proceed even if IndexedDB is unavailable
  }
  createRoot(document.getElementById('root')!).render(<App />);
}

bootstrapApp();
