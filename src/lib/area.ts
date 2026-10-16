// Live, per-home lookups against NYC Open Data (CORS-enabled, no key): lot facts (PLUTO), the building's past sales,
// crime and 311 noise near the home compared with the Manhattan average. Results are cached per session.
import type { LngLat } from '../model';

const SODA = 'https://data.cityofnewyork.us/resource';
const cache = new Map<string, Promise<unknown>>();
function soda<T>(id: string, params: Record<string, string>): Promise<T> {
  const url = `${SODA}/${id}.json?${new URLSearchParams(params)}`;
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(`NYC Open Data ${r.status}`); return r.json(); }).catch(e => { cache.delete(url); throw e; }));
  return cache.get(url) as Promise<T>;
}
const BBL = /^\d{10}$/;
const num = (v?: string) => v == null || v === '' ? undefined : +v;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface LotFacts {
  bbl: string; address: string; zoning?: string; lotArea?: number; bldgArea?: number; resArea?: number;
  maxResFar?: number; builtFar?: number; yearBuilt?: number; floors?: number; unitsRes?: number; unitsTotal?: number;
  historicDistrict?: string; landmark?: string; flood100?: boolean; owner?: string; bldgClass?: string; assessed?: number;
  /** Unused residential floor area under current zoning (sq ft), when positive. */
  airRights?: number;
}
export async function lotFacts(bbl: string): Promise<LotFacts | null> {
  if (!BBL.test(bbl)) return null;
  const [r] = await soda<Record<string, string>[]>('64uk-42ks', {
    $select: 'bbl,address,zonedist1,lotarea,bldgarea,resarea,residfar,builtfar,yearbuilt,numfloors,unitsres,unitstotal,histdist,landmark,pfirm15_flag,ownername,bldgclass,assesstot',
    $where: `bbl=${+bbl}`,
  });
  if (!r) return null;
  const f: LotFacts = {
    bbl, address: r.address, zoning: r.zonedist1, lotArea: num(r.lotarea), bldgArea: num(r.bldgarea), resArea: num(r.resarea),
    maxResFar: num(r.residfar), builtFar: num(r.builtfar), yearBuilt: num(r.yearbuilt) || undefined, floors: num(r.numfloors), unitsRes: num(r.unitsres), unitsTotal: num(r.unitstotal),
    historicDistrict: r.histdist || undefined, landmark: r.landmark || undefined, flood100: r.pfirm15_flag === '1', owner: r.ownername, bldgClass: r.bldgclass, assessed: num(r.assesstot),
  };
  if (f.maxResFar && f.lotArea && f.bldgArea != null) { const left = f.maxResFar * f.lotArea - f.bldgArea; if (left > 0) f.airRights = Math.round(left); }
  return f;
}

export interface PastSale { date: string; price: number; unit?: string; sqft?: number }
/** Recorded sales in a building, 2016 to last year (DOF annualized sales). The current 12 months come from the live sales set. */
export async function buildingSales(bbl: string, units: number[] = [], before?: string): Promise<PastSale[]> {
  if (!BBL.test(bbl)) return [];
  // condo sales are recorded on each unit's own lot (1001+), not the building's billing lot
  const unitLots = units.filter(l => l > 1000 && l < 7500), block = +bbl.slice(1, 6);
  const who = unitLots.length ? `(bbl='${bbl}' or (block='${block}' and lot::number between ${Math.min(...unitLots)} and ${Math.max(...unitLots)}))` : `bbl='${bbl}'`;
  const rows = await soda<Record<string, string>[]>('w2pb-icbu', {
    $select: 'sale_date,sale_price,apartment_number,gross_square_feet', $where: `${who} and sale_price > 100000${before && /^\d{4}-\d{2}-\d{2}$/.test(before) ? ` and sale_date < '${before}'` : ''}`, $order: 'sale_date DESC', $limit: '300',
  });
  return rows.map(r => ({ date: r.sale_date.slice(0, 10), price: +r.sale_price, unit: r.apartment_number?.trim() || undefined, sqft: num(r.gross_square_feet) || undefined }));
}

