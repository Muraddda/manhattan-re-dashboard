// Skyline: a Manhattan home-search, valuation and showing tool for independent agents.
// App = data loading, global state, and keeping the map in sync with it. UI lives in src/ui, the map in src/map/scene.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Home, Minus, Navigation2, Plus, X } from 'lucide-react';
import type { LngLat, Property } from './model';
import { AppCtx, valueDelta, type Ctx, type Data, type Persona, type Sel, type SoftSite, type TrendRow } from './state';
import { Scene, HOME, type Pick } from './map/scene';
import { Sidebar, DEFAULT_FILTERS, rank, type Filters, type Tab } from './ui/Sidebar';
import { Sheet } from './ui/Sheet';
import { Dock, type Layers, DEFAULT_LAYERS } from './ui/Dock';
import { dataset, getJson } from './lib/load';
import { toProperties, loadLots, titleCase, type LotsFile, type LotsIndex, type RawSale } from './lib/sales';
import { toDevelopments, type DevRow } from './lib/devs';
import { toRestaurants, type RestaurantRow } from './lib/restaurants';
import { PlaceIndex, type Michelin } from './lib/places';
import { Router, type Transit } from './lib/transit';
import { Grid, walkRadius } from './lib/grid';
import { percentile } from './lib/value';
import { EMPTY, fc, point, pointInPolygon } from './lib/geo';
import { zonedSchools } from './lib/schools';
import { loadListings } from './lib/listings';
import { loadProfile, saveProfile, type Profile } from './lib/profile';
import type { Place, SchoolsData } from './model';

const Q = new URLSearchParams(location.search);
const STATIC = Q.has('static');
const REDUCED = STATIC || matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Render budget: weak or software GPUs ('lite') draw at 1x with no MSAA. `?lite` / `?hq` force a tier. */
const TIER: 'lite' | 'hq' = Q.has('lite') ? 'lite' : Q.has('hq') ? 'hq' : detectTier();
function detectTier(): 'lite' | 'hq' {
  const gl = document.createElement('canvas').getContext('webgl2'); if (!gl) return 'lite';
  const ext = gl.getExtension('WEBGL_debug_renderer_info'), renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /swiftshader|llvmpipe|softpipe|software|basic render|mali-[4t]|adreno \(tm\) [345]|powervr/i.test(renderer) || (navigator.hardwareConcurrency ?? 8) <= 4 ? 'lite' : 'hq';
}
const DPR = Math.min(devicePixelRatio, TIER === 'lite' ? 1 : 2);
const GL = { antialias: TIER === 'hq', preserveDrawingBuffer: STATIC };
const SHEET_W = 440, PANEL_W = 420;

const EMPTY_DATA: Omit<Data, 'unitLots'> = { sales: [], listings: loadListings(), devs: [], soft: [], trends: [], michelin: [], homes: [], byId: new Map(), medPpsf: new Map(), updated: {}, loading: new Set(['sales', 'schools', 'transit', 'places']) };

