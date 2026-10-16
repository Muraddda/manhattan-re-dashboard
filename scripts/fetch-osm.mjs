// Fetch OSM data via Overpass and cache to public/data/*.json. Retries across mirrors.
import fs from 'node:fs';
const BBOX = '40.70,-74.03,40.77,-73.93';
const MIRRORS = ['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const Q = {
  grocery: [`nwr["shop"~"^(supermarket|grocery|greengrocer)$"](${BBOX});`, 'out center;'],
  schools: [`nwr["amenity"="school"](${BBOX});`, 'out center;'],
  parks: [`nwr["leisure"="park"](${BBOX});`, 'out center;'],
  subway: [`node["railway"="station"]["station"="subway"](${BBOX});node["public_transport"="station"]["subway"="yes"](${BBOX});`, 'out;'],
  buildings: [`way["building"](${BBOX});`, 'out tags geom;'],
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function run(name, q) {
  const out = `public/data/${name === 'buildings' ? 'buildings-raw' : name}.json`;
  if (fs.existsSync(out)) return console.log('cached', name);
  for (let a = 0; a < 12; a++) {
    const url = MIRRORS[a % MIRRORS.length];
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': 're-dashboard/0.1', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(`[out:json][timeout:180];(${q[0]});${q[1]}`), signal: AbortSignal.timeout(200000) });
      const t = await r.text();
      if (r.ok && t.startsWith('{')) { fs.writeFileSync(out, t); return console.log('ok', name, url, t.length); }
      console.log('fail', name, url, r.status);
    } catch (e) { console.log('err', name, url, e.message); }
    await sleep(5000);
  }
}
for (const [k, q] of Object.entries(Q)) await run(k, q);
