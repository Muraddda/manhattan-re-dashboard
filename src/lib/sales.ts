// NYC DOF rolling sales (usep-8jbt) -> Property[], placed on PLUTO lots.
import type { Lot, Property, PropType } from '../model';

/** Raw Socrata query the Worker serves at /api/data/sales (and the snapshot public/data/sales.json). Verified 2026-10-16:
 *  sale_price is a numeric column, so `sale_price > 100000` compares numerically without a cast. */
export const SALES_QUERY = "https://data.cityofnewyork.us/resource/usep-8jbt.json?$select=neighborhood,building_class_category,block,lot,address,apartment_number,zip_code,residential_units,total_units,gross_square_feet,year_built,building_class_at_time_of,sale_price,sale_date&$where=borough='1' AND sale_price > 100000&$limit=50000";

export interface RawSale {
  neighborhood?: string; building_class_category?: string; block?: string; lot?: string; address?: string;
  apartment_number?: string; zip_code?: string; residential_units?: string; total_units?: string;
  gross_square_feet?: string; year_built?: string; building_class_at_time_of?: string; sale_price?: string; sale_date?: string;
}

/** public/data/lots.json (scripts/build-lots.mjs). units[block] = flat [unitLot, grossSqft, condoNo, ...]; condos[condoNo] = billing-lot BBL. */
export interface LotsFile {
  generated: string; source: string;
  lots: [string, number, number, number, number, string][];
  condos?: Record<string, string>;
  units?: Record<string, number[]>;
}
export interface LotsIndex {
  byBbl: Map<string, Lot>;
  byBlock: Map<number, Lot[]>;
  /** condo unit BBL -> DOF roll gross sqft and its billing-lot BBL (when known) */
  units: Map<string, { sqft: number; billing?: string }>;
}

export const bblOf = (block: number, lot: number) => '1' + String(block).padStart(5, '0') + String(lot).padStart(4, '0');

export function loadLots(json: LotsFile): LotsIndex {
  const byBbl = new Map<string, Lot>(), byBlock = new Map<number, Lot[]>(), units = new Map<string, { sqft: number; billing?: string }>(), condos = json.condos ?? {};
  for (const [bbl, block, lot, lon, lat, address] of json.lots) {
    const l: Lot = { bbl, block, lot, lon, lat, address };
    byBbl.set(bbl, l);
    let b = byBlock.get(block); if (!b) byBlock.set(block, b = []); b.push(l);
  }
  for (const [block, a] of Object.entries(json.units ?? {}))
    for (let i = 0; i < a.length; i += 3) { const k = bblOf(+block, a[i]); if (!units.has(k)) units.set(k, { sqft: a[i + 1], billing: condos[a[i + 2]] }); }
  return { byBbl, byBlock, units };
}

const num = (s?: string) => { const n = Number(String(s ?? '').replace(/[,$\s]/g, '')); return Number.isFinite(n) ? n : 0; };

