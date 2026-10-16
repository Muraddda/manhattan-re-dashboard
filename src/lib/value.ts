// Comparable-sales valuation and market summaries over closed sales.
import type { Property, PropType, Valuation } from '../model';

const R = 6371008.8;
/** Great-circle distance in metres. */
export function haversine(lon1: number, lat1: number, lon2: number, lat2: number) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** p in [0,100], linear interpolation between closest ranks. NaN for an empty list. */
export function percentile(xs: number[], p: number) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * p / 100, lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
}
const median = (xs: number[]) => percentile(xs, 50);

/** The newest sale date in the data: windows are anchored there, so an old snapshot still has 12 months of comps. */
const latest = (sales: Property[]) => sales.reduce((m, s) => (s.date && s.date > m ? s.date : m), '');
const monthsBefore = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 10); };

export interface Subject { lon: number; lat: number; type: PropType; sqft?: number; price?: number; beds?: number; bbl?: string; id?: string }
export interface ValuateOpts { months?: number; radii?: number[]; minComps?: number; maxComps?: number; asOf?: string }

export function valuate(subject: Subject, sales: Property[], opts: ValuateOpts = {}): Valuation {
  const { months = 12, radii = [300, 600, 1200], minComps = 8, maxComps = 40 } = opts;
  const since = monthsBefore(opts.asOf ?? latest(sales), months);
  const pool = sales
    .filter(s => s.type === subject.type && s.status === 'Sold' && s.price > 0 && (s.date ?? '') >= since && s.id !== subject.id)
    .map(s => ({ s, d: subject.bbl && s.bbl === subject.bbl ? 0 : haversine(subject.lon, subject.lat, s.lon, s.lat) }))
    .sort((a, b) => a.d - b.d);

  let radiusM = radii[radii.length - 1], near = pool;
  for (const r of radii) { near = pool.filter(c => c.d <= r); radiusM = r; if (near.length >= minComps) break; }
  const comps = near.slice(0, maxComps).map(c => c.s);

  const prices = comps.map(c => c.price), ppsfs = comps.flatMap(c => (c.ppsf ? [c.ppsf] : []));
  const v: Valuation = {
    n: comps.length, basis: 'price', radiusM, months,
    medianPrice: median(prices) || 0, lowPrice: percentile(prices, 25) || 0, highPrice: percentile(prices, 75) || 0,
    comps: comps.slice(0, 12),
  };
  if (subject.sqft && ppsfs.length >= 5) {
    v.basis = 'ppsf';
    v.medianPpsf = median(ppsfs); v.lowPpsf = percentile(ppsfs, 25); v.highPpsf = percentile(ppsfs, 75);
    v.estimate = Math.round(v.medianPpsf * subject.sqft);
  }
  const ref = v.estimate ?? v.medianPrice;
  if (subject.price && ref > 0) v.deltaPct = (subject.price - ref) / ref * 100;
  return v;
}

export interface NeighborhoodStat { n: number; medianPrice: number; medianPpsf?: number; byType: Partial<Record<PropType, number>> }
export function neighborhoodStats(sales: Property[]): Record<string, NeighborhoodStat> {
  const groups = new Map<string, Property[]>();
  for (const s of sales) { let g = groups.get(s.neighborhood); if (!g) groups.set(s.neighborhood, g = []); g.push(s); }
  const out: Record<string, NeighborhoodStat> = {};
  for (const [name, g] of groups) {
    const ppsf = g.flatMap(s => (s.ppsf ? [s.ppsf] : [])), byType: Partial<Record<PropType, number>> = {};
    for (const s of g) byType[s.type] = (byType[s.type] ?? 0) + 1;
    out[name] = { n: g.length, medianPrice: median(g.map(s => s.price)), medianPpsf: ppsf.length ? median(ppsf) : undefined, byType };
  }
  return out;
}

export interface TrendPoint { month: string; n: number; medianPrice?: number; medianPpsf?: number }
/** The 12 calendar months ending with the newest sale's month, oldest first (empty months have n 0). */
export function marketTrend(sales: Property[]): TrendPoint[] {
  const end = latest(sales);
  if (!end) return [];
  const months = Array.from({ length: 12 }, (_, i) => monthsBefore(end.slice(0, 7) + '-01', 11 - i).slice(0, 7));
  return months.map(month => {
    const g = sales.filter(s => s.date?.startsWith(month)), ppsf = g.flatMap(s => (s.ppsf ? [s.ppsf] : []));
    return { month, n: g.length, medianPrice: g.length ? median(g.map(s => s.price)) : undefined, medianPpsf: ppsf.length ? median(ppsf) : undefined };
  });
}
