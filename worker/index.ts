// Cloudflare Worker: serves the static app (assets) plus daily data snapshots.
//   GET /api/data/:key  -> latest snapshot from KV (refreshed by the cron; fetched on demand if missing)
//   GET /api/citibike/* -> live Citi Bike station feeds (CORS proxy)
//   GET /api/env        -> climate & environment facts for a point (Mireye Earth API, see env.ts)
//   cron (daily)        -> re-fetch every dataset in DATASETS and store it in KV
// Snapshots are stored as the upstream response bytes (streamed, never parsed) so the job stays within tiny CPU budgets.
import { DATASETS } from './datasets';
import { environment } from './env';

interface Env { DATA: KVNamespace; ASSETS: Fetcher; SODA_APP_TOKEN?: string; MIREYE_API_TOKEN?: string }

const NO_STORE = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600, stale-while-revalidate=86400' };

async function refresh(env: Env, key: string) {
  const url = DATASETS[key]; if (!url) throw new Error(`unknown dataset ${key}`);
  const res = await fetch(url, { headers: env.SODA_APP_TOKEN ? { 'X-App-Token': env.SODA_APP_TOKEN } : {} });
  if (!res.ok || !res.body) throw new Error(`${key}: upstream ${res.status}`);
  await env.DATA.put(key, res.body, { metadata: { updated: new Date().toISOString() } });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url), { pathname } = url;
    if (pathname === '/api/env') return environment(url, env);
    const bike = pathname.match(/^\/api\/citibike\/(station_information|station_status)$/);
    if (bike) { // live Citi Bike GBFS has no CORS headers; pass it through with a short cache
      const r = await fetch(`https://gbfs.lyft.com/gbfs/2.3/bkn/en/${bike[1]}.json`, { cf: { cacheTtl: 60 } });
      return new Response(r.body, { status: r.status, headers: r.ok ? { ...HEADERS, 'cache-control': 'public, max-age=60' } : NO_STORE });
    }
    const m = pathname.match(/^\/api\/data\/([a-z0-9-]+)$/);
    if (!m) return env.ASSETS.fetch(req);
    const key = m[1]; if (!DATASETS[key]) return new Response('{"error":"unknown dataset"}', { status: 404, headers: NO_STORE });
    let hit = await env.DATA.getWithMetadata<{ updated: string }>(key, 'stream');
    if (!hit.value) { // first request after deploy: fill it now
      try { await refresh(env, key); } catch (e) { return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: NO_STORE }); }
      hit = await env.DATA.getWithMetadata<{ updated: string }>(key, 'stream');
    }
    return new Response(hit.value, { headers: { ...HEADERS, 'x-data-updated': hit.metadata?.updated ?? '' } });
  },
  async scheduled(_: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.allSettled(Object.keys(DATASETS).map(k => refresh(env, k))).then(rs => {
      rs.forEach((r, i) => r.status === 'rejected' && console.error('refresh failed', Object.keys(DATASETS)[i], r.reason));
    }));
  },
} satisfies ExportedHandler<Env>;
