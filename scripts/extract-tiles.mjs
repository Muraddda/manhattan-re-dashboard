// Fallback / default data source: extract OSM-derived buildings + amenities from OpenFreeMap
// vector tiles (z14) for the area and cache them as static JSON in public/data/.
// Used because public Overpass mirrors were returning 500/502 at build time.
import fs from 'node:fs';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { inPoly } from './area.mjs';
const Z = 14;
const meta = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const TPL = meta.tiles[0];
const lon2x = l => Math.floor((l + 180) / 360 * 2 ** Z);
const lat2y = a => Math.floor((1 - Math.log(Math.tan(a * Math.PI / 180) + 1 / Math.cos(a * Math.PI / 180)) / Math.PI) / 2 * 2 ** Z);
const [x0, x1, y0, y1] = [lon2x(-74.03), lon2x(-73.93), lat2y(40.77), lat2y(40.70)];
const r6 = n => Math.round(n * 1e6) / 1e6;
const buildings = new Map(); const amen = { grocery: new Map(), schools: new Map(), subway: new Map(), parks: new Map() };
const parkPolys = []; const pieces = [];
function centroid(ring) { let x = 0, y = 0; for (const p of ring) { x += p[0]; y += p[1]; } return [x / ring.length, y / ring.length]; }
for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
  const buf = new Uint8Array(await (await fetch(TPL.replace('{z}', Z).replace('{x}', x).replace('{y}', y))).arrayBuffer());
  const t = new VectorTile(new PbfReader(buf));
  const B = t.layers.building;
  for (let i = 0; B && i < B.length; i++) {
    const f = B.feature(i); const g = f.toGeoJSON(x, y, Z);
    const polys = g.geometry.type === 'Polygon' ? [g.geometry.coordinates] : g.geometry.coordinates;
    for (const poly of polys) {
      const ring = poly[0].map(p => [r6(p[0]), r6(p[1])]);
      let bb = [180, 90, -180, -90]; for (const [px, py] of ring) bb = [Math.min(bb[0], px), Math.min(bb[1], py), Math.max(bb[2], px), Math.max(bb[3], py)];
      pieces.push({ fid: f.id, tile: `${x}/${y}`, ring, bb, height: f.properties.render_height ?? 10, minHeight: f.properties.render_min_height ?? 0, colour: f.properties.colour ?? null });
    }
  }
  const P = t.layers.poi;
  for (let i = 0; P && i < P.length; i++) {
    const f = P.feature(i); const p = f.properties; const g = f.toGeoJSON(x, y, Z);
    if (g.geometry.type !== 'Point') continue; const c = g.geometry.coordinates.map(r6); if (!inPoly(c)) continue;
    let cat = null;
    if (p.class === 'grocery' && /supermarket|greengrocer|marketplace|deli/.test(p.subclass)) cat = 'grocery';
    else if (p.class === 'school' && p.subclass === 'school') cat = 'schools';
    else if (p.class === 'railway' && p.subclass === 'subway') cat = 'subway';
    else if (p.class === 'park') cat = 'parks';
    if (!cat || !p.name) continue;
    const key = `${p.name}`; if (cat === 'subway' || cat === 'parks') { if ([...amen[cat].values()].some(a => a.name === p.name && Math.hypot(a.lon - c[0], a.lat - c[1]) < 0.003)) continue; }
    amen[cat].set(`${cat}-${f.id}`, { id: `${cat}-${f.id}`, name: p.name, kind: p.subclass, lon: c[0], lat: c[1] });
  }
  const PK = t.layers.park;
  for (let i = 0; PK && i < PK.length; i++) {
    const f = PK.feature(i); const g = f.toGeoJSON(x, y, Z); if (!f.properties.name) continue;
    if (!/Polygon/.test(g.geometry.type)) continue;
    const ring = (g.geometry.type === 'Polygon' ? g.geometry.coordinates : g.geometry.coordinates[0])[0];
    const c = centroid(ring).map(r6); if (!inPoly(c)) continue;
    const id = `parks-${f.id}`; if (!amen.parks.has(id) && ![...amen.parks.values()].some(a => a.name === f.properties.name)) amen.parks.set(id, { id, name: f.properties.name, kind: 'park', lon: c[0], lat: c[1] });
  }
  process.stdout.write('.');
}
// --- Assemble buildings. z14 tiles merge neighbouring footprints into one multipolygon feature,
// so the tile feature id is NOT per-building. Each footprint ring is a building; rings clipped at tile
// edges are re-joined (same feature id, different tile, touching bboxes). Stable id = rounded centroid.
const parent = pieces.map((_, i) => i); const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
const byFid = new Map(); pieces.forEach((p, i) => { if (!byFid.has(p.fid)) byFid.set(p.fid, []); byFid.get(p.fid).push(i); });
const E = 2e-5, touch = (a, b) => a[0] <= b[2] + E && b[0] <= a[2] + E && a[1] <= b[3] + E && b[1] <= a[3] + E;
for (const idx of byFid.values()) for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) {
  const A = pieces[idx[a]], Bp = pieces[idx[b]]; if (A.tile !== Bp.tile && touch(A.bb, Bp.bb)) parent[find(idx[a])] = find(idx[b]);
}
const groups = new Map(); pieces.forEach((p, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
for (const g of groups.values()) {
  const all = g.flatMap(p => p.ring); const c = centroid(all);
  if (!inPoly(c)) continue;
  const base = `bld-${c[1].toFixed(5)}-${Math.abs(c[0]).toFixed(5)}`; let id = base, k = 2; while (buildings.has(id)) id = `${base}-${k++}`;
  buildings.set(id, { id, parts: g.map(p => p.ring), height: Math.max(...g.map(p => p.height)), minHeight: Math.min(...g.map(p => p.minHeight)), colour: g[0].colour, centroid: c.map(r6), osmTileFeatureId: g[0].fid });
}
fs.mkdirSync('public/data', { recursive: true });
fs.writeFileSync('public/data/buildings.json', JSON.stringify({ source: 'OpenFreeMap vector tiles (OSM data, ODbL) z14', generated: new Date().toISOString(), buildings: [...buildings.values()] }));
const out = Object.fromEntries(Object.entries(amen).map(([k, m]) => [k, [...m.values()]]));
fs.writeFileSync('public/data/amenities.json', JSON.stringify({ source: 'OpenStreetMap via OpenFreeMap tiles (ODbL)', generated: new Date().toISOString(), ...out }, null, 1));
console.log('\nbuildings', buildings.size, Object.entries(out).map(([k, v]) => `${k}:${v.length}`).join(' '));
