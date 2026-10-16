// The map: MapLibre basemap + every overlay, in one WebGL context. React hands it data; it reports clicks and hovers.
// Buildings are the basemap's own 3D tiles (cheap, all of Manhattan); everything else is a GeoJSON source.
import * as maplibregl from 'maplibre-gl';
import type { Feature, FeatureCollection, Position } from 'geojson';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { EMPTY, circle, fc, grow, polygonAt } from '../lib/geo';
import { MARKERS, type IconKey } from '../icons';
import type { LngLat } from '../model';
import type { Router, Trip } from '../lib/transit';

// MapLibre 6 looks for its worker next to its own module, which bundlers never emit; ship it as an asset instead.
maplibregl.setWorkerUrl(workerUrl);

export const C = { accent: '#3b5bfd', listing: '#f2643d', good: '#16a34a', bad: '#dc2626', even: '#64748b', base: '#f4f5f8', tower: '#c9d9f0', dev: '#7c3aed' };
export const HOME = { center: [-73.982, 40.758] as LngLat, zoom: 12.6, pitch: 52, bearing: -29 };
const MANHATTAN: [[number, number], [number, number]] = [[-74.12, 40.65], [-73.84, 40.92]];

export type Pick =
  | { kind: 'home'; id: string } | { kind: 'dev'; id: string } | { kind: 'soft'; bbl: string } | { kind: 'place'; id: string }
  | { kind: 'school'; dbn: string } | { kind: 'station'; id: string }
  | { kind: 'building'; lon: number; lat: number; ring: Position[][]; height: number } | { kind: 'none' };

export interface SceneEvents { pick: (p: Pick) => void; hover: (homeId: string | null) => void; moved: (bearing: number, pitch: number) => void }

const OVERLAYS = ['iso-45', 'iso-30', 'iso-15', 'zones-fill', 'zones-line', 'zone-sel-fill', 'zone-sel-line', 'ring-fill', 'ring-line'] as const;

export class Scene {
  readonly map: maplibregl.Map;
  private ready: Promise<void>;
  private hoverId: string | number | null = null;
  constructor(container: HTMLElement, private ev: SceneEvents, opts: { pixelRatio: number; gl: WebGLContextAttributes; start: Partial<maplibregl.CameraOptions> }) {
    this.map = new maplibregl.Map({ container, style: 'https://tiles.openfreemap.org/styles/positron', ...HOME, ...opts.start, maxPitch: 72, attributionControl: false,
      maxBounds: MANHATTAN, pixelRatio: opts.pixelRatio, canvasContextAttributes: opts.gl } as maplibregl.MapOptions);
    this.ready = new Promise(res => this.map.on('style.load', () => { this.setup(); this.loadIcons().then(res); }));
    this.map.on('rotate', () => ev.moved(this.map.getBearing(), this.map.getPitch()));
    this.map.on('pitchend', () => ev.moved(this.map.getBearing(), this.map.getPitch()));
    (window as unknown as { __map: maplibregl.Map }).__map = this.map;
  }
  whenReady() { return this.ready; }

