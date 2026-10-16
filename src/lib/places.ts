// Food & daily-life around a home: groceries by kind, restaurants by diet / cuisine, Michelin stars, parks, gyms.
// Sources: OpenStreetMap (groceries, diet tags, parks), NYC DOHMH inspections (every licensed restaurant + grade),
// Michelin list (scripts/build-dining.mjs).
import type { Diet, LngLat, Place } from '../model';
import { Grid, walkRadius, walkMinutes } from './grid';

export const DIETS: { key: Diet; label: string }[] = [
  { key: 'kosher', label: 'Kosher' }, { key: 'halal', label: 'Halal' }, { key: 'vegan', label: 'Vegan' },
  { key: 'vegetarian', label: 'Vegetarian' }, { key: 'gluten_free', label: 'Gluten-free' }, { key: 'organic', label: 'Organic' },
];
export const GROCERY_KINDS: { key: string; label: string }[] = [
  { key: 'premium', label: 'Premium grocer' }, { key: 'supermarket', label: 'Supermarket' }, { key: 'organic', label: 'Organic / health' },
  { key: 'asian', label: 'Asian market' }, { key: 'indian', label: 'Indian market' }, { key: 'latin', label: 'Latin market' }, { key: 'italian', label: 'Italian market' },
];
export interface Michelin { name: string; stars: number; cuisine?: string; lon: number; lat: number; neighborhood?: string }

export class PlaceIndex {
  readonly grid: Grid<Place>;
  readonly michelin: Grid<Michelin>;
  constructor(osm: Place[], restaurants: Place[], michelin: Michelin[]) {
    // DOHMH is the complete restaurant list; OSM adds diet tags (vegan, gluten-free...) DOHMH does not record.
    const rgrid = new Grid(restaurants);
    const extra = osm.filter(p => p.cat !== 'dining' || (p.diets?.length && !rgrid.within([p.lon, p.lat], 40).some(r => similar(r.item.name, p.name))));
    for (const p of osm) if (p.cat === 'dining' && p.diets?.length) { // copy OSM diet tags onto the matching DOHMH record
      const hit = rgrid.within([p.lon, p.lat], 40).find(r => similar(r.item.name, p.name));
      if (hit) hit.item.diets = [...new Set([...(hit.item.diets ?? []), ...p.diets])];
    }
    this.grid = new Grid([...restaurants, ...extra]);
    this.michelin = new Grid(michelin);
  }
  /** Nearest place of a grocery kind, or of any grocery that serves a diet. */
  nearestGrocery(p: LngLat, by: { kind?: string; diet?: Diet }) {
    const hit = this.grid.nearest(p, x => x.cat === 'grocery' && (!by.kind || x.sub === by.kind) && (!by.diet || !!x.diets?.includes(by.diet)), 2500);
    return hit && { place: hit.item, m: hit.m, min: walkMinutes(hit.m) };
  }
  /** Restaurants within a walk, optionally serving every diet in `diets`. */
  restaurants(p: LngLat, minutes = 10, diets: Diet[] = []) {
    return this.grid.within(p, walkRadius(minutes), x => x.cat === 'dining' && diets.every(d => x.diets?.includes(d)));
  }
  /** Best walk minutes to anything matching a diet (grocery or restaurant). */
  dietMinutes(p: LngLat, diet: Diet, maxMin = 20) {
    const hit = this.grid.nearest(p, x => (x.cat === 'grocery' || x.cat === 'dining') && !!x.diets?.includes(diet), walkRadius(maxMin));
    return hit ? walkMinutes(hit.m) : undefined;
  }
  starsNear(p: LngLat, minutes = 15) { return this.michelin.within(p, walkRadius(minutes)); }
  nearestOf(p: LngLat, cat: Place['cat']) { const h = this.grid.nearest(p, x => x.cat === cat, 2500); return h && { place: h.item, m: h.m, min: walkMinutes(h.m) }; }
  countWithin(p: LngLat, cat: Place['cat'], minutes: number) { return this.grid.within(p, walkRadius(minutes), x => x.cat === cat).length; }
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
function similar(a: string, b: string) { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); }

/** Short cuisine label from a DOHMH/OSM cuisine string. */
export const cuisineLabel = (c?: string) => c ? c.split(/[;/]/)[0].replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase()) : 'Restaurant';
