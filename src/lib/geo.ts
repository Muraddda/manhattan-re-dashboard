// Small geometry helpers (lon/lat, Manhattan-scale accuracy).
import type { Feature, FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson';
import type { LngLat } from '../model';

export const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
export const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });
export const point = (lon: number, lat: number, properties: Record<string, unknown> = {}): Feature => ({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [lon, lat] } });
const M_LAT = 110574, mLon = (lat: number) => 111320 * Math.cos(lat * Math.PI / 180);

export function circle([lon, lat]: LngLat, r: number, n = 64): Feature<Polygon> {
  const dy = r / M_LAT, dx = r / mLon(lat);
  const ring = Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * 2 * Math.PI; return [lon + dx * Math.cos(a), lat + dy * Math.sin(a)]; });
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

export function pointInRing([x, y]: LngLat, ring: Position[]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function pointInPolygon(p: LngLat, rings: Position[][]) { return pointInRing(p, rings[0]) && !rings.slice(1).some(h => pointInRing(p, h)); }
/** The polygon (outer + holes) of a Polygon/MultiPolygon that contains p. */
export function polygonAt(p: LngLat, g: Polygon | MultiPolygon): Position[][] | null {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polys.find(rings => pointInPolygon(p, rings)) ?? null;
}
export function centroid(ring: Position[]): LngLat {
  let a = 0, x = 0, y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; a += f; x += (ring[j][0] + ring[i][0]) * f; y += (ring[j][1] + ring[i][1]) * f; }
  if (!a) return [ring[0][0], ring[0][1]];
  return [x / (3 * a), y / (3 * a)];
}
/** Push every vertex of a ring `m` metres away from its centroid: a highlight drawn over the original never z-fights. */
export function grow(ring: Position[], m: number): Position[] {
  const [cx, cy] = centroid(ring), k = mLon(cy);
  return ring.map(([x, y]) => { const dx = (x - cx) * k, dy = (y - cy) * M_LAT, d = Math.hypot(dx, dy) || 1; return [x + (dx / d) * m / k, y + (dy / d) * m / M_LAT]; });
}
/** Area in m² of a lon/lat ring (local planar approximation). */
export function areaM2(ring: Position[]) {
  const k = mLon(ring[0][1]); let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] * k) * (ring[i][1] * M_LAT) - (ring[i][0] * k) * (ring[j][1] * M_LAT);
  return Math.abs(a / 2);
}
