import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { AmbientLight, LightingEffect, DirectionalLight } from '@deck.gl/core';
import { IconLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { ArrowUpDown, Bath, BedDouble, Box, Building2, ChartColumn, ChevronRight, Footprints, GraduationCap, Home, LayoutList, Minus, Navigation2, Plus, Ruler, Search, ShoppingCart, Sparkles, TrainFront, Trees, X, type LucideIcon } from 'lucide-react';
import type { Amenities, Amenity, AmenityCategory, Building, BuildingPart, BuildingStore, Development, Listing, LngLat, Selection } from './types';
import { distanceMeters, fmtPrice, loadAmenities, loadBlocks, loadBuildings, loadDevelopments, loadListings, matchBuilding, nearest, walkMinutes } from './data';
import { COLORS, iconSpec } from './icons';

type RGBA = [number, number, number, number];
const Q = new URLSearchParams(location.search);
/** `?simple` draws the merged street blocks (blocks.json) instead of every footprint (buildings.json). */
const SIMPLE = Q.has('simple');
/** `?static` skips the intro flight and marker transitions (headless screenshots). */
const STATIC = Q.has('static');
const SHADOWS = Q.has('shadows');
const REDUCED = STATIC || matchMedia('(prefers-reduced-motion: reduce)').matches;

const HOME = { center: [-73.9915, 40.7335] as LngLat, zoom: 14.1, pitch: 58, bearing: -29 };
/** Radius (m) for amenity pop-ups around the selection (~5-min walk). */
export const NEARBY_RADIUS_M = 400;
type CatMode = 'nearby' | 'all' | 'off';
const NEXT_MODE: Record<CatMode, CatMode> = { nearby: 'all', all: 'off', off: 'nearby' };
const CATS: { key: AmenityCategory; label: string; Icon: LucideIcon }[] = [
  { key: 'grocery', label: 'Grocery', Icon: ShoppingCart }, { key: 'schools', label: 'Schools', Icon: GraduationCap },
  { key: 'parks', label: 'Parks', Icon: Trees }, { key: 'subway', label: 'Subway', Icon: TrainFront },
];
const STATUSES = ['All', 'Active', 'In Contract', 'Sold'] as const;
const SORTS = { 'price-desc': 'Price: high to low', 'price-asc': 'Price: low to high', 'ppsf-desc': 'Price / ft²' } as const;

// Scene palette: near-white massing (Apple-Maps-like daylight), glassy blue towers, one warm accent for listings.
const ACCENT: RGBA = [59, 91, 253, 255];
const HILITE: RGBA = [59, 91, 253, 110];
const LISTING: RGBA = [242, 100, 61, 255];
const LISTING_DIM: RGBA = [246, 196, 178, 255];
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
function massing(id: string, h: number): RGBA {
  const j = (hash(id) % 7) - 3;
  const glass = Math.min(1, Math.max(0, (h - 90) / 160)); // towers drift toward a cool glass tint
  const base = [241 + j, 242 + j, 246 + j], tower = [206, 220, 241];
  return [0, 1, 2].map(i => Math.round(base[i] + (tower[i] - base[i]) * glass)).concat(255) as RGBA;
}
const lighting = new LightingEffect({
  // low warm sun from the south-west + cool sky fill from the north-east, so every wall orientation gets its own shade
  ambient: new AmbientLight({ color: [255, 255, 255], intensity: 0.82 }),
  sun: new DirectionalLight({ color: [255, 240, 220], intensity: 1.25, direction: [1.2, 2.2, -1.6], _shadow: SHADOWS }),
  sky: new DirectionalLight({ color: [200, 218, 255], intensity: 0.55, direction: [-1.5, -1, -0.8] }),
});
const MATERIAL = { ambient: 0.5, diffuse: 0.62, shininess: 20, specularColor: [30, 32, 38] as [number, number, number] };
const easeOutBack = (x: number) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2; };
const ease = (x: number) => 1 - (1 - x) ** 3;
const ppsf = (l: Listing) => l.sqft ? l.price / l.sqft : 0;

