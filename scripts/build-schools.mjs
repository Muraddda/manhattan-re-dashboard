// Manhattan public schools, zones and scores for the school panel.
// Output public/data/schools.json (SchoolsData in src/model.ts):
//   schools    locations (2019-20 School Locations) + any zoned DBN missing there, at its zone centroid
//   esZones / msZones / districts   2024-25 zone maps, simplified (~10 m Douglas-Peucker, 5-decimal coords)
//   scores     grades 3-8 ELA/Math % Level 3+4 for the latest year (DOE InfoHub xlsx), 4-year grad % (mjm3-8dw8)
//   averages   citywide tested/cohort-weighted means for the same years
// Run: node scripts/build-schools.mjs   (needs `unzip`; downloads ~100 MB of xlsx, ~1 min)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SODA = 'https://data.cityofnewyork.us/resource';
const INFOHUB = 'https://infohub.nyced.org/docs/default-source/default-document-library';
const OUT = new URL('../public/data/schools.json', import.meta.url);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'schools-'));
const sources = [];

async function get(url, as = 'json') {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return as === 'json' ? r.json() : Buffer.from(await r.arrayBuffer());
}
const soda = (id, q) => get(`${SODA}/${id}.json?${new URLSearchParams({ $limit: '50000', ...q })}`);

// ---------- geometry ----------
const M_LAT = 110574, M_LON = 111320 * Math.cos(40.78 * Math.PI / 180);
/** Douglas-Peucker on a lon/lat ring, tolerance in metres. */
function simplify(pts, tol = 10) {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a][0] * M_LON, ay = pts[a][1] * M_LAT, bx = pts[b][0] * M_LON, by = pts[b][1] * M_LAT;
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let best = 0, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] * M_LON - ax, py = pts[i][1] * M_LAT - ay;
      const d = len ? Math.abs(dx * py - dy * px) / len : Math.hypot(px, py);
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
}
/** Simplify a (Multi)Polygon to a MultiPolygon, dropping rings that collapse. */
function simplifyGeom(g) {
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
    .map(rings => rings.map(r => simplify(r)).filter(r => r.length >= 4))
    .filter(rings => rings.length);
  return { type: 'MultiPolygon', coordinates: polys };
}
/** Area-weighted centroid of the largest outer ring. */
function centroid(g) {
  let best = null, ba = 0;
  for (const [ring] of g.coordinates) {
    let a = 0, x = 0, y = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; a += f; x += (ring[j][0] + ring[i][0]) * f; y += (ring[j][1] + ring[i][1]) * f; }
    if (Math.abs(a) > ba) { ba = Math.abs(a); best = [+(x / (3 * a)).toFixed(6), +(y / (3 * a)).toFixed(6)]; }
  }
  return best;
}
const fc = features => ({ type: 'FeatureCollection', features });
const feature = (properties, geometry) => ({ type: 'Feature', properties, geometry: simplifyGeom(geometry) });

// ---------- zones ----------
const zoneFeatures = rows => rows.filter(r => r.dbn && r.the_geom)
  .map(r => feature({ dbn: r.dbn, label: r.label ?? r.dbn, district: Math.round(+(r.schooldist ?? r.zoned_dist)) }, r.the_geom));
const esZones = fc(zoneFeatures(await soda('cmjf-yawu', { boro: 'M' })));
sources.push('NYC Open Data cmjf-yawu School Zones 2024-2025 Elementary');
const msZones = fc(zoneFeatures(await soda('t26j-jbq7', { boro_text: 'M' })));
sources.push('NYC Open Data t26j-jbq7 School Zones 2024-2025 Middle School');
const districts = fc((await soda('8ugf-3d8u', {})).filter(r => +r.schooldist >= 1 && +r.schooldist <= 6)
  .map(r => feature({ district: +r.schooldist }, r.the_geom)).sort((a, b) => a.properties.district - b.properties.district));
sources.push('NYC Open Data 8ugf-3d8u School Districts (districts 1-6)');

