// Left panel: brand + persona, search (homes and any NYC address), tabs Homes · Market · Develop · Tour.
import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { ArrowUpDown, Building2, ChartColumn, Check, Construction, Heart, LayoutList, MapPin, Route, Search, SlidersHorizontal, X } from 'lucide-react';
import type { Diet, Property, PropType } from '../model';
import { PERSONAS, TYPE_LABEL, useApp, valueDelta, type Persona } from '../state';
import { ValueBadge, fmtDate, fmtNum, fmtPpsf, fmtPrice, Skel } from './common';
import { suggest, type GeoHit } from '../lib/geosearch';
import { zonedSchools, schoolScore } from '../lib/schools';
import { DIETS } from '../lib/places';
import { distanceMeters } from '../lib/grid';
import { Market } from './Market';
import { Develop } from './Develop';
import { Tour } from './Tour';

export type Tab = 'homes' | 'market' | 'develop' | 'tour';
export interface Filters {
  status: 'all' | 'forsale' | 'sold'; types: PropType[]; min: number | null; max: number | null; months: 3 | 6 | 12;
  minSqft: number | null; needs: boolean; sort: 'newest' | 'price-desc' | 'price-asc' | 'ppsf-asc' | 'value' | 'commute';
}
export const DEFAULT_FILTERS: Filters = { status: 'all', types: [], min: null, max: null, months: 12, minSqft: null, needs: false, sort: 'newest' };
const SHOW = 150;
const money = (v: string) => { const m = v.replace(/[$,\s]/g, '').match(/^(\d+(?:\.\d+)?)([km])?$/i); return m ? +m[1] * ({ k: 1e3, m: 1e6 }[m[2]?.toLowerCase() as 'k' | 'm'] ?? 1) : null; };

type Ranked = ReturnType<typeof rank>;
export function Sidebar({ tab, setTab, persona, setPersona, filters, setFilters, ranked, hood, setHood }: { tab: Tab; setTab: (t: Tab) => void; persona: Persona; setPersona: (p: Persona) => void; filters: Filters; setFilters: (f: (f: Filters) => Filters) => void; ranked: Ranked; hood: string | null; setHood: (h: string | null) => void }) {
  const { data } = useApp();
  useEffect(() => { const h = (e: Event) => { setHood((e as CustomEvent).detail); setTab('homes'); }; addEventListener('skyline:hood', h); return () => removeEventListener('skyline:hood', h); }, [setHood, setTab]);
  return (
    <aside className="panel" aria-label="Homes, market and tools">
      <header className="brand">
        <span className="logo" aria-hidden><Building2 size={18} strokeWidth={2.2} /></span>
        <div><b>Skyline</b><small>Manhattan · {fmtNum(data.sales.length)} sales · {data.devs.length} projects</small></div>
      </header>
      <div className="persona" role="radiogroup" aria-label="View as">
        {PERSONAS.map(p => <button key={p.key} role="radio" aria-checked={persona === p.key} className={persona === p.key ? 'on' : ''} title={p.hint} onClick={() => setPersona(p.key)}>{p.label}</button>)}
      </div>
      <Omnibox setTab={setTab} />
      <div className="tabs" role="tablist">
        {([['homes', 'Homes', LayoutList], ['market', 'Market', ChartColumn], ['develop', 'Develop', Construction], ['tour', 'Tour', Route]] as const).map(([k, l, I]) =>
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><I size={15} />{l}{k === 'tour' && <TourCount />}</button>)}
      </div>
      <div className="tab-body" key={tab}>
        {tab === 'homes' ? <Homes filters={filters} setFilters={setFilters} ranked={ranked} hood={hood} setHood={setHood} /> : tab === 'market' ? <Market /> : tab === 'develop' ? <Develop /> : <Tour />}
      </div>
      <footer className="panel-foot">
        {data.loading.size ? <span><i className="spinner" />Loading {[...data.loading].join(', ')}…</span>
          : <span>Sales through {fmtDate(data.sales.reduce((m, s) => (s.date ?? '') > m ? s.date! : m, ''))} · NYC Open Data, MTA, OSM</span>}
      </footer>
    </aside>);
}
function TourCount() { const { profile } = useApp(); return profile.shortlist.length ? <span className="count">{profile.shortlist.length}</span> : null; }