export default function App() {
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const compassRef = useRef<SVGSVGElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [devs, setDevs] = useState<Development[]>([]);
  const [amen, setAmen] = useState<Amenities | null>(null);
  const [store, setStore] = useState<BuildingStore>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'nocity'>('loading');
  const [sel, setSel] = useState<Selection>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [showTags, setShowTags] = useState(true);
  const [showDevs, setShowDevs] = useState(false);
  const [catMode, setCatMode] = useState<Record<AmenityCategory, CatMode>>({ grocery: 'nearby', schools: 'nearby', parks: 'nearby', subway: 'nearby' });
  const [tab, setTab] = useState<'listings' | 'market'>('listings');
  const [query, setQuery] = useState('');
  const [statusF, setStatusF] = useState<(typeof STATUSES)[number]>('All');
  const [sort, setSort] = useState<keyof typeof SORTS>('price-desc');
  const [is3D, setIs3D] = useState(true);
  const phone = useMedia('(max-width: 820px)');
  const [snap, setSnap] = useState<Snap>('half');

  // data: every source fails on its own (the big city files are generated, not committed; see README)
  useEffect(() => {
    const soft = <T,>(p: Promise<T>, fallback: T, what: string) => p.catch(e => { console.error(`Failed to load ${what}:`, e); return fallback; });
    const blocks = () => loadBlocks().then(r => r.items);
    const city = soft(SIMPLE ? blocks().catch(loadBuildings) : loadBuildings().catch(blocks), [] as Building[], 'city geometry');
    Promise.all([city, soft(loadListings(), [], 'listings'), soft(loadDevelopments(), [], 'developments'), soft(loadAmenities(), null, 'amenities')]).then(([b, l, d, a]) => {
      const byListing = new Map<string, string>(); for (const x of b) for (const lid of x.listings ?? []) byListing.set(lid, x.id);
      const ls = l.map(x => ({ ...x, buildingId: byListing.get(x.id) ?? matchBuilding([x.lon, x.lat], b) }));
      const st: BuildingStore = {};
      for (const x of ls) if (x.buildingId) (st[x.buildingId] ??= { listings: [] }).listings!.push(x.id);
      setBuildings(b); setListings(ls); setDevs(d); setAmen(a); setStore(st); setStatus(b.length ? 'ready' : 'nocity');
    });
  }, []);

  // map
  useEffect(() => {
    const start = REDUCED ? HOME : { ...HOME, zoom: 12.9, pitch: 24, bearing: -12 };
    const map = new maplibregl.Map({ container: mapDiv.current!, style: 'https://tiles.openfreemap.org/styles/positron', ...start, maxPitch: 72, attributionControl: false,
      maxBounds: [[-74.08, 40.67], [-73.88, 40.80]], canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true } } as maplibregl.MapOptions);
    mapRef.current = map;
    map.setPadding(padding(false));
    map.on('style.load', () => {
      const set = (id: string, p: string, v: unknown) => { if (map.getLayer(id)) map.setPaintProperty(id, p as never, v as never); };
      set('background', 'background-color', '#f1f2f4');
      set('landuse_residential', 'fill-color', '#eef0f3');
      set('park', 'fill-color', '#d7ebd6'); set('park', 'fill-opacity', 1);
      set('landcover_wood', 'fill-color', '#cfe6ce');
      set('water', 'fill-color', '#c3d8f2');
      // Our deck.gl buildings replace the basemap's. Street, POI and shield labels would float on top of the 3D massing, so keep only water and city names.
      for (const l of map.getStyle().layers) if (l.id.startsWith('building') || (l.type === 'symbol' && !/^(water_name_line|waterway_line|label_(town|city|state|country))/.test(l.id))) map.setLayoutProperty(l.id, 'visibility', 'none');
    });
    map.on('rotate', () => { if (compassRef.current) compassRef.current.style.transform = `rotate(${-map.getBearing()}deg)`; });
    map.on('pitchend', () => setIs3D(map.getPitch() > 10));
    const overlay = new MapboxOverlay({ interleaved: false, // interleaved needs map.transform, which maplibre 6 no longer exposes
      effects: [lighting], layers: [] });
    map.addControl(overlay as unknown as maplibregl.IControl);
    overlayRef.current = overlay;
    (window as unknown as { __map: maplibregl.Map }).__map = map;
    return () => map.remove();
  }, []);
  // intro: glide down into the city once it is there
  useEffect(() => { if (status !== 'loading' && !REDUCED) mapRef.current?.easeTo({ ...HOME, padding: padding(false), duration: 2600, easing: x => x < .5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2 }); }, [status]);

  /** Keep the target centred in the part of the map not covered by the side panel and detail sheet. */
  const padding = (sheet = true) => innerWidth <= 820 ? { top: 150, bottom: sheet ? innerHeight * 0.5 : snapHeight(snap) + 10, left: 0, right: 0 } : { top: 40, bottom: 90, left: innerWidth < 1180 ? 340 : 390, right: sheet ? 370 : 0 };
  const flyTo = (lon: number, lat: number, zoom = 15.9) => mapRef.current?.flyTo({ center: [lon, lat], zoom, pitch: is3D ? 56 : 0, duration: 1700, curve: 1.35, padding: padding(), easing: ease });
  const resetView = () => { setSel(null); mapRef.current?.flyTo({ ...HOME, pitch: is3D ? HOME.pitch : 0, duration: 1600, padding: padding(false), easing: ease }); };
  const toggle3D = () => { const m = mapRef.current; if (!m) return; const to = !is3D; setIs3D(to); m.easeTo({ pitch: to ? 58 : 0, bearing: to ? m.getBearing() : 0, duration: 900, easing: ease }); };
  const selectListing = (l: Listing) => { setSel({ kind: 'listing', id: l.id }); flyTo(l.lon, l.lat); };
  // phone: a selection opens its own card, so tuck the list sheet away
  useEffect(() => { if (sel && phone) setSnap('peek'); }, [sel, phone]);

  // keyboard: "/" or ⌘K focuses search, Esc closes things
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.key === '/' && document.activeElement !== searchRef.current) || (e.key === 'k' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); setTab('listings'); searchRef.current?.focus(); }
      else if (e.key === 'Escape') { if (document.activeElement === searchRef.current) searchRef.current?.blur(); else setSel(null); }
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, []);

  // derived listing views
  const byId = useMemo(() => new Map(listings.map(l => [l.id, l])), [listings]);
  const selListing = sel?.kind === 'listing' ? byId.get(sel.id) : undefined;
  const selBuildingId = sel?.kind === 'building' ? sel.id : selListing?.buildingId;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const f = listings.filter(l => (statusF === 'All' || l.status === statusF) && (!q || `${l.address} ${l.neighborhood} ${l.type} ${l.beds}bd`.toLowerCase().includes(q)));
    return f.sort(sort === 'price-asc' ? (a, b) => a.price - b.price : sort === 'ppsf-desc' ? (a, b) => ppsf(b) - ppsf(a) : (a, b) => b.price - a.price);
  }, [listings, query, statusF, sort]);
  const shownIds = useMemo(() => new Set(shown.map(l => l.id)), [shown]);
  const countBy = (s: string) => s === 'All' ? listings.length : listings.filter(l => l.status === s).length;

  // scene geometry
  const bById = useMemo(() => new Map(buildings.map(b => [b.id, b])), [buildings]);
  const listingBuildings = useMemo(() => new Set(listings.map(l => l.buildingId).filter(Boolean) as string[]), [listings]);
  const allParts = useMemo<BuildingPart[]>(() => buildings.flatMap(b => b.parts.map((ring, k) => ({ id: b.id, polygon: b.polys?.[k] ?? ring, height: b.height, minHeight: b.minHeight }))), [buildings]);
  const parts = useMemo(() => allParts.filter(p => !listingBuildings.has(p.id)), [allParts, listingBuildings]);
  const listingParts = useMemo(() => allParts.filter(p => listingBuildings.has(p.id)), [allParts, listingBuildings]);
  // simplified mode: a short listing building would hide inside its block, so raise it just above the block roof
  const roof = (id?: string) => { const b = id ? bById.get(id) : undefined; if (!b) return 20; const blk = b.blockId ? bById.get(b.blockId) : undefined; return Math.max(b.height, 6, blk ? blk.height + 4 : 0); };
  const listingOfBuilding = (id: string) => store[id]?.listings?.map(x => byId.get(x)!).filter(Boolean) ?? [];

  // nearby anchor: selected building centroid / listing / development; selecting an amenity keeps the previous anchor
  const [anchor, setAnchor] = useState<LngLat | null>(null);
  useEffect(() => {
    if (!sel) return setAnchor(null);
    if (sel.kind === 'amenity') return;
    const a: LngLat | undefined = sel.kind === 'listing' ? (selListing && [selListing.lon, selListing.lat]) : sel.kind === 'building' ? bById.get(sel.id)?.centroid : (() => { const d = devs.find(x => x.id === sel.id); return d && [d.lon, d.lat] as LngLat; })();
    setAnchor(a ?? null);
  }, [sel, selListing, bById, devs]);
  const amenityData = useMemo(() => {
    const out = {} as Record<AmenityCategory, (Amenity & { d: number })[]>;
    for (const { key: c } of CATS) {
      const m = catMode[c];
      out[c] = m === 'off' ? [] : (amen?.[c] ?? []).map(a => ({ ...a, d: anchor ? distanceMeters(anchor, [a.lon, a.lat]) : Infinity })).filter(a => m === 'all' || a.d <= NEARBY_RADIUS_M);
    }
    return out;
  }, [amen, catMode, anchor]);

  const D = REDUCED ? 0 : 1;
  const buildingLayer = useMemo(() => new SolidPolygonLayer<BuildingPart>({
    id: 'buildings', data: parts, visible: parts.length > 0, extruded: true, pickable: true, autoHighlight: true, highlightColor: HILITE,
    getPolygon: d => d.polygon, getElevation: d => Math.max(d.height, 4),
    getFillColor: d => d.id === selBuildingId ? ACCENT : massing(d.id, d.height),
    material: MATERIAL, updateTriggers: { getFillColor: selBuildingId },
    onClick: i => { if (i.object) setSel({ kind: 'building', id: i.object.id }); },
  }), [parts, selBuildingId]);
  const selRing = useMemo(() => {
    const b = selBuildingId ? bById.get(selBuildingId) : undefined; if (!b) return [];
    const z = listingBuildings.has(b.id) ? roof(b.id) : Math.max(b.height, 4);
    return b.parts.map(r => ({ path: r.map(([x, y]) => [x, y, z + 0.3]) }));
  }, [selBuildingId, bById, listingBuildings]);

  const pickListing = (id?: string) => { if (!id) return; const ls = listingOfBuilding(id); if (ls.length === 1) selectListing(ls[0]); else setSel({ kind: 'building', id }); };
  const layers = [
    buildingLayer,
    new SolidPolygonLayer<BuildingPart>({ id: 'listing-buildings', data: listingParts, visible: listingParts.length > 0, extruded: true, pickable: true,
      getPolygon: d => d.polygon, getElevation: d => roof(d.id),
      getFillColor: d => d.id === selBuildingId ? ACCENT : !showTags ? massing(d.id, d.height) : d.id === hoverId ? [255, 128, 92, 255] : listingOfBuilding(d.id).some(l => shownIds.has(l.id)) ? LISTING : LISTING_DIM,
      material: MATERIAL, updateTriggers: { getFillColor: [selBuildingId, hoverId, shownIds, showTags], getElevation: bById },
      onHover: i => setHoverId(i.object?.id ?? null), onClick: i => pickListing(i.object?.id) }),
    new PathLayer<{ path: number[][] }>({ id: 'sel-outline', data: selRing, getPath: d => d.path as never, getColor: [255, 255, 255, 230], getWidth: 2.5, widthUnits: 'pixels', jointRounded: true, parameters: { depthCompare: 'always' } }),
    new ScatterplotLayer<LngLat>({ id: 'nearby-ring', data: anchor ? [anchor] : [], getPosition: d => [d[0], d[1], 0], radiusUnits: 'meters', getRadius: NEARBY_RADIUS_M,
      filled: true, getFillColor: [59, 91, 253, 20], stroked: true, getLineColor: [59, 91, 253, 170], lineWidthUnits: 'pixels', getLineWidth: 1.5,
      transitions: { getRadius: { duration: 700 * D, easing: ease, enter: () => [0] }, getPosition: { duration: 700 * D, easing: ease } }, parameters: { depthWriteEnabled: false } }),
    ...CATS.map(({ key: c }) => new IconLayer<Amenity & { d: number }>({
      id: `amen-${c}`, data: amenityData[c], pickable: true, getIcon: () => iconSpec(c), getPosition: d => [d.lon, d.lat, 2], sizeUnits: 'pixels',
      getSize: d => catMode[c] === 'all' && !(d.d <= NEARBY_RADIUS_M) ? 20 : 28, updateTriggers: { getSize: [catMode[c], anchor] },
      transitions: { getSize: { duration: 520 * D, easing: easeOutBack, enter: () => [0] } }, parameters: { depthCompare: 'always' },
      onClick: i => { if (i.object) setSel({ kind: 'amenity', category: c, id: i.object.id }); },
    })),
    new IconLayer<Development>({ id: 'devs', data: devs, visible: showDevs, pickable: true, getIcon: () => iconSpec('development'), getPosition: d => [d.lon, d.lat, 2], getSize: 34, sizeUnits: 'pixels', parameters: { depthCompare: 'always' },
      onClick: i => { if (i.object) { setSel({ kind: 'development', id: i.object.id }); flyTo(i.object.lon, i.object.lat); } } }),
  ];
  // Price tags are HTML markers: constant size at any depth, same type and CSS as the UI. deck's TextLayer shrank with distance.
  const tags = useRef(new Map<string, { m: maplibregl.Marker; el: HTMLButtonElement }>());
  const tagActions = useRef({ select: selectListing, hover: setHoverId }); tagActions.current.select = selectListing;
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const want = new Map((showTags ? shown : []).map(l => [l.id, l]));
    for (const [id, t] of tags.current) if (!want.has(id)) { t.m.remove(); tags.current.delete(id); }
    for (const l of want.values()) {
      if (tags.current.has(l.id)) continue;
      const wrap = document.createElement('div'); const el = document.createElement('button');
      el.className = 'tag'; el.textContent = fmtPrice(l.price); el.setAttribute('aria-label', `${l.address}, ${fmtPrice(l.price)}`); wrap.append(el);
      el.onclick = e => { e.stopPropagation(); tagActions.current.select(l); };
      el.onmouseenter = () => tagActions.current.hover(l.buildingId ?? null); el.onmouseleave = () => tagActions.current.hover(null);
      tags.current.set(l.id, { m: new maplibregl.Marker({ element: wrap, anchor: 'bottom', offset: [0, -4] }).setLngLat([l.lon, l.lat]).addTo(map), el });
    }
  }, [shown, showTags]);
  useEffect(() => {
    for (const [id, { m, el }] of tags.current) {
      const on = id === selListing?.id, hov = !!hoverId && byId.get(id)?.buildingId === hoverId;
      el.classList.toggle('sel', on); el.classList.toggle('hover', hov); m.getElement().style.zIndex = on ? '4' : hov ? '3' : '';
    }
  });
  useEffect(() => { overlayRef.current?.setProps({ layers, onClick: (i: { object?: unknown }) => { if (!i.object) setSel(null); }, getCursor: ({ isHovering }) => (isHovering ? 'pointer' : 'grab') }); });

  // market stats (computed from the data, nothing hardcoded)
  const active = listings.filter(l => l.status === 'Active');
  const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const byHood = useMemo(() => {
    const m = new Map<string, { sum: number; n: number; sqft: number }>();
    for (const l of listings) { const e = m.get(l.neighborhood) ?? { sum: 0, n: 0, sqft: 0 }; e.sum += l.price; e.n++; e.sqft += l.sqft; m.set(l.neighborhood, e); }
    return [...m.entries()].map(([hood, v]) => ({ hood, avg: v.sum / v.n, n: v.n, ppsf: v.sqft ? v.sum / v.sqft : 0 })).sort((a, b) => b.avg - a.avg);
  }, [listings]);
  const maxAvg = Math.max(1, ...byHood.map(b => b.avg));
  const stats = [
    { k: 'Active', v: String(active.length) },
    { k: 'Median ask', v: fmtPrice(median(active.map(l => l.price))) },
    { k: 'Median $/ft²', v: `$${Math.round(median(active.map(ppsf))).toLocaleString()}` },
  ];

  const panelRef = useRef<HTMLElement>(null);
  const logo = <button className="logo" onClick={resetView} aria-label="Reset view"><Building2 size={18} strokeWidth={2.2} /></button>;
  const samplePill = <span className="pill sample" title="Listings, developments and figures are fictional">Sample data</span>;
  const search = (
    <label className="search">
      <Search size={16} />
      <input ref={searchRef} value={query} onChange={e => { setQuery(e.target.value); setTab('listings'); }} onFocus={() => phone && setSnap('full')}
        placeholder={phone ? 'Search Manhattan listings' : 'Search address, neighborhood…'} aria-label="Search listings" enterKeyHint="search" />
      {query ? <button className="icon-btn sm" onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button> : phone ? samplePill : <kbd>/</kbd>}
    </label>);
  return (
    <div className="app">
      <div ref={mapDiv} className="map" />
      <div className="vignette" />

      {phone && <div className="topbar glass">{logo}{search}</div>}
      <aside ref={panelRef} className={`panel glass snap-${snap}`} style={phone ? { height: snapHeight(snap) } : undefined} aria-label="Listings and market">
        {!phone && <header className="brand">{logo}<div><b>Skyline</b><small>Manhattan South · 3D</small></div>{samplePill}</header>}
        {!phone && search}
        {phone && <SheetGrip snap={snap} setSnap={setSnap} panel={panelRef} />}
        <div className="seg" role="tablist" data-i={tab === 'listings' ? 0 : 1}>
          <i className="seg-thumb" />
          <button role="tab" aria-selected={tab === 'listings'} onClick={() => setTab('listings')}><LayoutList size={15} />Listings</button>
          <button role="tab" aria-selected={tab === 'market'} onClick={() => setTab('market')}><ChartColumn size={15} />Market</button>
        </div>

        {tab === 'listings' ? (
          <div className="tabbody" key="l">
            <div className="stats">{stats.map(s => <div key={s.k}><small>{s.k}</small><b>{listings.length ? s.v : <i className="skel w40" />}</b></div>)}</div>
            <div className="filters">
              <div className="chips" role="radiogroup" aria-label="Status">
                {STATUSES.map(s => <button key={s} role="radio" aria-checked={statusF === s} className={`chip ${statusF === s ? 'on' : ''}`} onClick={() => setStatusF(s)}>{s}<span>{countBy(s)}</span></button>)}
              </div>
              <label className="sort" title="Sort"><ArrowUpDown size={14} />
                <select value={sort} onChange={e => setSort(e.target.value as keyof typeof SORTS)} aria-label="Sort listings">{Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
              </label>
            </div>
            <div className="list" onMouseLeave={() => setHoverId(null)}>
              {!listings.length && status === 'loading' && Array.from({ length: 6 }, (_, i) => <div key={i} className="row skel-row"><i className="skel w70" /><i className="skel w40" /></div>)}
              {listings.length > 0 && !shown.length && <div className="empty">No listings match.<button className="link" onClick={() => { setQuery(''); setStatusF('All'); }}>Clear filters</button></div>}
              {shown.map((l, i) => (
                <button key={l.id} style={{ ['--i' as string]: i }} className={`row ${selListing?.id === l.id ? 'sel' : ''} ${hoverId && l.buildingId === hoverId ? 'hover' : ''}`}
                  onMouseEnter={() => setHoverId(l.buildingId ?? null)} onClick={() => selectListing(l)}>
                  <span className={`dot s-${l.status.replace(' ', '')}`} />
                  <span className="row-main"><b>{l.address}</b><small>{l.neighborhood} · {l.beds} bd · {l.baths} ba · {l.sqft.toLocaleString()} ft²</small></span>
                  <span className="row-price">{fmtPrice(l.price)}<small>${Math.round(ppsf(l)).toLocaleString()}/ft²</small></span>
                </button>))}
            </div>
          </div>
        ) : (
          <div className="tabbody market" key="m">
            <section>
              <h3>Inventory <small>{listings.length} listings</small></h3>
              <div className="stack">{(['Active', 'In Contract', 'Sold'] as const).map(s => <i key={s} className={`s-${s.replace(' ', '')}`} style={{ flexGrow: countBy(s) }} />)}</div>
              <div className="legend">{(['Active', 'In Contract', 'Sold'] as const).map(s => <span key={s}><i className={`dot s-${s.replace(' ', '')}`} />{s}<b>{countBy(s)}</b></span>)}</div>
            </section>
            <section>
              <h3>Avg price by neighborhood</h3>
              <div className="hbars">{byHood.map((b, i) => (
                <button key={b.hood} className="hbar" style={{ ['--i' as string]: i }} onClick={() => { setQuery(b.hood); setTab('listings'); }} title={`Show ${b.hood} listings`}>
                  <span className="hb-label">{b.hood}<small>{b.n} · ${Math.round(b.ppsf).toLocaleString()}/ft²</small></span>
                  <span className="hb-track"><i style={{ width: `${(b.avg / maxAvg) * 100}%` }} /></span>
                  <b>{fmtPrice(b.avg)}</b>
                </button>))}</div>
            </section>
            <section>
              <h3>New developments <small>{devs.length}</small></h3>
              {devs.map(d => (
                <button key={d.id} className="row dev" onClick={() => { setShowDevs(true); setSel({ kind: 'development', id: d.id }); flyTo(d.lon, d.lat); }}>
                  <span className="ico" style={{ color: COLORS.development }}><Sparkles size={15} /></span>
                  <span className="row-main"><b>{d.name.replace(' (SAMPLE)', '')}</b><small>{d.units} units · {d.floors} fl · {d.completion}</small></span>
                  <ChevronRight size={16} className="chev" />
                </button>))}
            </section>
          </div>
        )}
        <footer className="panel-foot">
          {status === 'nocity' ? <span className="warn">City geometry missing: generate <code>public/data/buildings.json</code> (see README)</span>
            : status === 'loading' ? <span><i className="spinner" />Loading 3D city…</span>
            : <span>{buildings.length.toLocaleString()} {SIMPLE ? 'blocks & buildings' : 'buildings'} · © OpenFreeMap © OpenStreetMap</span>}
        </footer>
      </aside>

      {sel && <DetailSheet key={sel.kind + sel.id} sel={sel} close={() => setSel(null)} bById={bById} byId={byId} devs={devs} amen={amen} store={store} anchor={anchor}
        onListing={selectListing} onBuilding={id => setSel({ kind: 'building', id })} />}

      <nav className="dock glass" aria-label="Map layers">
        <DockBtn on={showTags} onClick={() => setShowTags(v => !v)} label="Listings" color="#f2643d" Icon={Home} />
        <DockBtn on={showDevs} onClick={() => setShowDevs(v => !v)} label="New dev" color={COLORS.development} Icon={Sparkles} />
        <span className="dock-sep" />
        {CATS.map(({ key, label, Icon }) => { const m = catMode[key]; return (
          <DockBtn key={key} on={m !== 'off'} mode={m} onClick={() => setCatMode(o => ({ ...o, [key]: NEXT_MODE[o[key]] }))} color={COLORS[key]} Icon={Icon}
            label={label} tip={`${label}: ${m === 'nearby' ? `within ${NEARBY_RADIUS_M} m of selection` : m === 'all' ? 'showing all' : 'hidden'}. Click to cycle`} />); })}
      </nav>

      <div className="controls">
        <div className="glass ctl-group">
          <button className="icon-btn" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in"><Plus size={18} /></button>
          <button className="icon-btn" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out"><Minus size={18} /></button>
        </div>
        <div className="glass ctl-group">
          <button className="icon-btn" onClick={() => mapRef.current?.easeTo({ bearing: 0, duration: 700, easing: ease })} aria-label="Point north" title="Point north">
            <Navigation2 ref={compassRef} size={17} style={{ transform: `rotate(${-HOME.bearing}deg)` }} className="compass" /></button>
          <button className={`icon-btn ${is3D ? 'active' : ''}`} onClick={toggle3D} aria-label={is3D ? 'Switch to 2D' : 'Switch to 3D'} title={is3D ? '2D view' : '3D view'}><Box size={17} /></button>
          <button className="icon-btn" onClick={resetView} aria-label="Reset view" title="Reset view"><Home size={17} /></button>
        </div>
      </div>
      {!sel && status !== 'loading' && <div className="hint glass">Click a building or price tag · <kbd>/</kbd> to search</div>}
      <div className="attrib">Sample listings &amp; developments are fictional · © OpenFreeMap © OpenStreetMap</div>
    </div>
  );
}

