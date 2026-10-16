// Subway graph for in-browser commute routing, from MTA GTFS static (weekday AM peak).
// Output public/data/transit.json:
//   stations  [{ id, name, lon, lat, routes[] }]         parent stations
//   routes    { [id]: { color, text, name } }
//   edges     [[from, to, route, seconds]]               median ride time between consecutive stops
//   headways  { "route|station": seconds }               mean gap between departures 07:00-10:00
//   transfers [[from, to, seconds]]                      walking transfers between different stations
//   lines     { [route]: [[lon, lat], ...][] }           simplified shapes for drawing
// Run: node scripts/build-transit.mjs   (needs `unzip`; ~10 s)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const URL = 'https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtfs-'));
fs.writeFileSync(path.join(dir, 'gtfs.zip'), Buffer.from(await (await fetch(URL)).arrayBuffer()));
execFileSync('unzip', ['-oq', 'gtfs.zip'], { cwd: dir });

/** Minimal CSV reader (GTFS quotes fields that contain commas). */
function* rows(file) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/); const head = split(lines[0]);
  for (let i = 1; i < lines.length; i++) if (lines[i]) { const v = split(lines[i]); yield Object.fromEntries(head.map((h, k) => [h, v[k] ?? ''])); }
}
function split(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}
const sec = t => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + s; };
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };

const parentOf = new Map(), stations = new Map();
for (const s of rows('stops.txt')) {
  if (s.location_type === '1') stations.set(s.stop_id, { id: s.stop_id, name: s.stop_name, lon: +(+s.stop_lon).toFixed(6), lat: +(+s.stop_lat).toFixed(6), routes: new Set() });
  parentOf.set(s.stop_id, s.parent_station || s.stop_id);
}
const routes = {};
for (const r of rows('routes.txt')) routes[r.route_id] = { color: `#${r.route_color || '808183'}`, text: `#${r.route_text_color || 'FFFFFF'}`, name: r.route_long_name };

// weekday service only
const weekday = new Set([...rows('calendar.txt')].filter(c => c.monday === '1' && c.friday === '1').map(c => c.service_id));
const trips = new Map();
for (const t of rows('trips.txt')) if (weekday.has(t.service_id)) trips.set(t.trip_id, { route: t.route_id, shape: t.shape_id });

const byTrip = new Map();
for (const st of rows('stop_times.txt')) {
  if (!trips.has(st.trip_id)) continue;
  (byTrip.get(st.trip_id) ?? byTrip.set(st.trip_id, []).get(st.trip_id)).push({ seq: +st.stop_sequence, stop: parentOf.get(st.stop_id), arr: sec(st.arrival_time), dep: sec(st.departure_time) });
}
const hop = new Map(), deps = new Map(), AM0 = 7 * 3600, AM1 = 10 * 3600;
for (const [tid, sts] of byTrip) {
  const { route } = trips.get(tid); sts.sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < sts.length; i++) {
    const a = sts[i]; stations.get(a.stop)?.routes.add(route);
    if (a.dep >= AM0 && a.dep < AM1) { const k = `${route}|${a.stop}`; deps.set(k, (deps.get(k) ?? 0) + 1); }
    const b = sts[i + 1]; if (!b) continue;
    const k = `${a.stop}|${b.stop}|${route}`; (hop.get(k) ?? hop.set(k, []).get(k)).push(Math.max(30, b.arr - a.dep));
  }
}
const edges = [...hop].map(([k, ts]) => { const [f, t, r] = k.split('|'); return [f, t, r, median(ts)]; });
const headways = {};
for (const [k, n] of deps) headways[k] = Math.round((AM1 - AM0) / n); // n counts both directions
for (const k in headways) headways[k] = Math.max(120, Math.min(1200, headways[k] * 2)); // per-direction gap, clamped 2-20 min

const transfers = [];
for (const t of rows('transfers.txt')) {
  const a = parentOf.get(t.from_stop_id), b = parentOf.get(t.to_stop_id);
  if (a !== b) transfers.push([a, b, Math.max(60, +t.min_transfer_time || 180)]);
}

// line drawings: per route, the longest few distinct shapes, Douglas-Peucker simplified (~15 m)
const shapePts = new Map();
for (const p of rows('shapes.txt')) (shapePts.get(p.shape_id) ?? shapePts.set(p.shape_id, []).get(p.shape_id)).push([+p.shape_pt_sequence, +p.shape_pt_lon, +p.shape_pt_lat]);
function simplify(pts, tol = 0.00015) {
  if (pts.length < 3) return pts;
  let idx = 0, max = 0; const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i], dx = bx - ax, dy = by - ay;
    const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / (Math.hypot(dx, dy) || 1e-12);
    if (d > max) { max = d; idx = i; }
  }
  return max > tol ? [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)] : [pts[0], pts[pts.length - 1]];
}
const lines = {};
const shapesByRoute = new Map();
for (const { route, shape } of trips.values()) if (shape && shapePts.has(shape)) (shapesByRoute.get(route) ?? shapesByRoute.set(route, new Set()).get(route)).add(shape);
for (const [route, ids] of shapesByRoute) {
  const best = [...ids].map(id => shapePts.get(id)).sort((a, b) => b.length - a.length).slice(0, 2);
  lines[route] = best.map(pts => simplify(pts.sort((a, b) => a[0] - b[0]).map(([, x, y]) => [+x.toFixed(5), +y.toFixed(5)])));
}

const out = {
  source: 'MTA NYCT GTFS static (subway), weekday 07:00-10:00', generated: new Date().toISOString(),
  stations: [...stations.values()].filter(s => s.routes.size).map(s => ({ ...s, routes: [...s.routes].sort() })),
  routes, edges, headways, transfers, lines,
};
fs.mkdirSync('public/data', { recursive: true });
fs.writeFileSync('public/data/transit.json', JSON.stringify(out));
console.log(`stations ${out.stations.length}, edges ${edges.length}, transfers ${transfers.length}, routes with lines ${Object.keys(lines).length}, ${(fs.statSync('public/data/transit.json').size / 1024).toFixed(0)} kB`);
