// Food & daily-life places across Manhattan from OpenStreetMap (Overpass), classified for buyers' dietary needs.
//   grocery: premium | supermarket | organic | asian | indian | latin | italian | specialty, each with diets[]
//   dining:  restaurants / cafes with cuisine + diets[] (kosher, halal, vegan, vegetarian, gluten_free, organic)
//   park, playground, gym, pharmacy
// Output public/data/places.json  { generated, source, places: [{ id, cat, sub, name, lon, lat, diets?, cuisine?, brand?, addr? }] }
// Official registries (NYS kosher, DOHMH restaurant grades) are merged in at runtime from the Worker datasets.
// Run: node scripts/build-places.mjs   (Overpass mirrors rotate on 429/5xx)
import fs from 'node:fs';

const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const Q = `[out:json][timeout:240];
area["boundary"="administrative"]["name"="Manhattan"]["admin_level"="7"]->.m;
(
  nwr["shop"~"^(supermarket|grocery|greengrocer|deli|butcher|health_food|organic|seafood|bakery)$"]["name"](area.m);
  nwr["amenity"~"^(restaurant|fast_food|cafe)$"]["name"](area.m);
  nwr["leisure"~"^(park|playground|fitness_centre|dog_park)$"]["name"](area.m);
  nwr["amenity"="pharmacy"](area.m);
);
out center tags;`;

const PREMIUM_BRANDS = /whole foods|trader joe|wegmans|eataly|citarella|zabar|agata|eli'?s|gourmet garage|westside market|union market|grace'?s/i;

async function overpass() {
  for (let a = 0; a < 8; a++) {
    const url = MIRRORS[a % MIRRORS.length];
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'manhattan-re-dashboard/1.0' }, body: 'data=' + encodeURIComponent(Q), signal: AbortSignal.timeout(200_000) });
      const t = await r.text();
      const j = r.ok && t.startsWith('{') ? JSON.parse(t) : null;
      // Overpass reports timeouts as HTTP 200 with a 'remark' and a truncated element list: never accept that
      if (j && !j.remark && j.elements?.length > 5000) { console.log('ok', url, j.elements.length); return j; }
      if (j) console.log('incomplete', url, j.remark ?? `${j.elements?.length} elements`);
      console.log('fail', url, r.status);
    } catch (e) { console.log('err', url, e.message); }
    await new Promise(res => setTimeout(res, 4000 * (a + 1)));
  }
  throw new Error('all Overpass mirrors failed');
}

const DIETS = ['kosher', 'halal', 'vegan', 'vegetarian', 'gluten_free'];
const MARKET = [
  ['asian', /h ?mart|hong kong supermarket|kam man|sunrise mart|japan village|new york mart|deluxe food market|good fortune|asian|oriental|chinese|korean|japanese|thai|kalustyan/i, /chinese|japanese|korean|asian|thai|vietnamese/],
  ['indian', /patel|indian|desi|apna|kalustyan|subzi/i, /indian|pakistani|bangladeshi/],
  ['latin', /bravo|c-town|ctown|key food latin|mexican|latin|bodega|la (gran|placita)|mercado/i, /mexican|latin|caribbean|dominican/],
  ['italian', /italian|di palo|eataly|salumeria|faicco/i, /italian/],
];
const j = await overpass();
const places = [];
for (const e of j.elements) {
  const t = e.tags ?? {}, lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
  if (lat == null || !t.name) continue;
  const cuisine = (t.cuisine ?? '').toLowerCase();
  const diets = DIETS.filter(d => /^(yes|only)$/.test(t[`diet:${d}`] ?? '') || cuisine.includes(d) || (d === 'kosher' || d === 'halal' ? new RegExp(d, 'i').test(t.name) : false));
  if (/^(yes|only)$/.test(t.organic ?? '') || t.shop === 'organic' || /organic/i.test(t.name)) diets.push('organic');
  if (diets.includes('vegan') && !diets.includes('vegetarian')) diets.push('vegetarian');
  let cat, sub;
  if (t.shop) {
    cat = 'grocery';
    const label = `${t.brand ?? ''} ${t.name}`;
    const market = MARKET.find(([, re, cre]) => re.test(label) || cre.test(cuisine))?.[0];
    if (PREMIUM_BRANDS.test(label)) sub = 'premium';
    else if (t.shop === 'health_food' || t.shop === 'organic' || diets.includes('organic')) sub = 'organic';
    else if (market) sub = market;
    else if (t.shop === 'supermarket') sub = 'supermarket';
    else if (diets.length) sub = 'specialty'; // kosher / halal butchers, delis, bakeries
    else continue; // ordinary delis and bodegas are noise for buyers
  } else if (t.amenity === 'pharmacy') { cat = 'pharmacy'; sub = 'pharmacy'; }
  else if (t.amenity) { cat = 'dining'; sub = t.amenity; }
  else if (t.leisure) { cat = t.leisure === 'fitness_centre' ? 'gym' : t.leisure === 'playground' ? 'playground' : 'park'; sub = t.leisure; }
  if (!cat) continue;
  const addr = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || undefined;
  places.push({ id: `${e.type[0]}${e.id}`, cat, sub, name: t.name, lon: +lon.toFixed(6), lat: +lat.toFixed(6),
    ...(diets.length ? { diets: [...new Set(diets)] } : {}), ...(cuisine && cat === 'dining' ? { cuisine: cuisine.split(';').slice(0, 3).join(';') } : {}),
    ...(t.brand ? { brand: t.brand } : {}), ...(addr ? { addr } : {}) });
}
// parks are often mapped as several pieces: keep one point per name within ~300 m
const seen = []; const out = places.filter(p => {
  if (p.cat !== 'park') return true;
  if (seen.some(s => s.name === p.name && Math.hypot(s.lon - p.lon, s.lat - p.lat) < 0.004)) return false;
  seen.push(p); return true;
});
fs.writeFileSync('public/data/places.json', JSON.stringify({ source: 'OpenStreetMap contributors (ODbL) via Overpass', generated: new Date().toISOString(), places: out }));
const count = {}; for (const p of out) { count[`${p.cat}/${p.sub}`] = (count[`${p.cat}/${p.sub}`] ?? 0) + 1; for (const d of p.diets ?? []) count[`${p.cat}+${d}`] = (count[`${p.cat}+${d}`] ?? 0) + 1; }
console.log(out.length, `${(fs.statSync('public/data/places.json').size / 1024).toFixed(0)} kB`, count);