const MANHATTAN_KM2 = 59.1, BOX_KM2 = 0.8 * 0.8;
/** SoQL filter for an 800 m x 800 m box around p (plain lat/lon ranges are much faster than within_circle on 311). */
function box(p: LngLat) {
  const dLat = 400 / 110574, dLon = 400 / (111320 * Math.cos(p[1] * Math.PI / 180));
  return `latitude between ${(p[1] - dLat).toFixed(6)} and ${(p[1] + dLat).toFixed(6)} and longitude between ${(p[0] - dLon).toFixed(6)} and ${(p[0] + dLon).toFixed(6)}`;
}
export interface Safety { felonies: number; misdemeanors: number; ratio: number; period: string }
const NYPD_YTD = '5uac-w243', NYPD_HISTORIC = 'qgea-i56i'; // "Current (Year To Date)" only holds this year's reports
/** Reported crime in an 800 m box around the home over the latest 12 months of NYPD reports (historic + year-to-date), vs Manhattan. */
export async function safety(p: LngLat): Promise<Safety> {
  const [{ mx }] = await soda<{ mx: string }[]>(NYPD_YTD, { $select: 'max(rpt_dt) as mx' });
  const end = new Date(mx), start = new Date(end); start.setFullYear(end.getFullYear() - 1); start.setDate(start.getDate() + 1);
  const since = `rpt_dt >= '${iso(start)}' and rpt_dt <= '${iso(end)}'`;
  type Row = { law_cat_cd: string; n: string };
  const count = async (where: string) => {
    const parts = await Promise.all([NYPD_HISTORIC, NYPD_YTD].map(id => soda<Row[]>(id, { $select: 'law_cat_cd, count(*) as n', $where: `${where} and ${since}`, $group: 'law_cat_cd' })));
    const out: Record<string, number> = {}; for (const r of parts.flat()) out[r.law_cat_cd] = (out[r.law_cat_cd] ?? 0) + +r.n; return out;
  };
  const [h, a] = await Promise.all([count(box(p)), count('addr_pct_cd between 1 and 34')]);
  return { felonies: h.FELONY ?? 0, misdemeanors: h.MISDEMEANOR ?? 0, ratio: ((h.FELONY ?? 0) / BOX_KM2) / ((a.FELONY || 1) / MANHATTAN_KM2), period: `${iso(start)} to ${iso(end)}` };
}

export interface Noise { complaints: number; ratio: number; top: { type: string; n: number }[] }
/** 311 noise complaints in a ~800 m box around the home over the last 12 months, vs the Manhattan density. */
export async function noise(p: LngLat): Promise<Noise> {
  const since = new Date(); since.setFullYear(since.getFullYear() - 1);
  const w = `starts_with(complaint_type, 'Noise') and created_date >= '${iso(since)}'`;
  const [types, all] = await Promise.all([
    soda<{ descriptor: string; n: string }[]>('erm2-nwe9', { $select: 'descriptor, count(*) as n', $where: `${box(p)} and ${w}`, $group: 'descriptor', $order: 'n DESC', $limit: '60' }),
    soda<{ n: string }[]>('erm2-nwe9', { $select: 'count(*) as n', $where: `borough='MANHATTAN' and ${w}` }),
  ]);
  const top = types.map(t => ({ type: t.descriptor, n: +t.n })), total = top.reduce((a, t) => a + t.n, 0);
  return { complaints: total, ratio: (total / BOX_KM2) / (+all[0].n / MANHATTAN_KM2), top: top.slice(0, 5) };
}

/** Nearest Citi Bike docks with live bikes / docks available (GBFS). */
export async function citiBike(p: LngLat, n = 3) {
  const [info, status] = await Promise.all([
    fetch('/api/citibike/station_information').then(r => r.json()), // GBFS sends no CORS headers: proxied by the Worker
    fetch('/api/citibike/station_status').then(r => r.json()),
  ]);
  const st = new Map<string, { num_bikes_available: number; num_docks_available: number; num_ebikes_available?: number }>(status.data.stations.map((s: { station_id: string }) => [s.station_id, s]));
  const { distanceMeters } = await import('./grid');
  return (info.data.stations as { station_id: string; name: string; lat: number; lon: number }[])
    .map(s => ({ name: s.name, lon: s.lon, lat: s.lat, m: distanceMeters(p, [s.lon, s.lat]), ...st.get(s.station_id) }))
    .sort((a, b) => a.m - b.m).slice(0, n);
}

export interface EnvField { value: unknown; unit: string | null; source: string; url: string; confidence: string; vintage: string | null; notes: string | null }
export interface Environment { fetched: string; fields: Partial<Record<'elevation' | 'coast_distance_m' | 'within_floodplain_polygon' | 'tree_canopy_pct' | 'nearest_major_road_distance_m' | 'nearest_major_road_name' | 'nearest_airport_name' | 'nearest_airport_distance_m', EnvField>> }
const envCache = new Map<string, Promise<Environment>>();
/** Climate & environment facts for a point (Mireye Earth API through the Worker's /api/env; cached 30 days server-side). */
export function environment(p: LngLat): Promise<Environment> {
  const k = `${p[1].toFixed(4)},${p[0].toFixed(4)}`;
  if (!envCache.has(k)) envCache.set(k, fetch(`/api/env?lat=${p[1].toFixed(4)}&lng=${p[0].toFixed(4)}`).then(async r => {
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error(r.status === 429 ? 'Daily lookup limit reached' : 'Unavailable');
    return r.json();
  }).catch(e => { envCache.delete(k); throw e; }));
  return envCache.get(k)!;
}
/** FEMA flood zone from Mireye's NFHL note, e.g. 'Zone X; AREA OF MINIMAL FLOOD HAZARD' -> 'X'. */
export const femaZone = (notes?: string | null) => notes?.match(/Zone ([A-Z0-9]+)/)?.[1];