/** One box: filters homes by address/neighbourhood and offers any NYC address (city geocoder) to analyse. */
function Omnibox({ setTab }: { setTab: (t: Tab) => void }) {
  const { data, select } = useApp(); const [q, setQ] = useState(''); const [hits, setHits] = useState<GeoHit[]>([]); const [open, setOpen] = useState(false); const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { const c = new AbortController(); const t = setTimeout(() => suggest(q, c.signal).then(setHits).catch(() => {}), 200); return () => { clearTimeout(t); c.abort(); }; }, [q]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if ((e.key === '/' && document.activeElement?.tagName !== 'INPUT') || (e.key === 'k' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); ref.current?.focus(); } }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  const ql = q.trim().toLowerCase();
  const homes = ql.length >= 2 ? data.homes.filter(h => `${h.address} ${h.unit ?? ''} ${h.neighborhood}`.toLowerCase().includes(ql)).slice(0, 5) : [];
  const hoods = ql.length >= 2 ? [...new Set(data.homes.map(h => h.neighborhood))].filter(n => n.toLowerCase().includes(ql)).slice(0, 3) : [];
  const go = (h: GeoHit) => { select({ kind: 'site', lon: h.lon, lat: h.lat, label: h.label.split(',')[0], bbl: h.bbl }, true); setOpen(false); setQ(''); };
  return (
    <div className="omni" onBlur={e => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <label className="search"><Search size={16} />
        <input ref={ref} value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Address, building or neighborhood" aria-label="Search" aria-expanded={open}
          onKeyDown={e => { if (e.key === 'Enter' && hits[0]) go(hits[0]); if (e.key === 'Escape') { setOpen(false); ref.current?.blur(); } }} />
        {q ? <button className="icon-btn sm" onClick={() => setQ('')} aria-label="Clear"><X size={14} /></button> : <kbd>/</kbd>}
      </label>
      {open && (homes.length > 0 || hits.length > 0 || hoods.length > 0) && <ul className="suggest" role="listbox">
        {hoods.map(n => <li key={n}><button onClick={() => { setTab('homes'); window.dispatchEvent(new CustomEvent('skyline:hood', { detail: n })); setOpen(false); setQ(''); }}><LayoutList size={14} /><span>{n}<small>Show homes in this neighborhood</small></span></button></li>)}
        {homes.map(h => <li key={h.id}><button onClick={() => { select({ kind: 'home', id: h.id }, true); setOpen(false); setQ(''); }}><Building2 size={14} /><span>{h.address}{h.unit ? ` #${h.unit}` : ''}<small>{fmtPrice(h.price)} · {h.source === 'listing' ? h.status : `sold ${fmtDate(h.date)}`}</small></span></button></li>)}
        {hits.map(h => <li key={h.label}><button onClick={() => go(h)}><MapPin size={14} /><span>{h.label}<small>Analyze this address</small></span></button></li>)}
      </ul>}
    </div>);
}

