// Uniform grid over lon/lat for fast "what is near this point" queries (thousands of homes x thousands of places).
import type { LngLat } from '../model';

const R = 6371000, RAD = Math.PI / 180;
export function distanceMeters(a: LngLat, b: LngLat) {
  const dLat = (b[1] - a[1]) * RAD, dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** Approx walking minutes: straight-line x 1.25 grid detour / 80 m per minute. */
export const walkMinutes = (m: number) => Math.max(1, Math.round((m * 1.25) / 80));
/** Straight-line metres that take `min` minutes to walk. */
export const walkRadius = (min: number) => (min * 80) / 1.25;

export class Grid<T extends { lon: number; lat: number }> {
  private cells = new Map<string, T[]>();
  constructor(readonly items: T[], private cell = 0.004) { // ~330 m x 440 m cells
    for (const it of items) { const k = this.key(it.lon, it.lat); (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(it); }
  }
  private key(lon: number, lat: number) { return `${Math.floor(lon / this.cell)}:${Math.floor(lat / this.cell)}`; }
  /** Items within `m` metres, nearest first, each with its distance. */
  within(p: LngLat, m: number, filter?: (t: T) => boolean): { item: T; m: number }[] {
    const r = Math.ceil(m / (this.cell * 84000)) + 1, cx = Math.floor(p[0] / this.cell), cy = Math.floor(p[1] / this.cell), out: { item: T; m: number }[] = [];
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (const it of this.cells.get(`${x}:${y}`) ?? []) {
      if (filter && !filter(it)) continue;
      const d = distanceMeters(p, [it.lon, it.lat]); if (d <= m) out.push({ item: it, m: d });
    }
    return out.sort((a, b) => a.m - b.m);
  }
  /** Nearest matching item, searching outward up to `maxM`. */
  nearest(p: LngLat, filter?: (t: T) => boolean, maxM = 3000) {
    for (let m = 400; m <= maxM * 2; m *= 2) { const hit = this.within(p, Math.min(m, maxM), filter)[0]; if (hit) return hit; if (m >= maxM) break; }
    return undefined;
  }
}
