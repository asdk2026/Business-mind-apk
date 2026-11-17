import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { hydrateLocalStorageFromIndexedDB } from './utils/db';
import { initSqliteDatabase } from './utils/sqlite';

async function bootstrapApp() {
  try {
    await Promise.race([
      (async () => {
        await hydrateLocalStorageFromIndexedDB();
        await initSqliteDatabase();
      })(),
      new Promise<void>((resolve) => setTimeout(resolve, 1800)),
    ]);
  } catch {
    // Proceed gracefully if storage APIs are restricted
  }
  createRoot(document.getElementById('root')!).render(<App />);
}

bootstrapApp();
