// Manhattan PLUTO lots -> public/data/lots.json (compact rows used to place DOF sales on the map).
// Row: [bbl10, block, lot, lon, lat, address]. Run: node scripts/build-lots.mjs
// Also `units`: residential condo unit lots from the DOF assessment roll (8y4t-faws), because DOF sales carry no unit sqft
// and unit lots (1001+) are not in PLUTO. units[block] = flat [lot, grossSqft, condoNo, lot, grossSqft, condoNo, ...];
// condos[condoNo] = billing-lot BBL (PLUTO condono), so a unit sale lands on its building's billing lot.
import { writeFileSync } from 'node:fs';

const OUT = new URL('../public/data/lots.json', import.meta.url);
const BASE = 'https://data.cityofnewyork.us/resource/64uk-42ks.json';
const headers = process.env.SOCRATA_APP_TOKEN ? { 'X-App-Token': process.env.SOCRATA_APP_TOKEN } : {};

async function all(base, params) {
  const out = [];
  for (let offset = 0; ; offset += 50000) {
    const r = await fetch(`${base}?${new URLSearchParams({ ...params, $limit: '50000', $offset: String(offset) })}`, { headers });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const page = await r.json();
    out.push(...page);
    if (page.length < 50000) return out;
  }
}
const rows = await all(BASE, { $select: 'bbl,block,lot,address,latitude,longitude,condono', $where: "borough='MN'", $order: 'bbl' });
// Final roll of the newest year. ponytail: year pinned; bump ROLL_YEAR when DOF publishes the next tentative roll.
const ROLL_YEAR = process.env.ROLL_YEAR ?? '2027';
const res = "('R0','R1','R2','R3','R4','R5','R6','R7','R8','R9','RR')";
const unitRows = await all('https://data.cityofnewyork.us/resource/8y4t-faws.json', {
  $select: 'block,lot,gross_sqft,condo_number',
  $where: `boro=1 AND year='${ROLL_YEAR}' AND period=3 AND lot>=1001 AND gross_sqft>0 AND bldg_class in ${res}`,
  $order: 'block,lot',
});
const units = {};
for (const u of unitRows) (units[u.block] ??= []).push(+u.lot, Math.round(+u.gross_sqft), (+u.condo_number || 0) % 100000); // DOF 100548 = boro 1 + PLUTO condono 548

const r6 = x => Math.round(+x * 1e6) / 1e6;
const lots = rows
  .filter(r => r.bbl && r.latitude && r.longitude)
  .map(r => [String(r.bbl).split('.')[0], +r.block, +r.lot, r6(r.longitude), r6(r.latitude), (r.address ?? '').trim()]);

const condos = {};
for (const r of rows) if (+r.condono > 0 && r.latitude) condos[+r.condono] = String(r.bbl).split('.')[0];

const json = JSON.stringify({ generated: new Date().toISOString(), source: `NYC DCP PLUTO 64uk-42ks (borough MN); DOF assessment roll 8y4t-faws FY${ROLL_YEAR} condo units`, lots, condos, units });
writeFileSync(OUT, json);
console.log(`${rows.length} PLUTO rows, ${lots.length} located lots, ${unitRows.length} condo units, ${(json.length / 1024).toFixed(0)} KB -> ${OUT.pathname}`);
