// Builds contract-shaped Listing[] for the mock layer from all Data Analyst CSVs (deduped; later files win).
// Coordinates come from scripts/geocode-cache.json (run `node scripts/geocode.mjs` first: NYC GeoSearch for NY, Census for NJ).
import fs from 'node:fs';
import Papa from 'papaparse';
const FILES = ['../../../data-analyst/trial-10/listings.csv', '../../../data-analyst/poc-100/listings.csv', '../../../data-analyst/poc-100/browser-sites.csv', '../../../data-analyst/poc-100/listings-batch2.csv'];
const read = (p) => Papa.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'), { header: true, skipEmptyLines: true }).data;
const GEO = JSON.parse(fs.readFileSync(new URL('./geocode-cache.json', import.meta.url), 'utf8'));

const all = FILES.flatMap(read);
// Glenwood shows listing IDs instead of unit numbers.
for (const r of all) if (!r.unit) { const m = (r.notes || '').match(/listing ID (\w+)/i); if (m) r.unit = `ID ${m[1]}`; }
const byKey = new Map(); for (const r of all) byKey.set(`${r.building_name}|${r.address}|${r.unit}`.toLowerCase(), r);
const rows = [...byKey.values()];

const UDR = ['View 34', '10 Hanover Square', '95 Wall', '21 Chelsea'];
function rentBasis(r) {
  const n = r.notes || '';
  if (/net[- ]effective/i.test(n)) return 'net_effective';
  if (/StuyTown/.test(r.building_name)) return 'twelve_month';
  if (/Newport Rentals/.test(r.building_name)) return 'base_before_fees';
  if (UDR.includes(r.building_name) || /lowest base rent/i.test(n)) return 'lowest_term';
  return 'listed';
}
const gross = (n) => { const m = (n || '').match(/gross (?:price|rent)\s*\$([\d,]+)/i); return m ? Number(m[1].replace(/,/g, '')) : null; };
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
function parseDate(s, checked) {
  s = (s || '').trim(); if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.toLowerCase().match(/^([a-z]+)\s+(\d{1,2})$/); if (!m || !MONTHS.includes(m[1])) return null;
  const c = new Date(checked + 'T00:00:00Z'); let y = c.getUTCFullYear(); const mo = MONTHS.indexOf(m[1]);
  if (new Date(Date.UTC(y, mo, +m[2])) < new Date(c.getTime() - 31 * 864e5)) y++;
  return `${y}-${String(mo + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}
const pets = (p) => { p = (p || '').toLowerCase();
  if (!p) return 'unknown'; if (/no pet|none/.test(p)) return 'none';
  if (/cat/.test(p) && /dog/.test(p)) return 'allowed'; if (/cat/.test(p)) return 'cats'; if (/dog/.test(p)) return 'dogs';
  if (/allow|yes|friendly/.test(p)) return 'allowed'; return 'unknown'; };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const out = rows.map((r, i) => {
  const g = GEO[`${r.address}|${r.city}|${r.state}`] ?? null; const now = /^(available\s+)?(now|immediate(ly)?)$/i.test((r.available_date || '').trim());
  const pp = pets(r.pets_policy);
  return { id: `lst_${String(i + 1).padStart(3, '0')}`, building_id: `bld_${slug(r.building_name)}`, building_name: r.building_name,
    address: r.address, city: r.city, state: r.state === 'NJ' ? 'NJ' : 'NY', zip: r.zip || g?.zip || '',
    lat: g ? g.lat : null, lng: g ? g.lng : null, unit: r.unit, rent: Number(r.rent), beds: Number(r.beds), baths: Number(r.baths),
    sqft: r.sqft ? Number(r.sqft) : null,
    available_date: now ? r.checked_at : parseDate(r.available_date, r.checked_at), available_now: now,
    rent_basis: rentBasis(r), gross_rent: gross(r.notes), pets_policy: pp,
    fee_info: r.fee_info || null, leasing_contact: r.leasing_contact || null, source_url: r.source_url, checked_at: r.checked_at,
    needs_verification: true, stale: false,
    unverified: pp === 'unknown' || (r.building_name.startsWith('Parkside West') && r.unit === '2412'),
    source_flags: /owner opposes scraping/i.test(r.notes || '') ? ['owner_opposes_scraping'] : [],
    geocode_source: g ? g.source : null };
});
fs.writeFileSync(new URL('../src/mocks/listings.json', import.meta.url), JSON.stringify(out, null, 1));
const c = (f) => out.filter(f).length;
console.log(`rows in: ${all.length}; units: ${out.length}; buildings: ${new Set(out.map((l) => l.building_id)).size}; addresses: ${new Set(out.map((l) => l.address)).size}`);
console.log(`no coords: ${c((l) => l.lat == null)}; net_effective: ${c((l) => l.rent_basis === 'net_effective')} (gross known ${c((l) => l.gross_rent)}); owner_opposes: ${c((l) => l.source_flags.length)} units / ${new Set(out.filter((l) => l.source_flags.length).map((l) => l.building_id)).size} bldgs; date null: ${c((l) => !l.available_date)}; now: ${c((l) => l.available_now)}`);
