// One-off geocoder for mock data. NY -> NYC Planning GeoSearch; NJ -> US Census geocoder. Results cached in scripts/geocode-cache.json.
import fs from 'node:fs';
import Papa from 'papaparse';
const FILES = ['../../../data-analyst/trial-10/listings.csv', '../../../data-analyst/poc-100/listings.csv', '../../../data-analyst/poc-100/browser-sites.csv', '../../../data-analyst/poc-100/listings-batch2.csv'];
const cacheUrl = new URL('./geocode-cache.json', import.meta.url);
const cache = fs.existsSync(cacheUrl) ? JSON.parse(fs.readFileSync(cacheUrl, 'utf8')) : {};
const rows = FILES.flatMap((f) => Papa.parse(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), { header: true, skipEmptyLines: true }).data);
const seen = new Map(); for (const r of rows) seen.set(`${r.address}|${r.city}|${r.state}`, r);
const clean = (a) => a.replace(/^(\d+)\s*&\s*\d+/, '$1');
for (const [k, r] of seen) {
  if (cache[k] !== undefined) continue;
  try {
    if (r.state === 'NY') {
      const j = await (await fetch(`https://geosearch.planninglabs.nyc/v2/search?size=1&text=${encodeURIComponent(`${clean(r.address)}, ${r.city}, NY`)}`)).json();
      const f = j.features?.[0];
      cache[k] = f ? { lat: +f.geometry.coordinates[1].toFixed(6), lng: +f.geometry.coordinates[0].toFixed(6), zip: f.properties.postalcode ?? '', source: 'nyc_geosearch', label: f.properties.label } : null;
    } else {
      const q = new URLSearchParams({ address: `${clean(r.address)}, ${r.city}, ${r.state} ${r.zip}`.trim(), benchmark: 'Public_AR_Current', format: 'json' });
      const m = (await (await fetch(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${q}`)).json()).result.addressMatches?.[0];
      cache[k] = m ? { lat: +m.coordinates.y.toFixed(6), lng: +m.coordinates.x.toFixed(6), zip: m.addressComponents.zip ?? '', source: 'census', label: m.matchedAddress } : null;
    }
  } catch (e) { console.error(k, e.message); }
  await new Promise((r) => setTimeout(r, 250));
}
// Manual override per team lead (Census interpolation ~1 km off on the Oval).
Object.assign(cache, {
  // Census matched 110 River St 07302 (wrong); OpenStreetMap position for Aquablu.
  '110 River Drive|Jersey City|NJ': { lat: 40.729947, lng: -74.031614, zip: '07310', source: 'override', label: 'Aquablu, 110 River Drive (OpenStreetMap)' },
  '6 Stuyvesant Oval|New York|NY': { lat: 40.730857, lng: -73.976744, zip: '10009', source: 'override', label: '6 Stuyvesant Oval' },
  '15 Stuyvesant Oval|New York|NY': { lat: 40.732661, lng: -73.978939, zip: '10009', source: 'override', label: '15 Stuyvesant Oval' },
  '16 Stuyvesant Oval|New York|NY': { lat: 40.731529, lng: -73.976257, zip: '10009', source: 'override', label: '16 Stuyvesant Oval' },
});
fs.writeFileSync(cacheUrl, JSON.stringify(cache, null, 1));
console.log(Object.keys(cache).length, 'addresses;', Object.values(cache).filter((v) => !v).length, 'failed');
