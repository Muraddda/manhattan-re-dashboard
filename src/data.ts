import Papa from 'papaparse';
import type { Amenities, Amenity, Building, Development, Listing, LngLat } from './types';

/** fetch that throws on HTTP errors instead of handing an error page to the parser. */
async function get(url: string) { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r; }
const getJson = async (url: string) => (await get(url)).json();

export async function loadListings(url = '/listings.csv'): Promise<Listing[]> {
  const text = await (await get(url)).text();
  const { data } = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  return data.map(r => ({
    id: r.id, address: r.address, neighborhood: r.neighborhood, lat: +r.lat, lon: +r.lon,
    price: +r.price, beds: +r.beds, baths: +r.baths, sqft: +r.sqft, status: r.status, type: r.type,
    sample: String(r.sample).toLowerCase() !== 'false',
  }));
}
export async function loadBuildings(): Promise<Building[]> { return (await getJson('/data/buildings.json')).buildings; }
/** Simplified city: one feature per street block + individual landmarks/listing buildings (scripts/make-blocks.py). */
export async function loadBlocks(): Promise<{ items: Building[]; buildingToBlock: Record<string, string> }> {
  const j = await getJson('/data/blocks.json');
  const items: Building[] = j.items.map((it: Building & { parts: LngLat[][][] }) => ({ ...it, polys: it.parts, parts: it.parts.map(p => p[0]), colour: null }));
  return { items, buildingToBlock: j.buildingToBlock };
}
export async function loadAmenities(): Promise<Amenities> {
  const j = await getJson('/data/amenities.json');
  return { grocery: j.grocery, schools: j.schools, parks: j.parks, subway: j.subway };
}
export async function loadDevelopments(): Promise<Development[]> { return (await getJson('/data/developments.json')).developments; }

export function distanceMeters(a: LngLat, b: LngLat) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toR, dLon = (b[0] - a[0]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** Approx walking minutes: straight-line × 1.25 grid detour factor ÷ 80 m/min (~4.8 km/h). */
export const walkMinutes = (m: number) => Math.max(1, Math.round((m * 1.25) / 80));
export function nearest(p: LngLat, list: Amenity[]) {
  let best: Amenity | null = null, bd = Infinity;
  for (const a of list) { const d = distanceMeters(p, [a.lon, a.lat]); if (d < bd) { bd = d; best = a; } }
  return best ? { amenity: best, meters: bd, minutes: walkMinutes(bd) } : null;
}
function pointInRing([x, y]: LngLat, ring: LngLat[]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** Attach each listing to the building footprint containing it (or nearest centroid within 60 m). */
export function matchBuilding(p: LngLat, buildings: Building[]): string | undefined {
  let best: Building | undefined, bd = 60;
  for (const b of buildings) {
    if (Math.abs(b.centroid[0] - p[0]) > 0.003 || Math.abs(b.centroid[1] - p[1]) > 0.003) continue;
    if (b.parts.some(r => pointInRing(p, r))) return b.id;
    const d = distanceMeters(p, b.centroid); if (d < bd) { bd = d; best = b; }
  }
  return best?.id;
}
export const fmtPrice = (n: number) => n >= 999500 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}K`;
