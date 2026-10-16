// Michelin-starred restaurants in Manhattan, from Wikipedia "List of Michelin-starred restaurants in New York City" (CC BY-SA).
// Takes the most recent guide year in the article, keeps Manhattan rows with 1-3 stars that year, and places each one by
// matching its name to the DOHMH snapshot (public/data/restaurants.json). The table has no street addresses, so the
// GeoSearch fallback only runs if one ever appears in a row; anything else is dropped and listed as unmatched.
// Output public/data/dining.json  { generated, source, year, restaurants: [{ name, stars, cuisine?, lon, lat, neighborhood? }] }
// Run: node scripts/build-dining.mjs
import fs from 'node:fs';

const PAGE = 'List of Michelin-starred restaurants in New York City';
const UA = 'manhattan-re-dashboard/1.0 (https://github.com/Neoo-Blue/manhattan-re-dashboard)';
const api = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(PAGE)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
const res = await fetch(api, { headers: { 'user-agent': UA } });
if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
const wikitext = (await res.json()).parse.wikitext;

// Wiki markup -> plain text: [[a|b]] -> b, [[a]] -> a, drop refs, templates other than star cells, html tags.
const plain = s => s.replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/\{\{(?!Michelin stars)[^{}]*\}\}/g, '')
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/<[^>]+>/g, '').replace(/'''?/g, '').trim();
const cellText = c => c.replace(/^[^[{]*?(?:scope|style|data-sort-value|rowspan|colspan)=[^|]*\|(?!\|)/, ''); // drop cell attributes

// Split every wikitable into header names + rows of cells.
const tables = [...wikitext.matchAll(/\{\|[\s\S]*?\n\|\}/g)].map(([t]) => {
  const [head, ...rows] = t.split(/\n\|-[^\n]*/);
  const cols = [...head.matchAll(/^!(.*)$/gm)].map(m => plain(cellText(m[1])));
  const body = rows.map(r => r.split('\n').filter(l => /^[!|](?![}+])/.test(l))
    .flatMap(l => l.slice(1).split(/\|\||!!/)).map(cellText)).filter(r => r.length);
  return { cols, body };
});
const yearOf = c => /^(19|20)\d\d$/.test(c) ? +c : 0;
const year = Math.max(...tables.flatMap(t => t.cols.map(yearOf)));
const table = tables.find(t => t.cols.some(c => yearOf(c) === year));
const col = re => table.cols.findIndex(c => re.test(c));
const iName = col(/name/i), iCuisine = col(/cuisine/i), iLoc = col(/location|borough|neighbo/i), iYear = table.cols.findIndex(c => yearOf(c) === year), iAddr = col(/address/i);

const starred = table.body.map(r => {
  const stars = +(r[iYear]?.match(/stars=(\d)/)?.[1] ?? 0);
  const loc = plain(r[iLoc] ?? '');
  const [boro, hood] = loc.split(/\s*[–-]\s*/);
  return { name: plain(r[iName] ?? ''), stars, cuisine: plain(r[iCuisine] ?? '') || undefined, boro, neighborhood: hood || undefined, address: iAddr >= 0 ? plain(r[iAddr] ?? '') : '' };
}).filter(r => r.name && r.stars >= 1 && r.stars <= 3 && /manhattan/i.test(r.boro));

// Name matching against DOHMH (latest row per camis wins; snapshot is raw Socrata rows).
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/['’`.]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|restaurant|nyc|new york|ny|inc|llc|corp)\b/g, ' ').replace(/\s+/g, ' ').trim();
// Starred places often carry an A grade older than the snapshot's 18-month window, so also index every Manhattan camis ever inspected.
const allDohmh = 'https://data.cityofnewyork.us/resource/43nn-pn8j.json?' + new URLSearchParams({
  $select: 'camis,dba,latitude,longitude', $where: "boro='Manhattan' AND latitude::number != 0", $group: 'camis,dba,latitude,longitude', $limit: '50000',
});
const extra = await fetch(allDohmh, { headers: { 'user-agent': UA } }).then(r => r.ok ? r.json() : []).catch(() => []);
const byName = new Map();
for (const r of [...JSON.parse(fs.readFileSync('public/data/restaurants.json', 'utf8')), ...extra]) {
  const lon = +r.longitude, lat = +r.latitude;
  if (!lon || !lat) continue;
  for (const k of new Set([r.dba ?? '', ...(r.dba ?? '').split('/')].map(norm))) { // 'CASA MONO / BAR JAMON' -> both names
    if (k && !byName.has(k.replace(/ /g, ''))) byName.set(k.replace(/ /g, ''), { lon, lat }); // spaceless: 'Oiji Mi' = 'OIJIMI'
  }
}
// Wikipedia name -> DOHMH dba where they differ beyond normalisation (checked against DOHMH 2026-10).
const ALIAS = { '63 Clinton': 'Sixty Three Clinton', 'Cote': 'Cote Korean Steakhouse', 'Family Meal at Blue Hill': 'Blue Hill' };
async function geosearch(text) {
  const u = `https://geosearch.planninglabs.nyc/v2/search?text=${encodeURIComponent(text)}&size=1`;
  const f = (await (await fetch(u, { headers: { 'user-agent': UA } })).json()).features?.[0];
  return f?.properties?.borough === 'Manhattan' ? { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] } : null;
}

const restaurants = [], unmatched = [];
for (const r of starred) {
  let at = byName.get(norm(ALIAS[r.name] ?? r.name).replace(/ /g, '')) ?? null; // ponytail: first camis wins when two places share a name
  if (!at && r.address) at = await geosearch(`${r.address}, Manhattan, New York`).catch(() => null);
  if (!at) { unmatched.push(r.name); continue; }
  restaurants.push({ name: r.name, stars: r.stars, cuisine: r.cuisine, lon: +at.lon.toFixed(6), lat: +at.lat.toFixed(6), neighborhood: r.neighborhood });
}

fs.writeFileSync('public/data/dining.json', JSON.stringify({
  generated: new Date().toISOString(),
  source: `Wikipedia: List of Michelin-starred restaurants in New York City (CC BY-SA), ${year} guide`,
  year, restaurants,
}));
console.log(`Michelin ${year}: ${starred.length} starred in Manhattan, matched ${restaurants.length}, unmatched ${unmatched.length}`);
if (unmatched.length) console.log('unmatched:', unmatched.join('; '));
