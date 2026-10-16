// Door-to-door subway routing on the GTFS-derived graph (scripts/build-transit.mjs).
// Model: walk to a station, wait half the headway, ride, transfer (walk or change lines, waiting again), walk out.
// Weekday AM peak averages, so results are typical times, not live arrivals.
import type { LngLat } from '../model';
import { distanceMeters } from './grid';

export interface Station { id: string; name: string; lon: number; lat: number; routes: string[] }
export interface Transit {
  stations: Station[];
  routes: Record<string, { color: string; text: string; name: string }>;
  edges: [string, string, string, number][];
  headways: Record<string, number>;
  transfers: [string, string, number][];
  lines: Record<string, [number, number][][]>;
}
export interface Leg { kind: 'walk' | 'ride'; route?: string; from?: Station; to?: Station; stops?: number; seconds: number; wait?: number; path: LngLat[] }
export interface Trip { seconds: number; legs: Leg[] }

const WALK_MPS = 80 / 60 / 1.25; // 80 m/min on the grid, 1.25 detour factor (same as walkMinutes)
const MAX_ACCESS_M = 1300;       // stations considered at either end (~20 min walk)
export const walkSeconds = (m: number) => m / WALK_MPS;

export class Router {
  readonly byId: Map<string, Station>;
  private out = new Map<string, { to: string; route: string; s: number }[]>();
  private xfer = new Map<string, { to: string; s: number }[]>();
  constructor(readonly t: Transit) {
    this.byId = new Map(t.stations.map(s => [s.id, s]));
    for (const [f, to, route, s] of t.edges) (this.out.get(f) ?? this.out.set(f, []).get(f)!).push({ to, route, s });
    for (const [f, to, s] of t.transfers) (this.xfer.get(f) ?? this.xfer.set(f, []).get(f)!).push({ to, s });
  }
  headway(route: string, station: string) { return this.t.headways[`${route}|${station}`] ?? 480; }
  /** Stations within walking range, nearest first. */
  near(p: LngLat, maxM = MAX_ACCESS_M) {
    return this.t.stations.map(s => ({ s, m: distanceMeters(p, [s.lon, s.lat]) })).filter(x => x.m <= maxM).sort((a, b) => a.m - b.m);
  }
  /**
   * Dijkstra over (station, line) states from a street point. State key "id|route" (route '' = on foot in the station).
   * Returns arrival seconds per state plus back-pointers for path rebuilding.
   */
  private search(origin: LngLat, limit = 3 * 3600) {
    const dist = new Map<string, number>(), prev = new Map<string, string>(), heap = new Heap();
    const push = (k: string, d: number, p?: string) => { if (d < (dist.get(k) ?? Infinity) && d <= limit) { dist.set(k, d); if (p) prev.set(k, p); heap.push(d, k); } };
    for (const { s, m } of this.near(origin)) push(`${s.id}|`, walkSeconds(m), 'origin');
    while (heap.size) {
      const [d, k] = heap.pop()!; if (d > (dist.get(k) ?? Infinity)) continue;
      const [id, route] = k.split('|');
      if (!route) {
        for (const r of new Set((this.out.get(id) ?? []).map(e => e.route))) push(`${id}|${r}`, d + this.headway(r, id) / 2, k); // board
        for (const x of this.xfer.get(id) ?? []) push(`${x.to}|`, d + x.s, k);                                               // walk transfer
      } else {
        push(`${id}|`, d + 30, k);                                                                                              // alight
        for (const e of this.out.get(id) ?? []) if (e.route === route) push(`${e.to}|${route}`, d + e.s, k);                  // ride on
      }
    }
    return { dist, prev };
  }
  /** Fastest trip from a to b (walking only if that is quicker). */
  trip(a: LngLat, b: LngLat): Trip {
    const walk: Trip = { seconds: walkSeconds(distanceMeters(a, b)), legs: [{ kind: 'walk', seconds: walkSeconds(distanceMeters(a, b)), path: [a, b] }] };
    const { dist, prev } = this.search(a);
    let best: { k: string; total: number; egress: number } | null = null;
    for (const { s, m } of this.near(b)) {
      const d = dist.get(`${s.id}|`); if (d == null) continue;
      const total = d + walkSeconds(m); if (!best || total < best.total) best = { k: `${s.id}|`, total, egress: walkSeconds(m) };
    }
    if (!best || best.total >= walk.seconds) return walk;
    // rebuild the state chain, then fold it into walk / ride legs
    const chain: string[] = []; for (let k: string | undefined = best.k; k && k !== 'origin'; k = prev.get(k)) chain.unshift(k);
    const legs: Leg[] = []; const st = (k: string) => this.byId.get(k.split('|')[0])!;
    const first = st(chain[0]); legs.push({ kind: 'walk', seconds: dist.get(chain[0])!, path: [a, [first.lon, first.lat]], to: first });
    for (let i = 1; i < chain.length; i++) {
      const [, r] = chain[i].split('|'), [, pr] = chain[i - 1].split('|');
      const here = st(chain[i]), before = st(chain[i - 1]), dt = dist.get(chain[i])! - dist.get(chain[i - 1])!;
      if (r && !pr) legs.push({ kind: 'ride', route: r, from: here, to: here, stops: 0, seconds: 0, wait: dt, path: [[here.lon, here.lat]] });
      else if (r && pr === r) { const L = legs[legs.length - 1]; L.to = here; L.stops! += 1; L.seconds += dt; L.path.push([here.lon, here.lat]); }
      else if (!r && !pr && here.id !== before.id) legs.push({ kind: 'walk', seconds: dt, from: before, to: here, path: [[before.lon, before.lat], [here.lon, here.lat]] });
    }
    const last = st(chain[chain.length - 1]); legs.push({ kind: 'walk', seconds: best.egress, from: last, path: [[last.lon, last.lat], b] });
    return { seconds: best.total, legs: legs.filter(l => l.kind === 'ride' || l.seconds > 20) };
  }
  /** Seconds to reach every station (on foot inside it) from a point, for isochrone drawing. */
  reach(a: LngLat, limit = 45 * 60) {
    const { dist } = this.search(a, limit); const out = new Map<string, number>();
    for (const [k, d] of dist) if (k.endsWith('|')) out.set(k.slice(0, -1), d);
    return out;
  }
}

/** Tiny binary min-heap of [priority, value]. */
class Heap {
  private a: [number, string][] = [];
  get size() { return this.a.length; }
  push(p: number, v: string) { const a = this.a; a.push([p, v]); let i = a.length - 1; while (i) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
  pop() {
    const a = this.a; if (!a.length) return undefined; const top = a[0], last = a.pop()!;
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
    return top;
  }
}