export const titleCase = (s: string) => ordinals(s.toLowerCase().replace(/(^|[\s(\-/])([a-z])/g, (_, p, c) => p + c.toUpperCase()).trim());
const ORD = (n: number) => n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
/** DOF writes 'EAST 13 STREET'; people write 'East 13th Street'. */
export const ordinals = (s: string) => s.replace(/\b(East|West|E|W)\s+(\d+)\s+(Street|St)\b/g, (_, d, n, t) => `${d} ${n}${ORD(+n)} ${t}`).replace(/\b(\d+)\s+(Avenue|Ave)\b/g, (m, n, t, off, all) => /^\d+\s/.test(all.slice(off)) && off === 0 ? m : `${n}${ORD(+n)} ${t}`);

const ABBR: Record<string, string> = {
  STREET: 'ST', AVENUE: 'AVE', AV: 'AVE', PLACE: 'PL', ROAD: 'RD', BOULEVARD: 'BLVD', DRIVE: 'DR', LANE: 'LN', SQUARE: 'SQ', TERRACE: 'TER',
  PARKWAY: 'PKWY', PLAZA: 'PLZ', COURT: 'CT', EAST: 'E', WEST: 'W', NORTH: 'N', SOUTH: 'S', SAINT: 'ST',
};
/** '15 WILLIAM STREET, 32B' -> '15 WILLIAM ST'; 'EAST 3RD STREET' -> 'E 3 ST'. */
export function normAddress(a: string) {
  return splitUnit(a).street.toUpperCase().replace(/[.,#]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => ABBR[w] ?? w.replace(/^(\d+)(ST|ND|RD|TH)$/, '$1')).join(' ');
}
/** Split a DOF address into building address and unit: ', 32B' suffix, or a trailing APT/UNIT/STE/PH token. */
export function splitUnit(a: string): { street: string; unit?: string } {
  const s = a.trim().replace(/\s+/g, ' ');
  const comma = s.indexOf(',');
  if (comma > 0) return { street: s.slice(0, comma).trim(), unit: s.slice(comma + 1).trim() || undefined };
  const m = s.match(/^(.*?)\s+(?:APT|APARTMENT|UNIT|STE|SUITE|#)\.?\s*(\S+)$/i);
  return m ? { street: m[1], unit: m[2] } : { street: s };
}

const TYPE_BY_CODE: Record<string, PropType | undefined> = {
  '01': 'townhouse', '02': 'townhouse', '03': 'townhouse',
  '04': 'condo', '12': 'condo', '13': 'condo', '15': 'condo', '16': 'condo',
  '09': 'coop', '10': 'coop', '17': 'coop',           // 17 CONDO COOPS: co-op apartments in a condo-unit building; no sqft
  '07': 'multifamily', '08': 'multifamily', '14': 'multifamily',
};
/** null = not a home (commercial, office, garage, condo hotel, parking, storage...: every category 21+). */
export function typeOf(category = ''): PropType | null {
  const code = category.slice(0, 2);
  if (TYPE_BY_CODE[code]) return TYPE_BY_CODE[code]!;
  return +code >= 21 || !/^\d\d$/.test(code) ? null : 'other';
}

const blockCentroid = (lots: Lot[]): [number, number] => [lots.reduce((s, l) => s + l.lon, 0) / lots.length, lots.reduce((s, l) => s + l.lat, 0) / lots.length];

/** The lot on `block` whose PLUTO address is the sale's building address (exact, else same street within 20 house numbers). */
function lotByAddress(lots: Lot[], address: string): Lot | undefined {
  const want = normAddress(address);
  const exact = lots.find(l => l.address && normAddress(l.address) === want);
  if (exact) return exact;
  const m = want.match(/^(\d+)(?:-\d+)? (.+)$/);
  if (!m) return;
  let best: Lot | undefined, bestD = 21;
  for (const l of lots) {
    const k = l.address && normAddress(l.address).match(/^(\d+)(?:-\d+)? (.+)$/);
    if (!k || k[2] !== m[2]) continue;
    const d = Math.abs(+k[1] - +m[1]);
    if (d < bestD && (d % 2 === 0)) { best = l; bestD = d; }   // same side of the street
  }
  return best;
}

export function toProperties(rows: RawSale[], lots: LotsFile | LotsIndex): Property[] {
  const ix = 'byBbl' in lots ? lots : loadLots(lots);
  const priced = rows.filter(r => num(r.sale_price) >= 100_000);
  // Package deals: one deed for many lots repeats the full price on every row; none of them is a unit price.
  const pkg = new Map<string, number>();
  const pkgKey = (r: RawSale) => `${num(r.block)}|${(r.sale_date ?? '').slice(0, 10)}|${num(r.sale_price)}`;
  for (const r of priced) pkg.set(pkgKey(r), (pkg.get(pkgKey(r)) ?? 0) + 1);

  const out: Property[] = [], seen = new Set<string>();
  for (const r of priced) {
    if ((pkg.get(pkgKey(r)) ?? 0) > 3) continue;
    const type = typeOf(r.building_class_category);
    if (!type) continue;
    const block = num(r.block), lot = num(r.lot), price = num(r.sale_price), date = (r.sale_date ?? '').slice(0, 10);
    if (!block || !/^\d{4}-\d\d-\d\d$/.test(date)) continue;

    const { street, unit: addrUnit } = splitUnit(r.address ?? '');
    const unit = (r.apartment_number ?? '').trim() || addrUnit;
    const id = `sale:${block}-${lot}-${date.replace(/-/g, '')}-${unit || 0}`;
    if (seen.has(id)) continue;   // exact duplicate rows
    seen.add(id);

    const bbl = bblOf(block, lot), roll = ix.units.get(bbl);
    let at: Lot | undefined = ix.byBbl.get(bbl), located: Property['located'] = 'lot';
    if (!at && roll?.billing) at = ix.byBbl.get(roll.billing);          // condo unit -> its billing lot (DOF roll condo number)
    const blockLots = ix.byBlock.get(block);
    if (!at && blockLots) { at = lotByAddress(blockLots, street); located = 'address'; }
    let lon: number, lat: number;
    if (at) ({ lon, lat } = at);
    else if (blockLots?.length) { [lon, lat] = blockCentroid(blockLots); located = 'block'; }
    else continue;

    const gsf = num(r.gross_square_feet), resUnits = num(r.residential_units);
    let sqft: number | undefined;
    if (type === 'condo') {
      if (gsf >= 250 && gsf <= 15000 && resUnits <= 1) sqft = gsf;
      else if (roll && roll.sqft >= 250 && roll.sqft <= 15000) sqft = roll.sqft;
    } else if ((type === 'townhouse' || type === 'multifamily') && gsf > 0) sqft = gsf;

    out.push({
      id, source: 'sale', address: titleCase(street), unit: unit || undefined, zip: r.zip_code || undefined,
      neighborhood: titleCase(r.neighborhood ?? ''), lon, lat, located, bbl: at?.bbl, type,
      buildingClass: r.building_class_category, status: 'Sold', price, date,
      sqft, ppsf: sqft ? Math.round(price / sqft) : undefined,
      yearBuilt: num(r.year_built) || undefined, totalUnits: num(r.total_units) || undefined,
    });
  }
  return out;
}