type Snap = 'peek' | 'half' | 'full';
/** Phone bottom-sheet heights (px). */
const snapHeight = (s: Snap) => s === 'peek' ? 156 : s === 'half' ? Math.round(innerHeight * 0.5) : innerHeight - 150;
function useMedia(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => { const mq = matchMedia(q), f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, [q]);
  return m;
}

/** Drag handle for the phone sheet: follows the finger, then settles on the nearest snap (a flick jumps one further). Tap cycles. */
function SheetGrip({ snap, setSnap, panel }: { snap: Snap; setSnap: (s: Snap) => void; panel: React.RefObject<HTMLElement | null> }) {
  const drag = useRef<{ y: number; h: number; t: number; moved: boolean } | null>(null);
  const order: Snap[] = ['peek', 'half', 'full'];
  return (
    <button className="grip" aria-label={snap === 'full' ? 'Collapse list' : 'Expand list'}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { y: e.clientY, h: snapHeight(snap), t: performance.now(), moved: false }; panel.current?.classList.add('dragging'); }}
      onPointerMove={e => { const d = drag.current; if (!d || !panel.current) return; const dy = d.y - e.clientY; if (Math.abs(dy) > 4) d.moved = true;
        panel.current.style.height = `${Math.min(snapHeight('full'), Math.max(110, d.h + dy))}px`; }}
      onPointerUp={e => {
        const d = drag.current; drag.current = null; const el = panel.current; if (!d || !el) return; el.classList.remove('dragging');
        if (!d.moved) return setSnap(order[(order.indexOf(snap) + 1) % 3]);
        const h = d.h + (d.y - e.clientY), v = (d.y - e.clientY) / Math.max(1, performance.now() - d.t); // px/ms, + = up
        const target = h + v * 220, best = order.reduce((a, b) => Math.abs(snapHeight(b) - target) < Math.abs(snapHeight(a) - target) ? b : a);
        el.style.height = `${snapHeight(best)}px`; setSnap(best);
      }} onPointerCancel={() => { drag.current = null; panel.current?.classList.remove('dragging'); if (panel.current) panel.current.style.height = `${snapHeight(snap)}px`; }}>
      <i />
    </button>);
}

