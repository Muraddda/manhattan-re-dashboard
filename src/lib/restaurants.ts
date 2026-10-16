// DOHMH restaurant inspection grades ('restaurants' dataset, 43nn-pn8j rows grouped per camis + graded inspection) -> map places.
import type { Diet, Place } from '../model';

export interface RestaurantRow {
  camis: string; dba?: string; cuisine_description?: string; grade?: string; grade_date?: string;
  building?: string; street?: string; latitude?: string; longitude?: string;
}

const DIETS: Record<string, Diet[]> = { 'jewish/kosher': ['kosher'], vegan: ['vegan', 'vegetarian'], vegetarian: ['vegetarian'], halal: ['halal'] };
const title = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').replace(/(^|[\s/(-])([a-z])/g, (_, p, c) => p + c.toUpperCase());

export function toRestaurants(rows: RestaurantRow[]): Place[] {
  const latest = new Map<string, RestaurantRow>();
  for (const r of rows) {
    const prev = latest.get(r.camis);
    if (!prev || (r.grade_date ?? '') > (prev.grade_date ?? '')) latest.set(r.camis, r); // ISO dates compare as strings
  }
  return [...latest.values()].flatMap(r => {
    const lon = Number(r.longitude), lat = Number(r.latitude);
    if (!lon || !lat) return [];
    const cuisine = r.cuisine_description?.toLowerCase();
    const diets = cuisine ? DIETS[cuisine] : undefined;
    const addr = [r.building, r.street].filter(Boolean).join(' ');
    return [{
      id: `dohmh:${r.camis}`, cat: 'dining' as const, sub: 'restaurant', name: title(r.dba ?? ''), lon, lat,
      grade: r.grade, cuisine, ...(diets && { diets }), ...(addr && { addr: title(addr) }),
    }];
  });
}