/** Homes tab: filters, client needs, sorted results. */
function Homes({ filters: f, setFilters, ranked, hood, setHood }: { filters: Filters; setFilters: (f: (f: Filters) => Filters) => void; ranked: Ranked; hood: string | null; setHood: (h: string | null) => void }) {
  const { data, profile, setProfile, select, sel, hoverId, setHover } = useApp();
  const [more, setMore] = useState(false);
  const { list, total, derived } = useDeferredValue(ranked);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters(x => ({ ...x, [k]: v }));
  const hasNeeds = profile.diets.length > 0 || profile.destinations.length > 0 || profile.minSchool != null;
  return (
    <div className="homes">
      <div className="filters">
        <div className="seg3" role="radiogroup" aria-label="Status">{([['all', 'All'], ['forsale', 'For sale'], ['sold', 'Sold']] as const).map(([k, l]) =>
          <button key={k} role="radio" aria-checked={f.status === k} className={f.status === k ? 'on' : ''} onClick={() => set('status', k)}>{l}{k === 'forsale' && <small>{data.listings.length}</small>}</button>)}</div>
        <div className="chips">{(['condo', 'coop', 'townhouse', 'multifamily'] as PropType[]).map(t => <button key={t} className={`chip ${f.types.includes(t) ? 'on' : ''}`} aria-pressed={f.types.includes(t)} onClick={() => set('types', f.types.includes(t) ? f.types.filter(x => x !== t) : [...f.types, t])}>{TYPE_LABEL[t]}</button>)}
          <button className={`chip icon ${more ? 'on' : ''}`} onClick={() => setMore(v => !v)} aria-expanded={more} aria-label="More filters"><SlidersHorizontal size={14} /></button></div>
        {more && <div className="more">
          <label>Price<span className="range"><input inputMode="decimal" placeholder="Min" defaultValue={f.min ?? ''} onBlur={e => set('min', money(e.target.value))} /><i>–</i><input inputMode="decimal" placeholder="Max" defaultValue={f.max ?? ''} onBlur={e => set('max', money(e.target.value))} /></span></label>
          <label>Min size<input inputMode="numeric" placeholder="ft²" defaultValue={f.minSqft ?? ''} onBlur={e => set('minSqft', money(e.target.value))} /></label>
          <label>Sold within<select value={f.months} onChange={e => set('months', +e.target.value as Filters['months'])}><option value={3}>3 months</option><option value={6}>6 months</option><option value={12}>12 months</option></select></label>
        </div>}
        <ClientNeeds />
        {hasNeeds && <label className="switch block"><input type="checkbox" checked={f.needs} onChange={e => set('needs', e.target.checked)} /> Only homes that meet {profile.client || 'the client'}'s needs</label>}
      </div>
      <div className="results-head">
        <span>{hood && <button className="chip on" onClick={() => setHood(null)}>{hood} <X size={12} /></button>}{fmtNum(total)} homes{total > SHOW ? ` · top ${SHOW}` : ''}</span>
        <label className="sort"><ArrowUpDown size={14} /><select value={f.sort} onChange={e => set('sort', e.target.value as Filters['sort'])} aria-label="Sort">
          <option value="newest">Newest</option><option value="price-desc">Price: high to low</option><option value="price-asc">Price: low to high</option><option value="ppsf-asc">$/ft²: low to high</option><option value="value">Best value vs area</option>{profile.destinations[0] && <option value="commute">Shortest commute</option>}
        </select></label>
      </div>
      <div className="list" onMouseLeave={() => setHover(null)}>
        {data.loading.has('sales') && !data.sales.length && Array.from({ length: 7 }, (_, i) => <div key={i} className="row skel-row"><Skel w="70%" /><Skel w="30%" /></div>)}
        {!data.loading.has('sales') && !list.length && <div className="empty">No homes match.<button className="link" onClick={() => { setFilters(() => DEFAULT_FILTERS); setHood(null); }}>Reset filters</button></div>}
        {list.map((h, i) => { const dv = derived.get(h.id); const on = profile.shortlist.includes(h.id); return (
          <div key={h.id} style={{ ['--i' as string]: Math.min(i, 20) }} className={`row ${sel?.kind === 'home' && sel.id === h.id ? 'sel' : ''} ${hoverId === h.id ? 'hover' : ''} ${h.source}`} onMouseEnter={() => setHover(h.id)}>
            <button className="row-hit" onClick={() => select({ kind: 'home', id: h.id }, true)} aria-label={`${h.address} ${h.unit ?? ''}, ${fmtPrice(h.price)}`} />
            <span className={`dot ${h.source === 'listing' ? 'listing' : dv?.v ?? ''}`} />
            <span className="row-main"><b>{h.address}{h.unit && <em>#{h.unit}</em>}</b>
              <small>{h.neighborhood} · {TYPE_LABEL[h.type]}{h.sqft ? ` · ${fmtNum(h.sqft)} ft²` : ''}{h.beds != null ? ` · ${h.beds === 0 ? 'Studio' : `${h.beds} bd`}` : ''} · {h.source === 'listing' ? h.status : `Sold ${fmtDate(h.date)}`}</small>
              {(dv?.commute != null || dv?.school != null || dv?.diet) && <span className="row-tags">
                {dv.commute != null && <span className="tag t-commute" title="Typical door-to-door subway + walk time">~{dv.commute} min to {profile.destinations[0].name}</span>}
                {dv.school != null && <span className="tag t-school">Zoned school {Math.round(dv.school)}%</span>}
                {dv.diet && <span className="tag t-diet">{dv.diet}</span>}</span>}
            </span>
            <span className="row-price">{fmtPrice(h.price)}{h.ppsf ? <small>{fmtPpsf(h.ppsf)}/ft²</small> : null}<ValueBadge delta={dv?.delta} small /></span>
            <button className={`icon-btn sm heart ${on ? 'on' : ''}`} aria-pressed={on} aria-label={on ? 'Remove from shortlist' : 'Add to shortlist'} onClick={() => setProfile(p => ({ ...p, shortlist: on ? p.shortlist.filter(x => x !== h.id) : [...p.shortlist, h.id] }))}><Heart size={15} fill={on ? 'currentColor' : 'none'} /></button>
          </div>); })}
      </div>
    </div>);
}

/** The client's needs, edited inline: drives badges, the "meets needs" filter and commute sorting. */
function ClientNeeds() {
  const { profile, setProfile } = useApp(); const [open, setOpen] = useState(false);
  const summary = [profile.diets.map(d => DIETS.find(x => x.key === d)?.label).join(', '), profile.destinations.map(d => d.name).join(', '), profile.minSchool != null ? `school ≥ ${profile.minSchool}%` : ''].filter(Boolean).join(' · ');
  return (
    <div className={`needs ${open ? 'open' : ''}`}>
      <button className="needs-head" onClick={() => setOpen(v => !v)} aria-expanded={open}><Heart size={14} /><span><b>{profile.client || 'Client needs'}</b><small>{summary || 'Diet, places to reach, schools'}</small></span></button>
      {open && <div className="needs-body">
        <label>Client name<input value={profile.client} onChange={e => setProfile(p => ({ ...p, client: e.target.value }))} placeholder="e.g. The Cohens" /></label>
        <div><small>Dietary needs</small><div className="chips wrap">{DIETS.map(d => { const on = profile.diets.includes(d.key); return <button key={d.key} className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setProfile(p => ({ ...p, diets: on ? p.diets.filter(x => x !== d.key) : [...p.diets, d.key as Diet] }))}>{on && <Check size={13} />}{d.label}</button>; })}</div></div>
        <div><small>Places to reach {profile.destinations.length ? `(${profile.destinations.map(d => d.name).join(', ')})` : '(add them from any home: Commute section)'}</small>
          <label className="inline">Max minutes to {profile.destinations[0]?.name ?? 'first place'}<input type="number" min={5} max={90} step={5} value={profile.maxCommute ?? ''} onChange={e => setProfile(p => ({ ...p, maxCommute: e.target.value ? +e.target.value : undefined }))} /></label></div>
        <label className="inline">Zoned elementary at least<input type="number" min={0} max={100} step={5} value={profile.minSchool ?? ''} placeholder="%" onChange={e => setProfile(p => ({ ...p, minSchool: e.target.value ? +e.target.value : undefined }))} />% proficient</label>
      </div>}
    </div>);
}

interface Derived { delta?: number; v?: 'good' | 'bad' | 'even'; commute?: number; school?: number; diet?: string }
/** Filter + sort homes, computing per-home extras (value, commute, school, diet) only where needed. */
export type Needs = Pick<ReturnType<typeof useApp>['profile'], 'diets' | 'destinations' | 'minSchool' | 'maxCommute'>;
export function rank(data: ReturnType<typeof useApp>['data'], f: Filters, profile: Needs, hood: string | null) {
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - f.months - 2); // DOF lags ~2 months
  const since = cutoff.toISOString().slice(0, 10);
  let xs = data.homes.filter(h =>
    (f.status === 'all' || (f.status === 'sold' ? h.source === 'sale' || h.status === 'Sold' : h.source === 'listing' && h.status !== 'Sold')) &&
    (!f.types.length || f.types.includes(h.type)) && (f.min == null || h.price >= f.min) && (f.max == null || h.price <= f.max) &&
    (f.minSqft == null || (h.sqft ?? 0) >= f.minSqft) && (h.source === 'listing' || (h.date ?? '') >= since) && (!hood || h.neighborhood === hood));
  const derived = new Map<string, Derived>();
  const reach = profile.destinations[0] && data.router ? data.router.reach([profile.destinations[0].lon, profile.destinations[0].lat], 90 * 60) : null;
  const commuteOf = (h: Property) => { if (!reach || !data.router) return undefined; let best = Infinity; for (const { s, m } of data.router.near([h.lon, h.lat], 1300)) { const t = reach.get(s.id); if (t != null) best = Math.min(best, t + m / (80 / 60 / 1.25)); } const d0 = profile.destinations[0]; best = Math.min(best, distanceMeters([h.lon, h.lat], [d0.lon, d0.lat]) / (80 / 60 / 1.25)); return isFinite(best) ? Math.round(best / 60) : undefined; };
  const needs = f.needs && (profile.diets.length || profile.minSchool != null || (profile.maxCommute && reach));
  const want = needs || f.sort === 'commute' ? xs : null; // compute everything only when filtering/sorting needs it
  const fill = (h: Property) => {
    if (derived.has(h.id)) return derived.get(h.id)!;
    const delta = valueDelta(h, data.medPpsf); const d: Derived = { delta, v: delta == null ? 'even' : delta <= -5 ? 'good' : delta >= 5 ? 'bad' : 'even' };
    if (reach) d.commute = commuteOf(h);
    if (data.schools && (profile.minSchool != null)) { const z = zonedSchools([h.lon, h.lat], data.schools); d.school = z.es ? schoolScore(z.es, 'ES') : undefined; }
    if (profile.diets.length && data.places) { const mins = profile.diets.map(dt => data.places!.dietMinutes([h.lon, h.lat], dt, 10)); if (mins.every(m => m != null)) d.diet = `${profile.diets.map(dt => DIETS.find(x => x.key === dt)?.label).join(' + ')} ≤ ${Math.max(...(mins as number[]))} min`; }
    derived.set(h.id, d); return d;
  };
  if (want) { for (const h of want) fill(h); }
  if (needs) xs = xs.filter(h => { const d = derived.get(h.id)!; return (!profile.diets.length || !!d.diet) && (profile.minSchool == null || (d.school ?? -1) >= profile.minSchool) && (!profile.maxCommute || !reach || (d.commute ?? 999) <= profile.maxCommute); });
  const by: Record<Filters['sort'], (a: Property, b: Property) => number> = {
    newest: (a, b) => +(b.source === 'listing') - +(a.source === 'listing') || (b.date ?? '').localeCompare(a.date ?? ''),
    'price-desc': (a, b) => b.price - a.price, 'price-asc': (a, b) => a.price - b.price,
    'ppsf-asc': (a, b) => (a.ppsf ?? 1e9) - (b.ppsf ?? 1e9),
    value: (a, b) => (valueDelta(a, data.medPpsf) ?? 999) - (valueDelta(b, data.medPpsf) ?? 999),
    commute: (a, b) => (derived.get(a.id)?.commute ?? 999) - (derived.get(b.id)?.commute ?? 999),
  };
  xs = [...xs].sort(by[f.sort]);
  const list = xs.slice(0, SHOW); for (const h of list) fill(h);
  return { list, total: xs.length, derived, all: xs };
}
