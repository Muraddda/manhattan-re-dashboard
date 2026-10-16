// Self-check for src/lib/sales.ts + value.ts on the committed snapshots. Run: node scripts/test-sales.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'mrd-sales-'));
writeFileSync(join(dir, 'entry.ts'), `export * from '${root}src/lib/sales.ts'; export * from '${root}src/lib/value.ts';`);
execFileSync('npx', ['-y', 'esbuild@0.25', join(dir, 'entry.ts'), '--bundle', '--format=esm', '--platform=node', `--outfile=${join(dir, 'lib.mjs')}`, '--log-level=warning'], { stdio: 'inherit' });
const { toProperties, valuate, neighborhoodStats, marketTrend, percentile, normAddress, splitUnit } = await import(join(dir, 'lib.mjs'));

const read = f => JSON.parse(readFileSync(join(root, 'public/data', f), 'utf8'));
const raw = read('sales.json'), lots = read('lots.json');

// unit checks
assert.equal(normAddress('15 WILLIAM STREET, 32B'), '15 WILLIAM ST');
assert.equal(normAddress('327 East 3rd Street'), '327 E 3 ST');
assert.deepEqual(splitUnit('235 EAST 22ND STREET STE A'), { street: '235 EAST 22ND STREET', unit: 'A' });
assert.equal(percentile([1, 2, 3, 4], 50), 2.5);

const t0 = performance.now();
const props = toProperties(raw, lots);
const ms = performance.now() - t0;
const count = (xs, f) => xs.reduce((m, x) => (m[f(x)] = (m[f(x)] ?? 0) + 1, m), {});
const pct = (a, b) => (100 * a / b).toFixed(1) + '%';

assert.equal(new Set(props.map(p => p.id)).size, props.length, 'ids unique');
assert.ok(props.length >= 10000, `>= 10k located, got ${props.length}`);
const condos = props.filter(p => p.type === 'condo');
const condoExact = condos.filter(p => p.located === 'lot' || p.located === 'address').length;
assert.ok(condoExact / condos.length >= 0.8, `condo lot/address share ${pct(condoExact, condos.length)}`);
const condoPpsf = condos.flatMap(p => p.ppsf ? [p.ppsf] : []);
const medCondoPpsf = percentile(condoPpsf, 50);
assert.ok(medCondoPpsf >= 1200 && medCondoPpsf <= 2500, `condo median ppsf ${medCondoPpsf}`);
assert.ok(props.every(p => p.price >= 100000 && p.lon < -73.9 && p.lon > -74.05 && p.lat > 40.68 && p.lat < 40.89), 'prices and coords sane');

const v = valuate({ lon: -73.9888, lat: 40.7383, type: 'condo', sqft: 1200, price: 2_000_000 }, props);
assert.ok(v.n >= 8, `comps ${v.n}`);
assert.equal(v.basis, 'ppsf');
assert.ok(v.comps.length <= 12 && v.estimate > 0);
const coop = valuate({ lon: -73.9588, lat: 40.7736, type: 'coop', price: 1_000_000 }, props);
assert.equal(coop.basis, 'price');
const self = props.find(p => p.type === 'condo' && p.sqft);
assert.ok(!valuate({ ...self, id: self.id }, props).comps.some(c => c.id === self.id), 'subject excluded');

const trend = marketTrend(props), hoods = neighborhoodStats(props);
assert.equal(trend.length, 12);

console.log(`raw rows ${raw.length} -> properties ${props.length} (${ms.toFixed(0)} ms)`);
console.log('by type', count(props, p => p.type));
console.log('located', count(props, p => p.located));
for (const t of ['condo', 'coop', 'townhouse', 'multifamily', 'other']) {
  const g = props.filter(p => p.type === t); if (!g.length) continue;
  const l = count(g, p => p.located), w = g.filter(p => p.ppsf);
  console.log(`  ${t.padEnd(11)} n=${g.length} lot ${pct(l.lot ?? 0, g.length)} address ${pct(l.address ?? 0, g.length)} block ${pct(l.block ?? 0, g.length)} | sqft ${pct(w.length, g.length)} median ppsf ${w.length ? Math.round(percentile(w.map(p => p.ppsf), 50)) : '-'} | median price ${Math.round(percentile(g.map(p => p.price), 50))}`);
}
console.log(`condo lot/address ${pct(condoExact, condos.length)}, condo median ppsf $${Math.round(medCondoPpsf)}`);
console.log(`Flatiron condo 1200 sqft @ $2.0M: n=${v.n} r=${v.radiusM}m basis=${v.basis} median ppsf ${Math.round(v.medianPpsf)} (IQR ${Math.round(v.lowPpsf)}-${Math.round(v.highPpsf)}) estimate $${v.estimate} delta ${v.deltaPct.toFixed(1)}%`);
console.log(`UES coop @ $1.0M: n=${coop.n} r=${coop.radiusM}m median $${coop.medianPrice} delta ${coop.deltaPct.toFixed(1)}%`);
console.log('trend', trend.map(t => `${t.month}:${t.n}`).join(' '));
console.log(`${Object.keys(hoods).length} neighborhoods; e.g. Flatiron`, hoods['Flatiron']);
console.log('OK');