export default function App() {
  const mapDiv = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [raw, setRaw] = useState<Omit<Data, 'homes' | 'byId' | 'homeGrid' | 'medPpsf' | 'unitLots' | 'salesFrom'>>(EMPTY_DATA);
  const [lots, setLots] = useState<{ index: LotsIndex; grid: Grid<{ lon: number; lat: number; bbl: string; address: string }> } | null>(null);
  const [persona, setPersonaS] = useState<Persona>(() => (localStorage.getItem('skyline.persona') as Persona) || 'buyer');
  const [tab, setTab] = useState<Tab>('homes');
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [profile, setProfileS] = useState<Profile>(loadProfile);
  const [sel, setSel] = useState<Sel>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [tripTo, setTripTo] = useState<LngLat | null>(null);
  const [iso, setIso] = useState(false);
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS[persona]);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const compass = useRef<SVGSVGElement>(null);
  const [is3D, setIs3D] = useState(true);
  const phone = matchMedia('(max-width: 820px)').matches;

  const toast = useCallback((msg: string) => { const id = Date.now(); setToasts(t => [...t, { id, msg }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2600); }, []);
  const setProfile = useCallback((f: (p: Profile) => Profile) => setProfileS(p => { const n = f(p); saveProfile(n); return n; }), []);
  const setPersona = (p: Persona) => { setPersonaS(p); localStorage.setItem('skyline.persona', p); setLayers(DEFAULT_LAYERS[p]); setTab(p === 'developer' ? 'develop' : p === 'agent' ? 'tour' : p === 'seller' ? 'market' : 'homes'); };

  // ---- data: each source arrives on its own; the UI fills in as it lands
  useEffect(() => {
    const done = (k: string, patch: Partial<Data>, updated?: string | null) => setRaw(d => { const loading = new Set(d.loading); loading.delete(k); return { ...d, ...patch, loading, updated: { ...d.updated, [k]: updated ?? null } }; });
    const fail = (k: string) => (e: unknown) => { console.error(`Failed to load ${k}`, e); done(k, {}); };
    Promise.all([dataset<RawSale[]>('sales'), getJson<LotsFile>('/data/lots.json')]).then(([s, l]) => {
      const index = loadLots(l);
      const grid = new Grid(l.lots.map(([bbl, , , lon, lat, address]) => ({ bbl, lon, lat, address })), 0.002);
      setLots({ index, grid });
      done('sales', { sales: toProperties(s.data, index) }, s.updated);
    }).catch(fail('sales'));
    dataset<DevRow[]>('devs').then(r => done('devs', { devs: toDevelopments(r.data) }, r.updated)).catch(fail('devs'));
    dataset<Record<string, string>[]>('softsites').then(r => done('softsites', { soft: r.data.map(toSoft).filter((x): x is SoftSite => !!x) }, r.updated)).catch(fail('softsites'));
    dataset<Record<string, string>[]>('trends').then(r => done('trends', { trends: r.data.filter(x => /^MN/.test(x.nta ?? '')).map(toTrend) }, r.updated)).catch(fail('trends'));
    getJson<SchoolsData>('/data/schools.json').then(s => done('schools', { schools: s })).catch(fail('schools'));
    getJson<Transit>('/data/transit.json').then(t => done('transit', { router: new Router(t) })).catch(fail('transit'));
    Promise.all([getJson<{ places: Place[] }>('/data/places.json'), dataset<RestaurantRow[]>('restaurants').catch(() => ({ data: [] as RestaurantRow[], updated: null })), getJson<{ restaurants: Michelin[] }>('/data/dining.json').catch(() => ({ restaurants: [] }))])
      .then(([p, r, m]) => done('places', { places: new PlaceIndex(p.places, toRestaurants(r.data), m.restaurants), michelin: m.restaurants }, r.updated)).catch(fail('places'));
  }, []);
  const data: Data = useMemo(() => {
    const saleGrid = new Grid(raw.sales);
    const listings = raw.listings.map(l => { const near = saleGrid.nearest([l.lon, l.lat], undefined, 800); return near ? { ...l, neighborhood: near.item.neighborhood } : l; });
    const homes = [...listings, ...raw.sales], byId = new Map(homes.map(h => [h.id, h]));
    const groups = new Map<string, number[]>();
    for (const s of raw.sales) if (s.ppsf) { const k = `${s.neighborhood}|${s.type}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(s.ppsf); }
    const medPpsf = new Map([...groups].filter(([, v]) => v.length >= 5).map(([k, v]) => [k, percentile(v, 50)]));
    const unitLots = (bbl: string) => { const out: number[] = []; if (lots) for (const [u, v] of lots.index.units) if (v.billing === bbl) out.push(+u.slice(6)); return out; };
    const salesFrom = raw.sales.reduce((m, s) => !m || (s.date && s.date < m) ? s.date ?? m : m, '' as string) || undefined;
    return { ...raw, listings, homes, byId, medPpsf, homeGrid: new Grid(homes), unitLots, salesFrom };
  }, [raw, lots]);
  const setListings = useCallback((ls: Property[]) => setRaw(d => ({ ...d, listings: ls })), []);

  // ---- map
  useEffect(() => {
    const s = new Scene(mapDiv.current!, {
      pick: p => pickRef.current(p), hover: id => setHoverId(id),
      moved: (b, p) => { if (compass.current) compass.current.style.transform = `rotate(${-b}deg)`; setIs3D(p > 10); },
    }, { pixelRatio: DPR, gl: GL, start: REDUCED ? {} : { zoom: 11.6, pitch: 20, bearing: -12 } });
    s.map.setPadding(phone ? { top: 120, bottom: innerHeight * 0.5, left: 0, right: 0 } : { top: 0, bottom: 0, left: PANEL_W, right: 0 }); // centre Manhattan in the visible part
    s.whenReady().then(() => { setScene(s); if (!REDUCED) s.map.easeTo({ ...HOME, duration: 2400, easing: x => 1 - (1 - x) ** 3 }); });
    return () => s.map.remove();
  }, []);

  // ---- selection
  const anchor = useMemo<LngLat | null>(() => {
    if (!sel) return null;
    if (sel.kind === 'home') { const h = data.byId.get(sel.id); return h ? [h.lon, h.lat] : null; }
    if (sel.kind === 'site') return [sel.lon, sel.lat];
    if (sel.kind === 'dev') { const d = data.devs.find(x => x.id === sel.id); return d ? [d.lon, d.lat] : null; }
    if (sel.kind === 'soft') { const s = data.soft.find(x => x.bbl === sel.bbl); return s ? [s.lon, s.lat] : null; }
    if (sel.kind === 'place') { const p = data.places?.grid.items.find(x => x.id === sel.id); return p ? [p.lon, p.lat] : null; }
    if (sel.kind === 'school') { const s = data.schools?.schools.find(x => x.dbn === sel.dbn); return s ? [s.lon, s.lat] : null; }
    if (sel.kind === 'station') { const s = data.router?.byId.get(sel.id); return s ? [s.lon, s.lat] : null; }
    return null;
  }, [sel, data]);
  const padding = () => phone ? { top: 120, bottom: innerHeight * 0.55, left: 0, right: 0 } : { top: 60, bottom: 110, left: PANEL_W + 24, right: SHEET_W + 24 };
  const select = useCallback((s: Sel, fly = false) => {
    setSel(s); setTripTo(null);
    if (fly && s && scene) {
      const p: LngLat | null = s.kind === 'home' ? (h => h ? [h.lon, h.lat] as LngLat : null)(data.byId.get(s.id)) : s.kind === 'site' ? [s.lon, s.lat]
        : s.kind === 'dev' ? (d => d ? [d.lon, d.lat] as LngLat : null)(data.devs.find(x => x.id === s.id)) : s.kind === 'soft' ? (d => d ? [d.lon, d.lat] as LngLat : null)(data.soft.find(x => x.bbl === s.bbl))
        : s.kind === 'school' ? (d => d ? [d.lon, d.lat] as LngLat : null)(data.schools?.schools.find(x => x.dbn === s.dbn)) : null;
      if (p) scene.fly(p, padding(), { zoom: s.kind === 'school' ? 15 : 16.2, pitch: is3D ? 55 : 0 });
    }
  }, [scene, data, is3D]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickRef = useRef<(p: Pick) => void>(() => {});
  pickRef.current = p => {
    if (p.kind === 'none') return setSel(null);
    if (p.kind === 'home') return select({ kind: 'home', id: p.id });
    if (p.kind === 'building') {
      // the tax lot inside this footprint (or nearest) gives a stable identity: BBL + address
      const inside = lots?.grid.within([p.lon, p.lat], 60).find(x => p.ring.length && pointInPolygon([x.item.lon, x.item.lat], p.ring)) ?? lots?.grid.within([p.lon, p.lat], 40)[0];
      const listing = data.listings.find(l => p.ring.length && pointInPolygon([l.lon, l.lat], p.ring));
      if (listing) return select({ kind: 'home', id: listing.id });
      return select({ kind: 'site', lon: p.lon, lat: p.lat, label: inside ? titleCase(inside.item.address) : 'Building', bbl: inside?.item.bbl, ring: p.ring, height: p.height });
    }
    select(p as Sel);
  };
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && document.activeElement?.tagName !== 'INPUT') setSel(null); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);

  // ---- ranked homes (shared by the list and the map)
  const [hood, setHood] = useState<string | null>(null);
  const needs = useMemo(() => ({ diets: profile.diets, destinations: profile.destinations, minSchool: profile.minSchool, maxCommute: profile.maxCommute }), [profile.diets, profile.destinations, profile.minSchool, profile.maxCommute]);
  const ranked = useMemo(() => rank(data, filters, needs, hood), [data, filters, needs, hood]);

  // ---- keep the map in sync
  useEffect(() => { // homes: filtered set, coloured by value vs the area
    if (!scene) return;
    scene.setData('homes', fc(ranked.all.map(h => { const delta = valueDelta(h, data.medPpsf); return point(h.lon, h.lat, { id: h.id, src: h.source, v: delta == null ? 'even' : delta <= -5 ? 'good' : delta >= 5 ? 'bad' : 'even', dim: 0 }); })));
  }, [scene, ranked, data.medPpsf]);
  useEffect(() => { scene?.show('homes', layers.homes); }, [scene, layers.homes]);
  useEffect(() => { if (scene && data.router) scene.drawSubway(data.router); }, [scene, data.router]);
  useEffect(() => { scene?.show(['subway', 'stations'], layers.subway || !!tripTo); }, [scene, layers.subway, tripTo]);
  useEffect(() => { if (scene) { scene.setData('devs', fc(data.devs.map(d => point(d.lon, d.lat, { id: d.id, units: d.units })))); scene.show('devs', layers.devs); } }, [scene, data.devs, layers.devs]);
  useEffect(() => { if (scene) { scene.setData('soft', fc(data.soft.map(s => point(s.lon, s.lat, { bbl: s.bbl, air: s.air })))); scene.show('soft', layers.soft); } }, [scene, data.soft, layers.soft]);
  useEffect(() => { // schools: all pins + zone lines when the layer is on; the selected home's zone always
    if (!scene || !data.schools) return;
    const z = anchor ? zonedSchools(anchor, data.schools) : null;
    scene.setData('schools', layers.schools || z ? fc(data.schools.schools.filter(s => layers.schools || s.dbn === z?.es?.dbn || s.dbn === z?.ms?.dbn).map(s => point(s.lon, s.lat, { dbn: s.dbn, zoned: s.dbn === z?.es?.dbn ? 1 : 0 }))) : EMPTY);
    scene.setData('zones', layers.schools ? data.schools.esZones : EMPTY);
    scene.setData('zone-sel', z?.esZone ? fc(data.schools.esZones.features.filter(f => f.properties?.dbn === z.esZone!.dbn)) : EMPTY);
  }, [scene, data.schools, anchor, layers.schools]);
  useEffect(() => { // places around the selection (or the client's diets everywhere when the food layer is on and nothing is selected)
    if (!scene || !data.places) return;
    const P = data.places, feats = [];
    if (anchor && layers.food) {
      for (const { item } of P.grid.within(anchor, walkRadius(12), x => x.cat === 'grocery' || x.cat === 'park' || (x.cat === 'dining' && (!profile.diets.length ? false : profile.diets.some(d => x.diets?.includes(d))))))
        feats.push(point(item.lon, item.lat, { id: item.id, icon: item.cat === 'grocery' ? 'grocery' : item.cat === 'park' ? 'parks' : 'dining', rank: item.cat === 'park' ? 2 : 1 }));
      for (const { item } of P.starsNear(anchor, 20)) feats.push(point(item.lon, item.lat, { id: `m:${item.name}`, icon: 'michelin', rank: 0 }));
    } else if (layers.food && profile.diets.length) {
      for (const x of P.grid.items) if ((x.cat === 'grocery' || x.cat === 'dining') && profile.diets.some(d => x.diets?.includes(d))) feats.push(point(x.lon, x.lat, { id: x.id, icon: x.cat === 'grocery' ? 'grocery' : 'dining', rank: 1 }));
    }
    scene.setData('places', fc(feats));
  }, [scene, data.places, anchor, layers.food, profile.diets]);
  useEffect(() => { // selection on the map: ring, building highlight, home dot
    if (!scene) return;
    scene.ring(anchor && sel?.kind !== 'station' && sel?.kind !== 'place' ? anchor : null, walkRadius(10));
    scene.selectBuilding(sel?.kind === 'site' ? sel.ring ?? null : null, sel?.kind === 'site' ? sel.height : 0);
    scene.hover(sel?.kind === 'home' ? sel.id : hoverId);
  }, [scene, sel, anchor, hoverId]);
  useEffect(() => { if (scene) scene.drawTrip(anchor && tripTo && data.router ? data.router.trip(anchor, tripTo) : null, data.router); }, [scene, anchor, tripTo, data.router]);
  useEffect(() => { if (scene) scene.drawIso(iso && anchor ? anchor : null, data.router); }, [scene, iso, anchor, data.router]);

  const ctx: Ctx = { data, persona, profile, setProfile, sel, select, anchor, scene, showTrip: setTripTo, tripTo, iso, setIso, hoverId, setHover: id => { setHoverId(id); }, toast, setListings };
  const resetView = () => { setSel(null); scene?.map.flyTo({ ...HOME, padding: { top: 0, bottom: 0, left: phone ? 0 : PANEL_W, right: 0 }, duration: 1400 }); };
  return (
    <AppCtx.Provider value={ctx}>
      <div className={`app persona-${persona} ${sel ? 'has-sel' : ''}`}>
        <div ref={mapDiv} className="map" aria-label="Map of Manhattan" />
        <Sidebar tab={tab} setTab={setTab} persona={persona} setPersona={setPersona} filters={filters} setFilters={setFilters} ranked={ranked} hood={hood} setHood={setHood} />
        <Sheet />
        <Dock layers={layers} setLayers={setLayers} />
        <div className="controls">
          <div className="ctl-group">
            <button className="icon-btn" onClick={() => scene?.map.zoomIn()} aria-label="Zoom in"><Plus size={18} /></button>
            <button className="icon-btn" onClick={() => scene?.map.zoomOut()} aria-label="Zoom out"><Minus size={18} /></button>
          </div>
          <div className="ctl-group">
            <button className="icon-btn" onClick={() => scene?.map.easeTo({ bearing: 0, duration: 600 })} aria-label="Point north"><Navigation2 ref={compass} size={17} className="compass" style={{ transform: `rotate(${-HOME.bearing}deg)` }} /></button>
            <button className={`icon-btn ${is3D ? 'active' : ''}`} onClick={() => scene?.map.easeTo({ pitch: is3D ? 0 : 55, duration: 700 })} aria-label={is3D ? 'Flat map' : '3D map'}><Box size={17} /></button>
            <button className="icon-btn" onClick={resetView} aria-label="Show all of Manhattan"><Home size={17} /></button>
          </div>
        </div>
        <div className="toasts" role="status" aria-live="polite">{toasts.map(t => <div key={t.id} className="toast">{t.msg}<button className="icon-btn sm" onClick={() => setToasts(x => x.filter(y => y.id !== t.id))} aria-label="Dismiss"><X size={13} /></button></div>)}</div>
        <div className="attrib">© OpenFreeMap © OpenStreetMap · NYC Open Data · MTA</div>
      </div>
    </AppCtx.Provider>);
}

const PUBLIC_OWNER = /\b(NYC|N Y C|CITY OF NEW YORK|NEW YORK CITY|STATE OF NEW YORK|PEOPLE OF THE STATE|UNITED STATES|USA|MTA|METROPOLITAN TRANSPORTATION|TRANSIT AUTHORITY|PORT AUTHORITY|HOUSING AUTHORITY|DEPARTMENT OF|DEPT OF|BATTERY PARK CITY AUTHORITY|DORMITORY AUTHORITY|DORM AUTH|CONVENTION CENTER)\b/i;
const NOT_SITE = /CONDOMINIUM|\bCONDO\b|HOUSING CORP|HOUSES,? INC|GARDENS,? INC|OWNERS CORP|TENANTS CORP|AMTRAK|NATIONAL RAILROAD|RR PASS|PORT OF AUTHORITY|CONSOLIDATED EDISON|CON ED|VERIZON|AT&T|UNAVAILABLE OWNER/i;
const n = (v?: string) => v == null || v === '' ? NaN : +String(v).replace(/,/g, '');
function toSoft(r: Record<string, string>): SoftSite | null {
  const lon = n(r.longitude), lat = n(r.latitude), lotArea = n(r.lotarea), bldgArea = n(r.bldgarea), maxFar = n(r.residfar);
  if (!isFinite(lon) || !isFinite(lat) || !isFinite(lotArea) || !isFinite(maxFar)) return null;
  // Not realistic sites: public land, rail/utility lots (land use 7), condo and co-op buildings (many owners), superblocks.
  if (PUBLIC_OWNER.test(r.ownername ?? '') || NOT_SITE.test(r.ownername ?? '') || r.landuse === '7' || lotArea > 250000) return null;
  return { bbl: String(Math.round(n(r.bbl))), address: titleCase(r.address ?? ''), lon, lat, zoning: r.zonedist1 ?? '', lotArea, bldgArea: bldgArea || 0, maxFar, builtFar: n(r.builtfar) || 0,
    air: Math.round(maxFar * lotArea - (bldgArea || 0)), yearBuilt: n(r.yearbuilt) || undefined, floors: n(r.numfloors) || undefined, owner: r.ownername, historic: r.histdist || undefined };
}
function toTrend(r: Record<string, string>): TrendRow {
  return { nta: r.nta, year: n(r.year), category: r.building_class_category ?? '', n: n(r.n) || 0, sumPrice: n(r.sum_price) || 0, sumSqft: n(r.sum_sqft) || 0, sumPriceSqft: n(r.sum_price_sqft) || 0 };
}
