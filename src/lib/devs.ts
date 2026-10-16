// New residential buildings from the DCP Housing Database ('devs' dataset, br6q-ssj3 raw Socrata rows).
import type { Development } from '../model';

export interface DevRow {
  job_number: string; addressnum?: string; addressst?: string; latitude?: string; longitude?: string; job_status: string;
  classaprop?: string; units_co?: string; floorsprop?: string; datefiled?: string; datepermit?: string; datecomplt?: string;
  ownership?: string; nta2020?: string; ntaname20?: string; schelmntry?: string; schmiddle?: string; bbl?: string;
}

// '3. Permitted for Construction' -> 'Permitted'; unknown codes keep their text minus the number prefix.
const STATUS: Record<string, string> = { '1': 'Filed', '2': 'Approved', '3': 'Permitted', '4': 'Partially Completed', '5': 'Completed', '9': 'Withdrawn' };
const status = (s: string) => STATUS[s.match(/^(\d+)\./)?.[1] ?? ''] ?? s.replace(/^\d+\.\s*/, '');
const num = (s?: string) => (s ? Number(s) : NaN);
const day = (s?: string) => s?.slice(0, 10) || undefined;
const school = (s?: string) => (s && Number.isFinite(num(s)) ? String(Math.trunc(num(s))) : undefined); // '509.0' -> '509'
const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

export function toDevelopments(rows: DevRow[]): Development[] {
  return rows.flatMap(r => {
    const lon = num(r.longitude), lat = num(r.latitude);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
    const st = status(r.job_status);
    const units = st === 'Completed' && num(r.units_co) > 0 ? num(r.units_co) : num(r.classaprop);
    return [{
      id: `hdb:${r.job_number}`, address: title(`${r.addressnum ?? ''} ${r.addressst ?? ''}`.trim()), lon, lat, bbl: r.bbl,
      status: st, units: Number.isFinite(units) ? Math.round(units) : 0, floors: Number.isFinite(num(r.floorsprop)) ? num(r.floorsprop) : undefined,
      filed: day(r.datefiled), permitted: day(r.datepermit), completed: day(r.datecomplt),
      owner: r.ownership, neighborhood: r.ntaname20, schoolEs: school(r.schelmntry), schoolMs: school(r.schmiddle),
    }];
  });
}

export function devSummary(devs: Development[]) {
  const byStatus: Record<string, { count: number; units: number }> = {};
  for (const d of devs) (byStatus[d.status] ??= { count: 0, units: 0 }, byStatus[d.status].count++, byStatus[d.status].units += d.units);
  return { count: devs.length, units: devs.reduce((a, d) => a + d.units, 0), byStatus };
}
