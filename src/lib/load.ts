// Data loading. Live datasets come from the Worker's daily KV snapshots (/api/data/:key); when that route does not exist
// (plain `vite dev`, or the Worker is down) the committed snapshot in /data/:key.json is used instead.
export async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  if (!(r.headers.get('content-type') ?? '').includes('json')) throw new Error(`not JSON: ${url}`); // SPA fallbacks answer with index.html
  return r.json();
}
export async function dataset<T>(key: string): Promise<{ data: T; updated: string | null; live: boolean }> {
  try {
    const r = await fetch(`/api/data/${key}`);
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) return { data: await r.json(), updated: r.headers.get('x-data-updated'), live: true };
  } catch { /* fall through to the snapshot */ }
  return { data: await getJson<T>(`/data/${key}.json`), updated: null, live: false };
}