function DockBtn(p: { on: boolean; mode?: CatMode; onClick: () => void; label: string; tip?: string; color: string; Icon: LucideIcon }) {
  return (
    <button className={`dock-btn ${p.on ? 'on' : ''} ${p.mode ? `m-${p.mode}` : ''}`} style={{ ['--c' as string]: p.color }} onClick={p.onClick} aria-pressed={p.on} aria-label={p.tip ?? p.label} data-tip={p.tip ?? p.label}>
      <span className="dock-ico"><p.Icon size={18} strokeWidth={2.1} /></span>
      <span className="dock-label">{p.label}{p.mode && p.mode !== 'off' && <em>{p.mode === 'nearby' ? 'Near' : 'All'}</em>}</span>
    </button>);
}

function Nearby({ at, amen }: { at: LngLat; amen: Amenities | null }) {
  if (!amen) return null;
  return (
    <section className="nearby"><h3><Footprints size={13} /> Nearest, approx. walk</h3>
      {CATS.map(({ key, label, Icon }) => { const n = nearest(at, amen[key]); return n && (
        <div key={key} className="nrow"><span className="ico" style={{ color: COLORS[key] }}><Icon size={15} /></span>
          <span className="row-main"><b>{n.amenity.name}</b><small>{label}</small></span><span className="mins">{n.minutes}<small>min</small></span></div>); })}
    </section>);
}

