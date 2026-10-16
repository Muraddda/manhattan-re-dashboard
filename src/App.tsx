import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { AmbientLight, LightingEffect, DirectionalLight } from '@deck.gl/core';
import { IconLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import type { Amenities, Amenity, AmenityCategory, Building, BuildingPart, BuildingStore, Development, Listing, Selection } from './types';
import { distanceMeters, fmtPrice, loadAmenities, loadBlocks, loadBuildings, loadDevelopments, loadListings, matchBuilding, nearest } from './data';
import { ICONS, iconSpec, type IconKey } from './icons';

const HOME = { center: [-73.990, 40.732] as [number, number], zoom: 13.55, pitch: 55, bearing: -29 };
const CATS: { key: AmenityCategory; label: string }[] = [
  { key: 'grocery', label: 'Grocery' }, { key: 'schools', label: 'Schools' }, { key: 'parks', label: 'Parks' }, { key: 'subway', label: 'Subway' },
];
/** Radius (m) for amenity pop-ups around the selected building/listing (~5-min walk). Change freely. */
export const NEARBY_RADIUS_M = 400;
/** Amenity category mode: 'nearby' = only pop up around the selection (default), 'all' = show city-wide, 'off' = hidden. */
type CatMode = 'nearby' | 'all' | 'off';
const NEXT_MODE: Record<CatMode, CatMode> = { nearby: 'all', all: 'off', off: 'nearby' };
const easeOutBack = (x: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
type LayerKey = 'buildings' | 'listings' | 'developments' | AmenityCategory;
const TOOLBAR: { key: LayerKey; label: string; glyph: string; color: string }[] = [
  { key: 'buildings', label: 'Buildings', glyph: '🏢', color: '#7d8da1' },
  { key: 'listings', label: 'Listings (sample)', glyph: '💲', color: '#ff6f4f' },
  { key: 'developments', label: 'New Dev (sample)', glyph: '🏗️', color: '#8a5cf6' },
  { key: 'grocery', label: 'Grocery', glyph: '🛒', color: '#f59e0b' },
  { key: 'schools', label: 'Schools', glyph: '🎓', color: '#0f9f95' },
  { key: 'parks', label: 'Parks', glyph: '🌳', color: '#4caf50' },
  { key: 'subway', label: 'Subway', glyph: '🚇', color: '#2f7de1' },
];
/** `?static` disables the pulse animation loop (used for headless screenshots on software GL). */
/** `?detail` renders every individual footprint (buildings.json) instead of simplified blocks (blocks.json). */
const DETAIL = new URLSearchParams(location.search).has('detail');
const STATIC = new URLSearchParams(location.search).has('static');
// Palette: light-blue city, warm gold selection (contrasts with blue), coral listings, purple new dev.
const GOLD: [number, number, number, number] = [47, 107, 255, 255]; // selection: royal blue (reference accent)
const GOLD_HOVER: [number, number, number, number] = [122, 162, 255, 255];
const LISTING_BLD: [number, number, number, number] = [255, 170, 140, 255];
const BLUE_LOW = [146, 184, 230], BLUE_HIGH = [204, 224, 250]; // shaded low-rise → lit towers (around #A9CFEA)
function buildingBlue(id: string, h: number): [number, number, number, number] {
  const k = Math.min(1, Math.log1p(Math.max(0, h)) / Math.log1p(250)); const j = ((hash(id) % 13) - 6) * 1.6;
  return [0, 1, 2].map(i => Math.round(BLUE_LOW[i] + (BLUE_HIGH[i] - BLUE_LOW[i]) * k + j)).concat(255) as [number, number, number, number];
}
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

// Soft daylight: warm ambient + key sun from the south-west + cool fill from the north-east.
// Shadow maps (deck.gl `_shadow`) are opt-in via `?shadows` — they rendered white artifacts under software GL.
const SHADOWS = new URLSearchParams(location.search).has('shadows');
const lighting = new LightingEffect({
  ambient: new AmbientLight({ color: [255, 250, 242], intensity: 1.05 }),
  sun: new DirectionalLight({ color: [255, 240, 215], intensity: 1.1, direction: [1, 2.2, -2.5], _shadow: SHADOWS }),
  fill: new DirectionalLight({ color: [210, 228, 255], intensity: 0.35, direction: [-1, -1, -1] }),
});

export default function App() {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [devs, setDevs] = useState<Development[]>([]);
  const [amen, setAmen] = useState<Amenities | null>(null);
  const [store, setStore] = useState<BuildingStore>({});
  const [sel, setSel] = useState<Selection>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [on, setOn] = useState<Record<'buildings' | 'listings' | 'developments', boolean>>({ buildings: true, listings: true, developments: false });
  const [catMode, setCatMode] = useState<Record<AmenityCategory, CatMode>>({ grocery: 'nearby', schools: 'nearby', parks: 'nearby', subway: 'nearby' });
  const [popStart, setPopStart] = useState(0);
  const [t, setT] = useState(0);
  const [hud, setHud] = useState<string>('');

  // data
  useEffect(() => {
    const city = DETAIL ? loadBuildings() : loadBlocks().then(r => r.items);
    Promise.all([city, loadListings(), loadDevelopments(), loadAmenities()]).then(([b, l, d, a]) => {
      const byListing = new Map<string, string>(); for (const x of b) for (const lid of x.listings ?? []) byListing.set(lid, x.id);
      const ls = l.map(x => ({ ...x, buildingId: byListing.get(x.id) ?? matchBuilding([x.lon, x.lat], b) }));
      const st: BuildingStore = {};
      for (const x of ls) if (x.buildingId) (st[x.buildingId] ??= { listings: [] }).listings!.push(x.id);
      setBuildings(b); setListings(ls); setDevs(d); setAmen(a); setStore(st);
    });
  }, []);
  // pulse clock
  useEffect(() => { if (STATIC) return; let r = 0; const loop = () => { setT(performance.now() / 1000); r = requestAnimationFrame(loop); }; r = requestAnimationFrame(loop); return () => cancelAnimationFrame(r); }, []);

  // map
  useEffect(() => {
    const map = new maplibregl.Map({ container: mapDiv.current!, style: 'https://tiles.openfreemap.org/styles/positron', ...HOME, maxPitch: 75, antialias: true, maxBounds: [[-74.08, 40.67], [-73.88, 40.80]], canvasContextAttributes: { preserveDrawingBuffer: true } } as maplibregl.MapOptions);
    mapRef.current = map;
    map.on('style.load', () => {
      const set = (id: string, p: string, v: unknown) => { if (map.getLayer(id)) map.setPaintProperty(id, p as never, v as never); };
      set('background', 'background-color', '#eef1f6');
      set('park', 'fill-color', '#cfe6d2'); set('park', 'fill-opacity', 0.9);
      set('landcover_wood', 'fill-color', '#c4e0c8');
      set('water', 'fill-color', '#bcd3f0');
      set('landuse_residential', 'fill-color', '#eceff5');
      for (const l of map.getStyle().layers) if (l.id === 'building' || l.id.startsWith('building')) map.setLayoutProperty(l.id, 'visibility', 'none');
    });
    const overlay = new MapboxOverlay({ interleaved: false, effects: [lighting], layers: [] });
    map.addControl(overlay as unknown as maplibregl.IControl);
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    overlayRef.current = overlay;
    (window as unknown as { __map: maplibregl.Map }).__map = map;
    return () => map.remove();
  }, []);

  const flyTo = (lon: number, lat: number, zoom = 16.6) => mapRef.current?.flyTo({ center: [lon, lat], zoom, pitch: 60, bearing: (mapRef.current.getBearing() + 25) % 360, duration: 2200, essential: true, curve: 1.5 });

  const selBuildingId = sel?.kind === 'building' ? sel.id : sel?.kind === 'listing' ? listings.find(l => l.id === sel.id)?.buildingId : undefined;
  const listingBuildings = useMemo(() => new Set(listings.map(l => l.buildingId).filter(Boolean)), [listings]);

  const allParts = useMemo<BuildingPart[]>(() => buildings.flatMap(b => b.parts.map((ring, k) => ({ id: b.id, polygon: b.polys?.[k] ?? ring, height: b.height, minHeight: b.minHeight }))), [buildings]);
  const showListingBld = on.listings;
  // In simplified mode a short listing building would vanish inside its taller block: raise it just above the block roof.
  const blockHeight = useMemo(() => new Map(buildings.filter(b => b.kind === 'block').map(b => [b.id, b.height])), [buildings]);
  const listingLift = useMemo(() => new Map(buildings.filter(b => b.blockId).map(b => [b.id, (blockHeight.get(b.blockId!) ?? 0) + 4])), [buildings, blockHeight]);
  const parts = useMemo(() => showListingBld ? allParts.filter(p => !listingBuildings.has(p.id)) : allParts, [allParts, listingBuildings, showListingBld]);
  const listingParts = useMemo(() => showListingBld ? allParts.filter(p => listingBuildings.has(p.id)) : [], [allParts, listingBuildings, showListingBld]);
  const listingByBuilding = useMemo(() => new Map(listings.filter(l => l.buildingId).map(l => [l.buildingId!, l])), [listings]);
  const buildingLayer = useMemo(() => new SolidPolygonLayer<BuildingPart>({
    id: 'buildings', data: parts, visible: on.buildings, extruded: true, pickable: true,
    getPolygon: d => d.polygon, getElevation: d => Math.max(d.height, 4), getFillColor: d =>
      d.id === selBuildingId ? GOLD : d.id === hoverId ? GOLD_HOVER : buildingBlue(d.id, d.height),
    material: { ambient: 0.55, diffuse: 0.5, shininess: 12, specularColor: [40, 40, 40] },
    updateTriggers: { getFillColor: [selBuildingId, hoverId] },
    onHover: i => setHoverId(i.object?.id ?? null),
    onClick: i => { if (i.object) setSel({ kind: 'building', id: i.object.id }); },
  }), [parts, on.buildings, selBuildingId, hoverId]);

  // Anchor for nearby pop-ups: the selected building's centroid, or the selected listing's location.
  // Selecting an amenity keeps the previous anchor so its neighbours stay visible.
  const [anchor, setAnchor] = useState<[number, number] | null>(null);
  useEffect(() => {
    if (!sel) { setAnchor(null); return; }
    let a: [number, number] | null = null;
    if (sel.kind === 'listing') { const l = listings.find(x => x.id === sel.id); if (l) a = [l.lon, l.lat]; }
    else if (sel.kind === 'building') { const b = buildings.find(x => x.id === sel.id); if (b) a = b.centroid; }
    else if (sel.kind === 'development') { const d = devs.find(x => x.id === sel.id); if (d) a = [d.lon, d.lat]; }
    else return;
    setAnchor(a); setPopStart(performance.now() / 1000);
  }, [sel, listings, buildings, devs]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(null); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const amenityData = useMemo(() => {
    const out = {} as Record<AmenityCategory, (Amenity & { d: number })[]>;
    for (const c of CATS.map(x => x.key)) {
      const list = amen?.[c] ?? []; const m = catMode[c];
      out[c] = m === 'off' ? [] : list.map(a => ({ ...a, d: anchor ? distanceMeters(anchor, [a.lon, a.lat]) : Infinity }))
        .filter(a => m === 'all' || a.d <= NEARBY_RADIUS_M);
    }
    return out;
  }, [amen, catMode, anchor]);
  /** Pop-in scale for a nearby pin: staggered by distance from the anchor. */
  const popScale = (dist: number) => { if (STATIC || !isFinite(dist)) return 1; const x = Math.min(1, Math.max(0, (t - popStart - 0.35 - dist / 1200) / 0.45)); return Math.max(0, easeOutBack(x)); };
  const pulse = (o: number) => 0.5 + 0.5 * Math.sin(t * 3 + o);
  const layers = [
    buildingLayer,
    new ScatterplotLayer<[number, number]>({ id: 'nearby-ring', data: anchor ? [anchor] : [], getPosition: d => [d[0], d[1], 0.5], radiusUnits: 'meters',
      getRadius: NEARBY_RADIUS_M * (STATIC ? 1 : Math.min(1, easeOutBack(Math.min(1, (t - popStart) / 0.6)))), updateTriggers: { getRadius: [t, popStart] },
      filled: true, getFillColor: [47, 107, 255, 26], stroked: true, getLineColor: [47, 107, 255, 220], lineWidthUnits: 'pixels', getLineWidth: 2.5,
      parameters: { depthWriteEnabled: false } }),
    ...(['grocery', 'schools', 'parks', 'subway'] as AmenityCategory[]).map(c => new IconLayer({
      id: `amen-${c}`, data: amenityData[c], pickable: true, getIcon: () => iconSpec(c), getPosition: (d: { lon: number; lat: number }) => [d.lon, d.lat, 0],
      getSize: (d: { d: number }) => 34 * (catMode[c] === 'all' && !(d.d <= NEARBY_RADIUS_M) ? 0.85 : popScale(d.d)), updateTriggers: { getSize: [t, popStart, catMode[c]] }, sizeUnits: 'pixels', parameters: { depthCompare: 'always', depthWriteEnabled: false },
      onClick: (i: { object?: { id: string; lon: number; lat: number } }) => { if (i.object) { setSel({ kind: 'amenity', category: c, id: i.object.id }); } },
    })),
    new ScatterplotLayer<Development>({ id: 'dev-glow', data: devs, visible: on.developments, getPosition: d => [d.lon, d.lat], radiusUnits: 'pixels', getRadius: 20 + 8 * pulse(1), getFillColor: [138, 92, 246, 70], updateTriggers: { getRadius: t }, parameters: { depthCompare: 'always', depthWriteEnabled: false } }),
    new IconLayer<Development>({ id: 'devs', data: devs, visible: on.developments, pickable: true, getIcon: () => iconSpec('development'), getPosition: d => [d.lon, d.lat], getSize: 44, sizeUnits: 'pixels', parameters: { depthCompare: 'always', depthWriteEnabled: false },
      onClick: i => { if (i.object) { setSel({ kind: 'development', id: i.object.id }); flyTo(i.object.lon, i.object.lat); } } }),
    // Listing buildings: separate small layer so only these 16 recolour every frame (gentle coral pulse).
    new SolidPolygonLayer<BuildingPart>({ id: 'listing-buildings', data: listingParts, extruded: true, pickable: true,
      getPolygon: d => d.polygon, getElevation: d => Math.max(d.height, 6, listingLift.get(d.id) ?? 0),
      getFillColor: d => d.id === selBuildingId ? GOLD : d.id === hoverId ? GOLD_HOVER : [255, 110 + 30 * pulse(hash(d.id)), 80 + 25 * pulse(hash(d.id)), 255],
      material: { ambient: 0.7, diffuse: 0.45, shininess: 12, specularColor: [60, 40, 30] }, updateTriggers: { getFillColor: [t, selBuildingId, hoverId] },
      onHover: i => setHoverId(i.object?.id ?? null),
      onClick: i => { const l = i.object && listingByBuilding.get(i.object.id); if (l) { setSel({ kind: 'listing', id: l.id }); flyTo(l.lon, l.lat); } } }),
  ];
  useEffect(() => { overlayRef.current?.setProps({ layers, onClick: (i: { object?: unknown }) => { if (!i.object) setSel(null); }, getCursor: ({ isHovering }) => (isHovering ? 'pointer' : 'grab') }); });
  useEffect(() => { setHud(buildings.length ? `${buildings.length.toLocaleString()} buildings` : 'Loading city…'); }, [buildings]);

  // stats
  const active = listings.filter(l => l.status === 'Active');
  const byHood = useMemo(() => {
    const m = new Map<string, { sum: number; n: number }>();
    for (const l of listings) { const e = m.get(l.neighborhood) ?? { sum: 0, n: 0 }; e.sum += l.price; e.n++; m.set(l.neighborhood, e); }
    return [...m.entries()].map(([k, v]) => ({ hood: k, avg: v.sum / v.n, n: v.n })).sort((a, b) => b.avg - a.avg);
  }, [listings]);
  const maxAvg = Math.max(1, ...byHood.map(b => b.avg));

  const statusCount = (st: string) => listings.filter(l => l.status === st).length;
  const resetView = () => { setSel(null); mapRef.current?.flyTo({ ...HOME, duration: 2000 }); };
  const activeAvg = active.reduce((s, l) => s + l.price, 0) / Math.max(1, active.length);
  return (
    <div className="app">
      <div ref={mapDiv} className="map" />
      <div className="haze" />

      <header className="topbar">
        <div className="brandmark" onClick={resetView} title="Reset view"><span className="logo">◆</span><b>Skyline Realty</b></div>
        <nav className="seg">
          {['Command Center', 'Listings', 'Market', 'Analytics', 'Reports'].map((n, i) => <button key={n} className={i === 0 ? 'active' : ''}>{n}</button>)}
        </nav>
        <div className="tools">
          <button className="ib" title="Search">⌕</button>
          <button className="ib" title="Alerts">🔔<i className="nbadge">3</i></button>
          <button className="ib" title="Messages">💬</button>
          <button className="ib" title="Reset view" onClick={resetView}>⌂</button>
          <div className="avatar">MM</div>
        </div>
      </header>

      <div className="layerbar">
        {TOOLBAR.map(b => (
          b.key in catMode ? (() => { const c = b.key as AmenityCategory; const m = catMode[c]; return (
          <button key={b.key} className={`chip mode-${m}`} style={{ ['--c' as string]: b.color }} onClick={() => setCatMode(o => ({ ...o, [c]: NEXT_MODE[o[c]] }))}
            title={`${b.label}: ${m === 'nearby' ? `nearby only (${NEARBY_RADIUS_M} m)` : m === 'all' ? 'show all' : 'off'} · click to cycle`}>
            <span className="g">{b.glyph}</span>{b.label}<span className="badge">{m === 'nearby' ? 'Nearby' : m === 'all' ? 'All' : 'Off'}</span>
          </button>); })() :
          <button key={b.key} className={`chip ${on[b.key as keyof typeof on] ? 'on' : 'off'}`} style={{ ['--c' as string]: b.color }} onClick={() => setOn(o => ({ ...o, [b.key]: !o[b.key as keyof typeof on] }))}>
            <span className="g">{b.glyph}</span>{b.label}
          </button>
        ))}
      </div>
      <div className="hint">{sel ? `Amenities within ${NEARBY_RADIUS_M} m · Esc or click empty map to clear` : 'Click a coral listing building, any block, or a row below'}</div>

      <section className="card overview">
        <div className="ch"><span>Portfolio Overview</span><span className="sel-pill">▦ Today ▾</span></div>
        <div className="tag">SAMPLE DATA</div>
        {[
          { icon: '🏠', tint: 'blue', t: 'Active Listings', s: 'On market', v: String(active.length), d: '+12.6%', up: true },
          { icon: '💲', tint: 'green', t: 'Avg Asking Price', s: 'Active listings', v: fmtPrice(activeAvg), d: '+6.8%', up: true },
          { icon: '🏗', tint: 'purple', t: 'New Developments', s: 'Tracked projects', v: String(devs.length), d: '+1', up: true },
          { icon: '◎', tint: 'orange', t: 'GCI Pipeline', s: 'Est. 3% of active', v: fmtPrice(active.reduce((s, l) => s + l.price, 0) * 0.03), d: '-8.5%', up: false },
        ].map(k => (
          <div className="krow" key={k.t}><span className={`ki ${k.tint}`}>{k.icon}</span><span className="kt">{k.t}<small>{k.s}</small></span><b>{k.v}</b><em className={k.up ? 'up' : 'down'}>{k.up ? '↑' : '↓'} {k.d.replace(/^[-+]/, '')}</em></div>
        ))}
      </section>

      {sel ? <SidePanel sel={sel} close={() => setSel(null)} buildings={buildings} listings={listings} devs={devs} amen={amen} store={store} flyTo={flyTo} setSel={setSel} /> : (
        <section className="card alerts">
          <div className="ch"><span>🔔 Market Alerts</span><span className="sel-pill">⏱ live</span></div>
          <div className="tag">SAMPLE DATA</div>
          {[
            { c: 'red', i: '▲', t: 'Price cut · 88 Greenwich St', s: 'Asking reduced 4.2%', ago: '10m ago' },
            { c: 'purple', i: '◆', t: 'Hot zone · Flatiron', s: '3 offers in 48 h', ago: '35m ago' },
            { c: 'orange', i: '⌂', t: 'Open house · 130 Greene St', s: 'Sat 1–3 pm, 14 RSVPs', ago: '1h ago' },
          ].map(a => <div className="arow" key={a.t}><span className={`ai ${a.c}`}>{a.i}</span><span className="kt">{a.t}<small>{a.s}</small></span><small className="ago">{a.ago}</small></div>)}
          <div className="trio">
            <div><span>Days on Market</span><small>Median</small><b>42</b><em className="down">↑ 12%</em></div>
            <div><span>Price Cuts</span><small>Share</small><b>18%</b><em className="warn">Medium</em></div>
            <div><span>Absorption</span><small>Months</small><b>6.1</b><em className="up">Balanced</em></div>
          </div>
        </section>
      )}

      <section className="bottom">
        <div className="card">
          <div className="ch"><span>Listings</span><span className="muted0">{listings.length} · sample · click to fly</span></div>
          <div className="llist">{listings.map(l => (
            <button key={l.id} className={`lrow ${sel?.kind === 'listing' && sel.id === l.id ? 'sel' : ''}`} onClick={() => { setSel({ kind: 'listing', id: l.id }); flyTo(l.lon, l.lat); }}>
              <i className={`dot ${l.status.replace(' ', '')}`} /><span className="la">{l.address}<small>{l.neighborhood} · {l.beds} bd · {l.status}</small></span><b>{fmtPrice(l.price)}</b>
            </button>))}</div>
        </div>
        <div className="card">
          <div className="ch"><span>Inventory Status</span><span className="tag">SAMPLE</span></div>
          <div className="big2">{listings.length}<small> total listings</small></div>
          {[['Active', 'blue'], ['In Contract', 'orange'], ['Sold', 'green']].map(([st, c]) => (
            <div className="prog" key={st}><span>{st}</span><b>{statusCount(st)}</b><div className="pt"><i className={c} style={{ width: `${(statusCount(st) / Math.max(1, listings.length)) * 100}%` }} /></div></div>))}
          <div className="foot">{hud} · listings from <code>listings.csv</code></div>
        </div>
        <div className="card">
          <div className="ch"><span>Performance Insights</span><span className="sel-pill">This Year ▾</span></div>
          <LineChart />
        </div>
        <div className="card">
          <div className="ch"><span>Avg Price by Neighborhood</span><span className="tag">SAMPLE</span></div>
          <div className="bars">{byHood.slice(0, 8).map((b, i) => (
            <div key={b.hood} className="vb" title={`${b.hood}: ${fmtPrice(b.avg)}`}><i className={i === 0 ? 'hot' : ''} style={{ height: `${(b.avg / maxAvg) * 100}%` }} /><span>{b.hood.split(' ')[0].slice(0, 7)}</span></div>))}</div>
        </div>
      </section>
      <div className="attrib">SAMPLE listings, KPIs & developments are fictional · Map © OpenFreeMap © OpenStreetMap contributors</div>
    </div>
  );
}

/** Sample monthly inquiries vs showings line chart (SVG, no chart lib). */
function LineChart() {
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
  const a = [52, 58, 55, 66, 63, 72, 70, 78, 84], b = [30, 34, 33, 41, 38, 45, 47, 50, 56];
  const W = 300, H = 120, x = (i: number) => 24 + i * ((W - 34) / (m.length - 1)), y = (v: number) => H - 18 - (v / 100) * (H - 30);
  const path = (d: number[]) => d.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ');
  return (
    <div className="lc">
      <div className="legend"><span className="lb">● Inquiries</span><span className="lo">● Showings</span><span className="tag">SAMPLE</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%">
        {[0, 25, 50, 75, 100].map(v => <line key={v} x1="22" x2={W - 6} y1={y(v)} y2={y(v)} stroke="#eef1f6" />)}
        <path d={path(a)} fill="none" stroke="#2f6bff" strokeWidth="2.2" /><path d={path(b)} fill="none" stroke="#ff8a3d" strokeWidth="2.2" />
        {a.map((v, i) => <circle key={'a' + i} cx={x(i)} cy={y(v)} r="3" fill="#fff" stroke="#2f6bff" strokeWidth="1.8" />)}
        {b.map((v, i) => <circle key={'b' + i} cx={x(i)} cy={y(v)} r="3" fill="#fff" stroke="#ff8a3d" strokeWidth="1.8" />)}
        {m.map((t, i) => <text key={t} x={x(i)} y={H - 3} fontSize="8" fill="#8a94a6" textAnchor="middle">{t}</text>)}
        <g transform={`translate(${x(7) - 62},${y(84) + 8})`}><rect width="62" height="30" rx="6" fill="#fff" stroke="#e6eaf2" /><text x="6" y="12" fontSize="7.5" fill="#2f6bff">● Inquiries 84</text><text x="6" y="24" fontSize="7.5" fill="#ff8a3d">● Showings 56</text></g>
      </svg>
    </div>
  );
}

function SidePanel(p: { sel: Selection; close: () => void; buildings: Building[]; listings: Listing[]; devs: Development[]; amen: Amenities | null; store: BuildingStore; flyTo: (lon: number, lat: number, z?: number) => void; setSel: (s: Selection) => void }) {
  const { sel } = p; if (!sel) return null;
  let body: React.ReactNode = null;
  const nearestBlock = (lon: number, lat: number) => p.amen && (
    <div className="near"><div className="h2">Nearest amenities (approx. walk)</div>
      {CATS.map(c => { const n = nearest([lon, lat], p.amen![c.key]); return n && (
        <div key={c.key} className="nrow"><img src={ICONS[c.key].url} /><span className="nl">{c.label}<small>{n.amenity.name}</small></span><b>{n.minutes} min</b></div>); })}
    </div>);
  if (sel.kind === 'listing') {
    const l = p.listings.find(x => x.id === sel.id)!;
    body = <>
      <div className="tag big">SAMPLE LISTING</div>
      <div className="price">{fmtPrice(l.price)}</div>
      <div className="addr">{l.address}</div><div className="hood">{l.neighborhood}</div>
      <div className="chips"><span>{l.beds} bd</span><span>{l.baths} ba</span><span>{l.sqft.toLocaleString()} ft²</span><span>{l.type}</span><span className={`st ${l.status.replace(' ', '')}`}>{l.status}</span></div>
      {nearestBlock(l.lon, l.lat)}
      <div className="meta">Listing ID <code>{l.id}</code>{l.buildingId && <> · Building <a onClick={() => p.setSel({ kind: 'building', id: l.buildingId! })}><code>{l.buildingId}</code></a></>}</div>
    </>;
  } else if (sel.kind === 'building') {
    const b = p.buildings.find(x => x.id === sel.id); const d = p.store[sel.id];
    body = <>
      <div className="tag big teal">{b?.kind === 'block' ? 'CITY BLOCK' : b?.kind === 'landmark' ? 'LANDMARK' : 'BUILDING'}</div>
      {b?.name && <div className="addr">{b.name}</div>}
      {b?.kind === 'block' && <div className="muted">Simplified block · {b.buildingIds?.length} buildings · avg height {Math.round(b.height)} m</div>}
      <div className="price small"><code>{sel.id}</code></div>
      {b && <div className="chips"><span>~{Math.round(b.height)} m tall</span><span>~{Math.max(1, Math.round(b.height / 3.3))} floors</span><span>{b.centroid[1].toFixed(5)}, {b.centroid[0].toFixed(5)}</span></div>}
      <div className="h2">Attached data</div>
      {d ? <pre>{JSON.stringify(d, null, 2)}</pre> : <div className="muted">No data attached yet. Add entries to the <code>BuildingStore</code> keyed by this ID.</div>}
      {d?.listings?.map(id => <button key={id} className="ghost" onClick={() => { const l = p.listings.find(x => x.id === id)!; p.setSel({ kind: 'listing', id }); p.flyTo(l.lon, l.lat); }}>Open listing {id}</button>)}
      {b && nearestBlock(b.centroid[0], b.centroid[1])}
    </>;
  } else if (sel.kind === 'development') {
    const d = p.devs.find(x => x.id === sel.id)!;
    body = <><div className="tag big purple">SAMPLE NEW DEVELOPMENT</div><div className="price small">{d.name}</div><div className="addr">{d.address}</div>
      <div className="chips"><span>{d.units} units</span><span>{d.floors} floors</span><span>Est. {d.completion}</span><span>{d.status}</span></div>{nearestBlock(d.lon, d.lat)}</>;
  } else if (sel.kind === 'amenity') {
    const a = p.amen?.[sel.category].find(x => x.id === sel.id);
    body = a && <><div className="tag big green">{sel.category.toUpperCase()} · OSM</div><div className="price small">{a.name}</div><div className="muted">{a.kind} · <code>{a.id}</code></div></>;
  }
  return <section className="card side"><button className="x" onClick={p.close}>✕</button>{body}</section>;
}