// ---------- locations ----------
const levelsOf = grades => {
  const g = new Set(grades.split(',')), any = xs => xs.some(x => g.has(x));
  return [any(['0K', '01', '02', '03', '04', '05']) && 'ES', any(['06', '07', '08']) && 'MS', any(['09', '10', '11', '12']) && 'HS'].filter(Boolean);
};
const title = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const schools = new Map();
for (const r of await soda('wg9x-4ke6', { $where: "location_code like 'M%'" })) {
  // system_code is the real DBN (75M.. District 75, 84M.. charters); district = geographic district.
  // Districts outside 1-6 are citywide programs (Hospital Schools, Home Instruction) with a Bronx office address.
  if (r.status_descriptions !== 'Open' || !+r.latitude || !(+r.geographical_district_code <= 6)) continue;
  const dbn = r.system_code || r.geographical_district_code.padStart(2, '0') + r.location_code;
  const grades = r.grades_final_text ?? r.grades_text ?? '';
  schools.set(dbn, {
    dbn, name: r.location_name, lon: +(+r.longitude).toFixed(6), lat: +(+r.latitude).toFixed(6),
    district: +r.geographical_district_code, grades, levels: levelsOf(grades),
    ...(r.primary_address_line_1 ? { address: title(r.primary_address_line_1) } : {}),
  });
}
sources.push('NYC Open Data wg9x-4ke6 2019-2020 School Locations (open schools only)');
let added = 0;
for (const [zones, level] of [[esZones, 'ES'], [msZones, 'MS']]) for (const f of zones.features) for (const dbn of f.properties.dbn.split(',')) {
  if (schools.has(dbn)) continue;
  const [lon, lat] = centroid(f.geometry); added++;
  schools.set(dbn, { dbn, name: `${level === 'ES' ? 'P.S.' : 'M.S.'} ${+dbn.slice(3)}`, lon, lat, district: +dbn.slice(0, 2), grades: '', levels: [level] });
}

