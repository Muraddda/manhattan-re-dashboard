// /api/env: climate & environment facts for a point, from the Mireye Earth API (api.mireye.com, bearer token kept as the
// Worker secret MIREYE_API_TOKEN, never sent to browsers). Each location is cached in KV for 30 days and fresh lookups
// are capped per day, so a public page cannot run through the account's credits.

export const ENV_FIELDS = [
  'elevation', 'coast_distance_m', 'within_floodplain_polygon', 'tree_canopy_pct',
  'nearest_major_road_distance_m', 'nearest_major_road_name', 'nearest_airport_name', 'nearest_airport_distance_m',
] as const;
const BOUNDS = { w: -74.05, e: -73.9, s: 40.68, n: 40.89 }; // Manhattan and its shoreline
const DAILY_CAP = 400, TTL = 30 * 86400;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const reply = (status: number, body: unknown, cache = 'no-store') => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, 'cache-control': cache } });

interface Field { value: unknown; unit: string | null; source: string; source_url: string; confidence: string; dataset_vintage: string | null; notes: string | null; status: string }

export async function environment(url: URL, env: { DATA: KVNamespace; MIREYE_API_TOKEN?: string }): Promise<Response> {
  const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lng'));
  if (!isFinite(lat) || !isFinite(lng) || lng < BOUNDS.w || lng > BOUNDS.e || lat < BOUNDS.s || lat > BOUNDS.n) return reply(400, { error: 'Manhattan coordinates only' });
  const key = `env:${lat.toFixed(4)},${lng.toFixed(4)}`; // ~10 m: neighbours in one building share a lookup
  const hit = await env.DATA.get(key);
  if (hit) return new Response(hit, { headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=86400' } });
  if (!env.MIREYE_API_TOKEN) return reply(503, { error: 'environment data not configured' });
  const day = `env-count:${new Date().toISOString().slice(0, 10)}`, used = Number(await env.DATA.get(day)) || 0;
  if (used >= DAILY_CAP) return reply(429, { error: 'daily environment lookup limit reached' });
  await env.DATA.put(day, String(used + 1), { expirationTtl: 2 * 86400 }); // approximate (KV is eventually consistent), enough for a budget guard
  const r = await fetch('https://api.mireye.com/v1/fetch', {
    method: 'POST', headers: { authorization: `Bearer ${env.MIREYE_API_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ lat: +lat.toFixed(4), lng: +lng.toFixed(4), fields: ENV_FIELDS }),
  });
  if (!r.ok) return reply(502, { error: `Mireye ${r.status}` });
  const j = await r.json() as { fetched_at: string; fields: Record<string, Field> };
  const fields = Object.fromEntries(Object.entries(j.fields ?? {}).filter(([, f]) => f?.status === 'ok').map(([k, f]) =>
    [k, { value: f.value, unit: f.unit, source: f.source, url: f.source_url, confidence: f.confidence, vintage: f.dataset_vintage, notes: f.notes }]));
  const body = JSON.stringify({ fetched: j.fetched_at, fields });
  await env.DATA.put(key, body, { expirationTtl: TTL });
  return new Response(body, { headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=86400' } });
}
