// Any NYC address or landmark -> point + BBL, via NYC Planning Labs GeoSearch (city geocoder, CORS-enabled, no key).
import type { LngLat } from '../model';
import { titleCase } from './sales';

/** '40 EAST 19 STREET, Manhattan' -> '40 East 19th Street, Manhattan' (keeps 'NY'). */
const pretty = (label: string) => label.split(', ').map((part, i) => i === 0 ? titleCase(part) : part).join(', ');

export interface GeoHit { label: string; lon: number; lat: number; bbl?: string; borough?: string; neighbourhood?: string }
const GS = 'https://geosearch.planninglabs.nyc/v2';

function hits(j: { features?: { geometry: { coordinates: LngLat }; properties: { label: string; borough?: string; neighbourhood?: string; addendum?: { pad?: { bbl?: string } } } }[] }): GeoHit[] {
  return (j.features ?? []).map(f => ({
    label: pretty(f.properties.label.replace(/, New York, NY, USA$/, ', Manhattan').replace(/, USA$/, '')),
    lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], bbl: f.properties.addendum?.pad?.bbl,
    borough: f.properties.borough, neighbourhood: f.properties.neighbourhood,
  }));
}
/** Type-ahead suggestions (Manhattan first). */
export async function suggest(text: string, signal?: AbortSignal): Promise<GeoHit[]> {
  if (text.trim().length < 3) return [];
  const r = await fetch(`${GS}/autocomplete?${new URLSearchParams({ text })}`, { signal });
  if (!r.ok) return [];
  return hits(await r.json()).sort((a, b) => +(b.borough === 'Manhattan') - +(a.borough === 'Manhattan')).slice(0, 6);
}
/** Best single match for a full address. The geocoder always answers with *something* (even for made-up streets),
 *  so the result is only accepted when its house number and street name agree with the input. */
export async function geocode(text: string): Promise<GeoHit | undefined> {
  const r = await fetch(`${GS}/search?${new URLSearchParams({ text, size: '1' })}`);
  const hit = r.ok ? hits(await r.json())[0] : undefined;
  return hit && sameAddress(text, hit.label) ? hit : undefined;
}
const WORDS: Record<string, string> = { E: 'EAST', W: 'WEST', N: 'NORTH', S: 'SOUTH', ST: 'STREET', AVE: 'AVENUE', AV: 'AVENUE', PL: 'PLACE', RD: 'ROAD', BLVD: 'BOULEVARD', DR: 'DRIVE', LN: 'LANE', SQ: 'SQUARE', PKWY: 'PARKWAY' };
const GENERIC = new Set(['EAST', 'WEST', 'NORTH', 'SOUTH', 'STREET', 'AVENUE', 'PLACE', 'ROAD', 'BOULEVARD', 'DRIVE', 'LANE', 'SQUARE', 'PARKWAY', 'NEW', 'YORK', 'NY', 'USA', 'MANHATTAN', 'THE', 'OF']);
const tokens = (s: string) => s.toUpperCase().split(',')[0].replace(/(\d+)(ST|ND|RD|TH)\b/g, '$1').split(/[^A-Z0-9]+/).filter(Boolean).map(w => WORDS[w] ?? w);
/** Same house number and at least one shared distinctive street word ('19', 'GOUVERNEUR', 'BROADWAY'...). */
export function sameAddress(input: string, label: string) {
  const a = tokens(input), b = tokens(label);
  if (/^\d/.test(a[0] ?? '') && a[0] !== b[0]) return false;
  const key = a.slice(1).filter(w => !GENERIC.has(w));
  return key.length === 0 ? true : key.some(w => b.includes(w));
}
