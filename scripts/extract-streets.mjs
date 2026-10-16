// Dump street centerlines (OpenFreeMap z14 `transportation` layer) for block polygonization.
import fs from 'node:fs';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
const Z = 14, TPL = (await (await fetch('https://tiles.openfreemap.org/planet')).json()).tiles[0];
const lon2x = l => Math.floor((l + 180) / 360 * 2 ** Z);
const lat2y = a => Math.floor((1 - Math.log(Math.tan(a * Math.PI / 180) + 1 / Math.cos(a * Math.PI / 180)) / Math.PI) / 2 * 2 ** Z);
const KEEP = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']);
const lines = [];
for (let x = lon2x(-74.03); x <= lon2x(-73.93); x++) for (let y = lat2y(40.77); y <= lat2y(40.70); y++) {
  const t = new VectorTile(new PbfReader(new Uint8Array(await (await fetch(TPL.replace('{z}', Z).replace('{x}', x).replace('{y}', y))).arrayBuffer())));
  const L = t.layers.transportation;
  for (let i = 0; L && i < L.length; i++) {
    const f = L.feature(i), p = f.properties;
    if (!KEEP.has(p.class) || p.brunnel === 'tunnel' || p.brunnel === 'bridge' || p.ramp) continue;
    const g = f.toGeoJSON(x, y, Z).geometry;
    const ls = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const l of ls) lines.push({ c: p.class, l });
  }
}
fs.mkdirSync('scripts/cache', { recursive: true });
fs.writeFileSync('scripts/cache/streets.json', JSON.stringify(lines));
console.log('lines', lines.length);
