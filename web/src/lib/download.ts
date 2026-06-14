import axios from 'axios';
import { tokenStore } from './api';
import { useAuth } from './auth';

const BASE = import.meta.env.VITE_API_URL || '/api';

// Authenticated blob download: GET with Bearer + branch-override headers,
// stream into a Blob, trigger a one-off anchor click. Works for both PDF
// and CSV because the server already sets Content-Disposition.
export async function downloadAuthed(path: string, filenameFallback: string) {
  const headers: Record<string, string> = {};
  const tok = tokenStore.get();
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const override = useAuth.getState().branchOverride;
  if (override) headers['x-branch-id'] = override;

  const r = await axios.get(`${BASE}${path}`, {
    withCredentials: true,
    headers,
    responseType: 'blob',
  });

  // Prefer server-provided filename, fall back to the caller's hint.
  const cd = String(r.headers['content-disposition'] ?? '');
  const m = /filename="?([^"]+)"?/.exec(cd);
  const filename = m?.[1] ?? filenameFallback;

  const url = URL.createObjectURL(r.data);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Allow the browser to actually start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