  private setup() {
    const m = this.map, set = (id: string, p: string, v: unknown) => m.getLayer(id) && m.setPaintProperty(id, p as never, v as never);
    set('background', 'background-color', '#f1f2f4'); set('landuse_residential', 'fill-color', '#eef0f3');
    set('park', 'fill-color', '#d7ebd6'); set('park', 'fill-opacity', 1); set('landcover_wood', 'fill-color', '#cfe6ce'); set('water', 'fill-color', '#c3d8f2');
    // Street/POI/shield labels float on top of 3D massing: keep water + place names only.
    for (const l of m.getStyle().layers) if (l.id.startsWith('building') || (l.type === 'symbol' && !/^(water_name_line|waterway_line|label_(town|city|state|country|other))/.test(l.id))) m.setLayoutProperty(l.id, 'visibility', 'none');
    const firstRoad = m.getStyle().layers.find(l => /^(road|highway|tunnel|bridge)/.test(l.id))?.id;
    const firstLabel = m.getStyle().layers.find(l => l.type === 'symbol' && m.getLayoutProperty(l.id, 'visibility') !== 'none')?.id;
    m.setLight({ anchor: 'map', position: [1.5, 210, 38], color: '#ffffff', intensity: 0.42 });
    for (const id of ['iso', 'zones', 'zone-sel', 'ring', 'sel', 'homes', 'devs', 'soft', 'places', 'schools', 'subway', 'stations', 'route', 'route-stops']) m.addSource(id, { type: 'geojson', data: EMPTY, ...(id === 'homes' ? { promoteId: 'id' } : {}) });
    // ground overlays (under roads): time map bands (opaque so overlaps stay even), school zones, nearby ring
    [['iso-45', '#fdebd3'], ['iso-30', '#fdf6c9'], ['iso-15', '#dcf2df']].forEach(([id, color]) =>
      m.addLayer({ id, type: 'fill', source: 'iso', filter: ['==', ['get', 'band'], +id.slice(4)], paint: { 'fill-color': color, 'fill-opacity': 0.92 } }, firstRoad));
    m.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': '#0d9488', 'fill-opacity': 0.04 } }, firstRoad);
    m.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': '#0d9488', 'line-opacity': 0.55, 'line-width': 1.2, 'line-dasharray': [3, 2] } }, firstLabel);
    m.addLayer({ id: 'zone-sel-fill', type: 'fill', source: 'zone-sel', paint: { 'fill-color': '#0d9488', 'fill-opacity': 0.12 } }, firstRoad);
    m.addLayer({ id: 'zone-sel-line', type: 'line', source: 'zone-sel', paint: { 'line-color': '#0d9488', 'line-width': 2.2 } }, firstLabel);
    m.addLayer({ id: 'ring-fill', type: 'fill', source: 'ring', paint: { 'fill-color': C.accent, 'fill-opacity': 0.05 } }, firstRoad);
    m.addLayer({ id: 'ring-line', type: 'line', source: 'ring', paint: { 'line-color': C.accent, 'line-opacity': 0.5, 'line-width': 1.4, 'line-dasharray': [2, 2] } }, firstLabel);
    // subway lines under the buildings' feet but over roads
    m.addLayer({ id: 'subway', type: 'line', source: 'subway', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
      paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.6, 15, 4], 'line-opacity': 0.9, 'line-offset': ['interpolate', ['linear'], ['zoom'], 11, ['*', ['get', 'offset'], 1.2], 15, ['*', ['get', 'offset'], 3.5]] } }, firstLabel);
    // 3D city from the basemap's building tiles
    const h = ['coalesce', ['get', 'render_height'], 10] as maplibregl.ExpressionSpecification;
    m.addLayer({ id: 'city', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 12, paint: {
      'fill-extrusion-color': ['interpolate', ['linear'], h, 70, C.base, 260, C.tower], 'fill-extrusion-height': h,
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-vertical-gradient': true,
      'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.35, 13.5, 1] } }, firstLabel);
    m.addLayer({ id: 'sel', type: 'fill-extrusion', source: 'sel', paint: { 'fill-extrusion-color': C.accent, 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.95 } }, firstLabel);
    // route on top of everything ground-level
    m.addLayer({ id: 'route-walk', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'walk'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#334155', 'line-width': 3, 'line-dasharray': [0.1, 2] } });
    m.addLayer({ id: 'route-ride', type: 'line', source: 'route', filter: ['==', ['get', 'kind'], 'ride'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 6 } });
    m.addLayer({ id: 'route-stops', type: 'circle', source: 'route-stops', paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2.5 } });
    // points: homes (colour = value vs market), stations, soft sites; icon layers added after images load
    m.addLayer({ id: 'stations', type: 'circle', source: 'stations', minzoom: 13.2, layout: { visibility: 'none' }, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 15, 5], 'circle-color': '#fff', 'circle-stroke-color': '#111827', 'circle-stroke-width': 1.5 } });
    m.addLayer({ id: 'soft', type: 'circle', source: 'soft', layout: { visibility: 'none' }, paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'air'], 15000, 5, 200000, 14], 'circle-color': C.dev, 'circle-opacity': 0.35, 'circle-stroke-color': C.dev, 'circle-stroke-width': 1.2 } });
    m.addLayer({ id: 'homes', type: 'circle', source: 'homes', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, ['case', ['==', ['get', 'src'], 'listing'], 5, 2.2], 15, ['case', ['==', ['get', 'src'], 'listing'], 9, 6.5]],
      'circle-color': ['case', ['boolean', ['feature-state', 'hover'], false], C.accent, ['==', ['get', 'src'], 'listing'], C.listing, ['match', ['get', 'v'], 'good', C.good, 'bad', C.bad, C.even]],
      'circle-stroke-color': '#fff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 15, 1.6], 'circle-opacity': ['case', ['==', ['get', 'dim'], 1], 0.25, 0.92] } });
    this.bindEvents();
  }
  private async loadIcons() {
    const m = this.map;
    await Promise.all((Object.keys(MARKERS) as IconKey[]).map(k => { const img = new Image(); img.src = MARKERS[k]; return img.decode().then(() => !m.hasImage(`mk-${k}`) && m.addImage(`mk-${k}`, img, { pixelRatio: 2 })); }));
    const icon = { 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-pitch-alignment': 'viewport' } as const;
    m.addLayer({ id: 'places', type: 'symbol', source: 'places', layout: { ...icon, 'icon-image': ['concat', 'mk-', ['get', 'icon']], 'icon-size': 0.5, 'symbol-sort-key': ['get', 'rank'] } });
    m.addLayer({ id: 'schools', type: 'symbol', source: 'schools', layout: { ...icon, 'icon-image': 'mk-schools', 'icon-size': ['case', ['==', ['get', 'zoned'], 1], 0.7, 0.5] } });
    m.addLayer({ id: 'devs', type: 'symbol', source: 'devs', layout: { ...icon, 'icon-image': 'mk-development', 'icon-size': ['interpolate', ['linear'], ['get', 'units'], 10, 0.5, 300, 0.85], visibility: 'none' } });
  }
  private bindEvents() {
    const m = this.map, layers = () => ['places', 'schools', 'devs', 'homes', 'soft', 'stations', 'city'].filter(l => m.getLayer(l) && m.getLayoutProperty(l, 'visibility') !== 'none');
    const top = (p: maplibregl.PointLike) => m.queryRenderedFeatures(p, { layers: layers() })[0];
    let raf = 0;
    m.on('mousemove', e => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
      const f = top(e.point); m.getCanvas().style.cursor = f && f.layer.id !== 'city' ? 'pointer' : f ? 'pointer' : '';
      this.setHover(f?.layer.id === 'homes' ? String(f.properties.id) : null);
    }); });
    m.getCanvas().addEventListener('mouseleave', () => this.setHover(null));
    m.on('click', e => {
      const f = top(e.point), P = f?.properties ?? {};
      if (!f) return this.ev.pick({ kind: 'none' });
      switch (f.layer.id) {
        case 'homes': return this.ev.pick({ kind: 'home', id: String(P.id) });
        case 'devs': return this.ev.pick({ kind: 'dev', id: String(P.id) });
        case 'soft': return this.ev.pick({ kind: 'soft', bbl: String(P.bbl) });
        case 'places': return this.ev.pick({ kind: 'place', id: String(P.id) });
        case 'schools': return this.ev.pick({ kind: 'school', dbn: String(P.dbn) });
        case 'stations': return this.ev.pick({ kind: 'station', id: String(P.id) });
        case 'city': {
          const p: LngLat = [e.lngLat.lng, e.lngLat.lat], poly = (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') ? polygonAt(p, f.geometry) : null;
          return this.ev.pick({ kind: 'building', lon: p[0], lat: p[1], ring: poly ?? [], height: Number(P.render_height ?? 10) });
        }
      }
    });
  }
  private setHover(id: string | null) {
    if (id === this.hoverId) return;
    if (this.hoverId != null) this.map.setFeatureState({ source: 'homes', id: this.hoverId }, { hover: false });
    if (id != null) this.map.setFeatureState({ source: 'homes', id }, { hover: true });
    this.hoverId = id; this.ev.hover(id);
  }
  /** Highlight a home from outside (list hover) without echoing an event back. */
  hover(id: string | null) { if (id !== this.hoverId) { const prev = this.hoverId; this.hoverId = null; if (prev != null) this.map.setFeatureState({ source: 'homes', id: prev }, { hover: false }); if (id) this.map.setFeatureState({ source: 'homes', id }, { hover: true }); this.hoverId = id; } }

  private src(id: string) { return this.map.getSource(id) as maplibregl.GeoJSONSource | undefined; }
  setData(id: string, data: FeatureCollection) { this.src(id)?.setData(data); }
  show(layer: string | string[], on: boolean) { for (const l of [layer].flat()) if (this.map.getLayer(l)) this.map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none'); }

  /** Selected building: its footprint redrawn 0.6 m larger in the accent colour (never z-fights with the original). */
  selectBuilding(ring: Position[][] | null, height = 10) {
    this.setData('sel', ring?.length ? fc([{ type: 'Feature', properties: { h: height + 0.6 }, geometry: { type: 'Polygon', coordinates: [grow(ring[0], 0.6), ...ring.slice(1)] } }]) : EMPTY);
  }
  ring(p: LngLat | null, meters: number) { this.setData('ring', p ? fc([circle(p, meters)]) : EMPTY); }

  /** Subway lines (official colours, parallel routes offset) + station dots. */
  drawSubway(router: Router) {
    const feats: Feature[] = [], seen = new Map<string, number>();
    for (const [route, parts] of Object.entries(router.t.lines)) {
      if (/X$/.test(route)) continue;
      const k = router.t.routes[route]?.color ?? '#808183', n = seen.get(k) ?? 0; seen.set(k, n + 1);
      for (const coords of parts.slice(0, 1)) feats.push({ type: 'Feature', properties: { route, color: k, offset: (n % 3) - 1 }, geometry: { type: 'LineString', coordinates: coords } });
    }
    this.setData('subway', fc(feats));
    this.setData('stations', fc(router.t.stations.map(s => ({ type: 'Feature', properties: { id: s.id, name: s.name }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } }))));
  }
  /** A door-to-door trip: dotted walks, coloured rides, transfer stops. */
  drawTrip(trip: Trip | null, router?: Router) {
    if (!trip || !router) { this.setData('route', EMPTY); this.setData('route-stops', EMPTY); return; }
    const lines: Feature[] = [], stops: Feature[] = [];
    for (const l of trip.legs) {
      const color = l.route ? router.t.routes[l.route]?.color ?? C.accent : '#334155';
      lines.push({ type: 'Feature', properties: { kind: l.kind, color }, geometry: { type: 'LineString', coordinates: l.path } });
      if (l.kind === 'ride') for (const s of [l.from, l.to]) s && stops.push({ type: 'Feature', properties: { color }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } });
    }
    this.setData('route', fc(lines)); this.setData('route-stops', fc(stops));
  }
  /** Time map: every station reachable within 15/30/45 min plus the walk you could still do from it. */
  drawIso(origin: LngLat | null, router?: Router) {
    if (!origin || !router) return this.setData('iso', EMPTY);
    const reach = router.reach(origin, 45 * 60), feats: Feature[] = [];
    for (const band of [45, 30, 15]) {
      feats.push({ ...circle(origin, Math.min(band, 20) * 60 * (80 / 60 / 1.25), 48), properties: { band } });
      for (const [id, s] of reach) {
        const left = band * 60 - s; if (left < 60) continue; const st = router.byId.get(id)!;
        feats.push({ ...circle([st.lon, st.lat], Math.min(left, 15 * 60) * (80 / 60 / 1.25), 24), properties: { band } });
      }
    }
    this.setData('iso', fc(feats));
  }
  fly(p: LngLat, padding: maplibregl.PaddingOptions, opts: { zoom?: number; pitch?: number } = {}) {
    this.map.flyTo({ center: p, zoom: opts.zoom ?? 16, pitch: opts.pitch ?? 55, padding, duration: 1600, curve: 1.35, essential: false });
  }
}