// ---------- test scores ----------
/** Stream rows of the named sheet of an xlsx as arrays of cell values (shared strings resolved). */
async function* xlsxRows(file, sheetName) {
  const dir = fs.mkdtempSync(path.join(tmp, 'x-'));
  execFileSync('unzip', ['-oq', file, 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml'], { cwd: dir });
  const rid = fs.readFileSync(path.join(dir, 'xl/workbook.xml'), 'utf8').match(new RegExp(`<sheet [^>]*name="${sheetName}"[^>]*r:id="(\\w+)"`))?.[1];
  const target = fs.readFileSync(path.join(dir, 'xl/_rels/workbook.xml.rels'), 'utf8').match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${rid}"`));
  if (!rid || !target) throw new Error(`sheet ${sheetName} not found in ${file}`);
  const sheet = 'xl/' + (target[1] ?? target[2]).replace(/^\/?xl\//, '');
  const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const strings = [...fs.readFileSync(path.join(dir, 'xl/sharedStrings.xml'), 'utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => unesc([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(t => t[1]).join('')));
  execFileSync('unzip', ['-oq', file, sheet], { cwd: dir });
  const col = ref => { let n = 0; for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  let buf = '';
  for await (const chunk of fs.createReadStream(path.join(dir, sheet), { encoding: 'utf8', highWaterMark: 1 << 20 })) {
    buf += chunk;
    let end, start = 0;
    while ((end = buf.indexOf('</row>', start)) !== -1) {
      const row = [];
      for (const c of buf.slice(start, end).matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(?:<f>[^<]*<\/f>)?(?:<v>([^<]*)<\/v>|<is><t[^>]*>([^<]*)<\/t><\/is>)?<\/c>)/g)) {
        const [, ref, attrs, v, inline] = c;
        row[col(ref)] = / t="s"/.test(attrs) ? strings[+v] : inline != null ? unesc(inline) : v != null ? unesc(v) : undefined;
      }
      yield row; start = end + 6;
    }
    buf = buf.slice(start);
  }
}
/** Latest-year 'All Grades' / 'All Students' % Level 3+4 per DBN, plus the citywide tested-weighted mean. */
async function infohub(subject) {
  const file = path.join(tmp, `${subject}.xlsx`);
  fs.writeFileSync(file, await get(`${INFOHUB}/school-${subject}-results-public.xlsx`, 'buf'));
  let head, byYear = new Map();
  for await (const r of xlsxRows(file, `${subject === 'ela' ? 'ELA' : 'Math'} - All`)) {
    if (!head) { head = Object.fromEntries(r.map((h, i) => [h, i])); continue; }
    if (r[head.Grade] !== 'All Grades' || r[head.Category] !== 'All Students') continue;
    const year = +r[head.Year], pct = +r[head['% Level 3+4']], n = +r[head['Number Tested']];
    if (!year || !Number.isFinite(pct) || r[head['% Level 3+4']] === 's') continue;
    (byYear.get(year) ?? byYear.set(year, []).get(year)).push({ dbn: r[head.DBN], pct, n });
  }
  const year = Math.max(...byYear.keys()), rows = byYear.get(year);
  return { year, rows, avg: rows.reduce((s, x) => s + x.pct * x.n, 0) / rows.reduce((s, x) => s + x.n, 0), src: `NYC DOE InfoHub school-${subject}-results-public.xlsx (${year})` };
}
/** Fallback: Socrata grades 3-8 results (ends 2023). */
async function socrataScores(subject) {
  const [id, dbnF, catF, pctF] = subject === 'ela'
    ? ['iebs-5yhr', 'geographic_subdivision', 'category', 'level_3_4_1'] : ['74kb-55u9', 'geographic_division', 'student_category', 'pct_level_3_and_4'];
  const all = await soda(id, { report_category: 'School', grade: 'All Grades', [catF]: 'All Students' });
  const year = Math.max(...all.map(r => +r.year));
  const rows = all.filter(r => +r.year === year && Number.isFinite(+r[pctF]) && r[pctF] !== 's').map(r => ({ dbn: r[dbnF], pct: +r[pctF], n: +r.number_tested }));
  return { year, rows, avg: rows.reduce((s, x) => s + x.pct * x.n, 0) / rows.reduce((s, x) => s + x.n, 0), src: `NYC Open Data ${id} grades 3-8 ${subject.toUpperCase()} results (${year}, fallback: InfoHub unavailable)` };
}
const scores = {};
for (const subject of ['ela', 'math']) {
  try { scores[subject] = await infohub(subject); }
  catch (e) { console.warn(`InfoHub ${subject} failed (${e.message}); using Socrata`); scores[subject] = await socrataScores(subject); }
  sources.push(scores[subject].src);
  for (const { dbn, pct, n } of scores[subject].rows) {
    const s = schools.get(dbn); if (!s) continue;
    s[subject] = +pct.toFixed(1); s.testYear = scores[subject].year; s.tested = Math.max(s.tested ?? 0, n);
  }
}

// ---------- graduation ----------
const gradAll = await soda('mjm3-8dw8', { report_category: 'School', category: 'All Students', cohort: '4 year June', $order: 'cohort_year DESC' });
const gYear = Math.max(...gradAll.map(r => +r.cohort_year));
const gRows = gradAll.filter(r => +r.cohort_year === gYear && Number.isFinite(+r.grads_1) && +r.total_cohort > 0);
const gradCohort = `${gYear} cohort (4 year June, class of ${gYear + 4})`;
for (const r of gRows) { const s = schools.get(r.geographic_subdivision); if (s) { s.grad = +(+r.grads_1).toFixed(1); s.gradCohort = gradCohort; } }
const gradAvg = gRows.reduce((s, r) => s + +r.grads, 0) / gRows.reduce((s, r) => s + +r.total_cohort, 0) * 100;
sources.push(`NYC Open Data mjm3-8dw8 Graduation Results, ${gradCohort}`);

// ---------- write ----------
const list = [...schools.values()].sort((a, b) => a.dbn.localeCompare(b.dbn));
const data = {
  generated: new Date().toISOString(), sources, schools: list, esZones, msZones, districts,
  averages: { ela: +scores.ela.avg.toFixed(1), math: +scores.math.avg.toFixed(1), grad: +gradAvg.toFixed(1) },
};
fs.writeFileSync(OUT, JSON.stringify(data));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`schools ${list.length} (${added} from zone centroids) | ela ${list.filter(s => s.ela != null).length} math ${list.filter(s => s.math != null).length} (test year ${scores.ela.year}/${scores.math.year}) | grad ${list.filter(s => s.grad != null).length} (${gradCohort})`);
console.log(`zones es ${esZones.features.length} ms ${msZones.features.length} districts ${districts.features.length} | averages ${JSON.stringify(data.averages)} | ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
