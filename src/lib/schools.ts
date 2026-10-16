// School lookups on public/data/schools.json (scripts/build-schools.mjs): zoned schools for a point,
// nearby schools by level, district rankings and plain-language score labels.
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { LngLat, School, SchoolsData } from '../model';
import { distanceMeters, walkMinutes } from './grid';
import { polygonAt } from './geo';

export type Level = 'ES' | 'MS' | 'HS';
export interface Zoned {
  es?: School; esZone?: { dbn: string; label: string };
  ms?: School; msZone?: { dbn: string; label: string };
  district?: number;
}

/** First feature whose (Multi)Polygon contains p, holes respected. */
function featureAt(p: LngLat, c: FeatureCollection): Feature | undefined {
  return c.features.find(f => (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') && polygonAt(p, f.geometry as Polygon | MultiPolygon));
}

/** Zoned elementary/middle school and community school district at p. Shared zones list several DBNs; the first known one is returned. */
export function zonedSchools(p: LngLat, d: SchoolsData): Zoned {
  const byDbn = (dbns: string) => dbns.split(',').map(x => d.schools.find(s => s.dbn === x)).find(Boolean);
  const out: Zoned = {};
  const es = featureAt(p, d.esZones)?.properties, ms = featureAt(p, d.msZones)?.properties;
  if (es) { out.esZone = { dbn: es.dbn, label: es.label }; out.es = byDbn(es.dbn); }
  if (ms) { out.msZone = { dbn: ms.dbn, label: ms.label }; out.ms = byDbn(ms.dbn); }
  out.district = featureAt(p, d.districts)?.properties?.district ?? es?.district ?? ms?.district;
  return out;
}

/** Closest schools serving a level, with straight-line metres and grid-walk minutes. */
export function nearbySchools(p: LngLat, d: SchoolsData, level: Level, limit = 5) {
  return d.schools.filter(s => s.levels.includes(level))
    .map(school => { const meters = distanceMeters(p, [school.lon, school.lat]); return { school, meters, minutes: walkMinutes(meters) }; })
    .sort((a, b) => a.meters - b.meters).slice(0, limit);
}

/** Comparable score: mean of ELA/Math proficiency (ES/MS) or 4-year graduation % (HS). */
export function schoolScore(s: School, level: Level): number | undefined {
  if (level === 'HS') return s.grad;
  const xs = [s.ela, s.math].filter((x): x is number => x != null);
  return xs.length ? xs.reduce((a, b) => a + b) / xs.length : undefined;
}

/** Schools of a level in a district, best score first (unscored last). */
export function districtSchools(district: number, d: SchoolsData, level: Level) {
  return d.schools.filter(s => s.district === district && s.levels.includes(level))
    .sort((a, b) => (schoolScore(b, level) ?? -1) - (schoolScore(a, level) ?? -1));
}

/** Plain-language comparison against the citywide average, in percentage points (±3 / ±10 bands). */
export function scoreLabel(v: number, avg: number) {
  const d = v - avg;
  return d >= 10 ? 'Well above average' : d >= 3 ? 'Above average' : d > -3 ? 'Average' : d > -10 ? 'Below average' : 'Well below average';
}