function DetailSheet(p: { sel: NonNullable<Selection>; close: () => void; bById: Map<string, Building>; byId: Map<string, Listing>; devs: Development[]; amen: Amenities | null; store: BuildingStore; anchor: LngLat | null; onListing: (l: Listing) => void; onBuilding: (id: string) => void }) {
  const { sel } = p;
  let eyebrow = '', title: React.ReactNode = null, body: React.ReactNode = null;
  if (sel.kind === 'listing') {
    const l = p.byId.get(sel.id); if (!l) return null;
    eyebrow = `${l.type} · ${l.neighborhood}`; title = l.address;
    body = <>
      <div className="hero-price">{fmtPrice(l.price)}<span className={`status s-${l.status.replace(' ', '')}`}>{l.status}</span></div>
      <div className="specs">
        <div><BedDouble size={16} /><b>{l.beds}</b><small>Beds</small></div><div><Bath size={16} /><b>{l.baths}</b><small>Baths</small></div>
        <div><Ruler size={16} /><b>{l.sqft.toLocaleString()}</b><small>ft²</small></div><div><span className="cur">$</span><b>{Math.round(ppsf(l)).toLocaleString()}</b><small>per ft²</small></div>
      </div>
      <Nearby at={[l.lon, l.lat]} amen={p.amen} />
      <div className="meta">{l.id}{l.buildingId && <> · <button className="link" onClick={() => p.onBuilding(l.buildingId!)}>View building</button></>}</div>
    </>;
  } else if (sel.kind === 'building') {
    const b = p.bById.get(sel.id); const d = p.store[sel.id];
    const ls = (d?.listings ?? []).map(id => p.byId.get(id)!).filter(Boolean);
    eyebrow = b?.kind === 'block' ? 'City block' : b?.kind === 'landmark' ? 'Landmark' : 'Building'; title = b?.name ?? (ls[0]?.address.split(',')[0] || 'Building');
    body = <>
      {b && <div className="specs three">
        <div><b>~{Math.round(b.height)}</b><small>m tall</small></div><div><b>~{Math.max(1, Math.round(b.height / 3.3))}</b><small>floors</small></div>
        <div><b>{b.kind === 'block' ? b.buildingIds?.length : ls.length}</b><small>{b.kind === 'block' ? 'buildings' : 'listings'}</small></div>
      </div>}
      {ls.length > 0 && <section><h3>Listings here</h3>{ls.map(l => (
        <button key={l.id} className="row" onClick={() => p.onListing(l)}><span className={`dot s-${l.status.replace(' ', '')}`} />
          <span className="row-main"><b>{l.address.split(', ').slice(1).join(', ') || l.address}</b><small>{l.beds} bd · {l.sqft.toLocaleString()} ft²</small></span><span className="row-price">{fmtPrice(l.price)}</span></button>))}</section>}
      {b && <Nearby at={b.centroid} amen={p.amen} />}
      <details className="raw"><summary>Developer data</summary>
        <div className="meta">ID <code>{sel.id}</code>{b && <> · {b.centroid[1].toFixed(5)}, {b.centroid[0].toFixed(5)}</>}</div>
        {d ? <pre>{JSON.stringify(d, null, 2)}</pre> : <p className="meta">Nothing attached. Add entries to <code>BuildingStore</code> under this ID.</p>}
      </details>
    </>;
  } else if (sel.kind === 'development') {
    const d = p.devs.find(x => x.id === sel.id); if (!d) return null;
    eyebrow = 'New development · sample'; title = d.name.replace(' (SAMPLE)', '');
    body = <>
      <div className="sub">{d.address}</div>
      <div className="specs three"><div><b>{d.units}</b><small>units</small></div><div><b>{d.floors}</b><small>floors</small></div><div><b>{d.completion}</b><small>est. done</small></div></div>
      <div className="pill-row"><span className="pill">{d.status}</span></div>
      <Nearby at={[d.lon, d.lat]} amen={p.amen} />
    </>;
  } else {
    const a = p.amen?.[sel.category].find(x => x.id === sel.id); if (!a) return null;
    const c = CATS.find(x => x.key === sel.category)!; const m = p.anchor && distanceMeters(p.anchor, [a.lon, a.lat]);
    eyebrow = c.label; title = a.name;
    body = <>
      <div className="sub" style={{ color: COLORS[sel.category] }}><c.Icon size={15} /> {a.kind.replace(/_/g, ' ')}</div>
      {m != null && <div className="specs three"><div><b>{Math.round(m)}</b><small>m away</small></div><div><b>{walkMinutes(m)}</b><small>min walk</small></div></div>}
      <div className="meta">OpenStreetMap · <code>{a.id}</code></div>
    </>;
  }
  return (
    <aside className="sheet glass" aria-label="Details">
      <header><div><small className="eyebrow">{eyebrow}</small><h2>{title}</h2></div>
        <button className="icon-btn" onClick={p.close} aria-label="Close"><X size={18} /></button></header>
      <div className="sheet-body">{body}</div>
    </aside>);
}
