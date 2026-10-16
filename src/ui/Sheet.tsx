// Detail sheet for whatever is selected. Homes, buildings and addresses get the full analysis, ordered by persona:
// Overview · Value · Commute · Schools · Food · Area · Building. Smaller sheets for developments, places, schools, stations.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Bath, BedDouble, Building2, Bus, Check, ChevronRight, Copy, ExternalLink, Footprints, GraduationCap, Heart, Landmark, MapPin, Plus, Ruler, Shield, Sparkles, Star, Timer, TrainFront, Trees, Utensils, Volume2, Waves, X } from 'lucide-react';
import type { Diet, LngLat, Property } from '../model';
import { useApp, TYPE_LABEL, valueDelta, type Persona } from '../state';
import { Bullet, Note, RangeBar, Section, Skel, Spark, Stat, ValueBadge, fmtDate, fmtMin, fmtNum, fmtPpsf, fmtPrice, title } from './common';
import { valuate, marketTrend } from '../lib/value';
import { buildingSales, citiBike, environment, femaZone, lotFacts, noise, safety, type LotFacts } from '../lib/area';
import { zonedSchools, nearbySchools, districtSchools, schoolScore, scoreLabel } from '../lib/schools';
import { DIETS, GROCERY_KINDS, cuisineLabel } from '../lib/places';
import { suggest, type GeoHit } from '../lib/geosearch';
import { walkMinutes, distanceMeters } from '../lib/grid';
import type { Destination } from '../lib/profile';

/** Resolve a promise into state; re-runs when `key` changes. */
function useAsync<T>(f: () => Promise<T> | null, key: unknown[]) {
  const [s, setS] = useState<{ v?: T; err?: string; loading: boolean }>({ loading: true });
  useEffect(() => { let live = true; const p = f(); if (!p) { setS({ loading: false }); return; } setS({ loading: true }); p.then(v => live && setS({ v, loading: false }), e => live && setS({ err: String(e.message ?? e), loading: false })); return () => { live = false; }; }, key); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}
const ORDER: Record<Persona, string[]> = {
  buyer: ['overview', 'commute', 'schools', 'food', 'area', 'value', 'building'],
  seller: ['overview', 'value', 'building', 'area', 'schools', 'commute', 'food'],
  developer: ['building', 'value', 'overview', 'area', 'commute', 'schools', 'food'],
  agent: ['overview', 'value', 'commute', 'schools', 'food', 'area', 'building'],
};
const LABEL: Record<string, string> = { overview: 'Overview', value: 'Value', commute: 'Commute', schools: 'Schools', food: 'Food', area: 'Area', building: 'Building' };

export function Sheet() {
  const { sel, select, data, persona, anchor } = useApp();
  const body = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState('overview');
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [sel]);
  const subjectKey = sel ? JSON.stringify(sel) : '';
  const stable = useMemo(() => new Map<string, LngLat>(), []); // one array per selection so memos below hold across re-renders
  if (!sel || !anchor) return null;
  const P = (p: LngLat): LngLat => { const k = `${subjectKey}|${p[0]},${p[1]}`; if (!stable.has(k)) stable.set(k, p); return stable.get(k)!; };
  // header
  let eyebrow = '', head: ReactNode = '', subject: Subject | null = null, extra: ReactNode = null;
  if (sel.kind === 'home') {
    const p = data.byId.get(sel.id); if (!p) return null;
    eyebrow = `${p.source === 'listing' ? (p.status === 'Active' ? 'For sale' : p.status) : `Sold ${fmtDate(p.date)}`} · ${TYPE_LABEL[p.type]}`;
    head = <>{p.address}{p.unit && <span className="unit">#{p.unit}</span>}</>;
    subject = { p: P([p.lon, p.lat]), bbl: p.bbl, home: p, label: p.address };
  } else if (sel.kind === 'site') {
    eyebrow = 'Building'; head = sel.label; subject = { p: P([sel.lon, sel.lat]), bbl: sel.bbl, label: sel.label };
  } else if (sel.kind === 'dev') {
    const d = data.devs.find(x => x.id === sel.id); if (!d) return null;
    eyebrow = `New development · ${d.status}`; head = d.address; subject = { p: P([d.lon, d.lat]), bbl: d.bbl, label: d.address };
    extra = <DevFacts id={d.id} />;
  } else if (sel.kind === 'soft') {
    const s = data.soft.find(x => x.bbl === sel.bbl); if (!s) return null;
    eyebrow = 'Soft site · unused zoning capacity'; head = s.address; subject = { p: P([s.lon, s.lat]), bbl: s.bbl, label: s.address };
  } else return <MiniSheet />;
  const order = ORDER[persona];
  const sections: Record<string, ReactNode> = {
    overview: <Overview s={subject} />, value: <Value s={subject} />, commute: <Commute s={subject} />, schools: <Schools s={subject} />,
    food: <Food s={subject} />, area: <Area s={subject} />, building: <BuildingSec s={subject} />,
  };
  const onScroll = () => {
    const el = body.current; if (!el) return;
    const secs = [...el.querySelectorAll<HTMLElement>('[data-sec]')], y = el.scrollTop + 80;
    const cur = secs.filter(s => s.offsetTop <= y).pop(); if (cur && cur.dataset.sec !== active) setActive(cur.dataset.sec!);
  };
  return (
    <aside className="sheet" aria-label="Details">
      <header className="sheet-head">
        <div className="sh-title"><small className="eyebrow">{eyebrow}</small><h2>{head}</h2></div>
        {subject.home && <ShortlistButton id={subject.home.id} />}
        <button className="icon-btn" onClick={() => select(null)} aria-label="Close details"><X size={18} /></button>
      </header>
      <nav className="sec-nav" aria-label="Sections">
        {order.map(k => <button key={k} className={active === k ? 'on' : ''} onClick={() => { const el = body.current?.querySelector<HTMLElement>(`[data-sec="${k}"]`); el && body.current!.scrollTo({ top: el.offsetTop - 52, behavior: 'smooth' }); }}>{LABEL[k]}</button>)}
      </nav>
      <div className="sheet-body" ref={body} onScroll={onScroll} key={JSON.stringify(sel)}>
        {extra}
        {order.map(k => <div key={k}>{sections[k]}</div>)}
        <p className="sources">Sources: NYC Dept. of Finance sales, PLUTO, DOE, NYPD, 311, DOHMH (NYC Open Data); MTA GTFS; OpenStreetMap; Michelin Guide via Wikipedia. Commute times are typical weekday-morning averages.</p>
      </div>
    </aside>);
}

interface Subject { p: LngLat; bbl?: string; home?: Property; label: string }

function ShortlistButton({ id }: { id: string }) {
  const { profile, setProfile, toast } = useApp(); const on = profile.shortlist.includes(id);
  return <button className={`icon-btn heart ${on ? 'on' : ''}`} aria-pressed={on} aria-label={on ? 'Remove from shortlist' : 'Add to shortlist'} title={on ? 'In shortlist' : 'Add to shortlist'}
    onClick={() => { setProfile(p => ({ ...p, shortlist: on ? p.shortlist.filter(x => x !== id) : [...p.shortlist, id] })); toast(on ? 'Removed from shortlist' : 'Added to shortlist'); }}><Heart size={18} fill={on ? 'currentColor' : 'none'} /></button>;
}

// ---------- Overview
function Overview({ s }: { s: Subject }) {
  const { data, profile } = useApp(); const h = s.home;
  const z = data.schools && zonedSchools(s.p, data.schools);
  const near = data.router?.near(s.p, 900).slice(0, 2) ?? [];
  const delta = h && valueDelta(h, data.medPpsf);
  return (
    <Section id="overview" icon={<Sparkles size={15} />} title="Overview">
      {h && <div className="hero-price">{fmtPrice(h.price)}{h.ppsf && <span className="ppsf">{fmtPpsf(h.ppsf)}/ft²</span>}<ValueBadge delta={delta} /></div>}
      {h && <div className="specs">
        {h.beds != null && <Stat k={<><BedDouble size={14} /> Beds</>} v={h.beds === 0 ? 'Studio' : h.beds} />}
        {h.baths != null && <Stat k={<><Bath size={14} /> Baths</>} v={h.baths} />}
        <Stat k={<><Ruler size={14} /> Size</>} v={h.sqft ? `${fmtNum(h.sqft)} ft²` : '–'} sub={!h.sqft && h.type === 'coop' ? 'Co-op sales record no size' : undefined} />
        <Stat k="Built" v={h.yearBuilt || '–'} sub={h.totalUnits && h.totalUnits > 1 ? `${h.totalUnits} units` : undefined} />
      </div>}
      {h?.source === 'sale' && <Note>Recorded sale, {fmtDate(h.date)}{h.located === 'block' ? ' · map position is the block centre' : ''}. Sales do not record bedrooms.</Note>}
      {h?.notes && <p className="notes">{h.notes}</p>}
      {h?.url && <a className="link" href={h.url} target="_blank" rel="noreferrer">Open listing <ExternalLink size={13} /></a>}
      <div className="highlights">
        {z?.es && <Highlight icon={<GraduationCap size={15} />} k="Zoned elementary" v={title(z.es.name)} sub={schoolScore(z.es, 'ES') != null ? `${Math.round(schoolScore(z.es, 'ES')!)}% proficient · ${scoreLabel(schoolScore(z.es, 'ES')!, (data.schools!.averages.ela + data.schools!.averages.math) / 2)}` : undefined} />}
        {near.length > 0 && <Highlight icon={<TrainFront size={15} />} k="Subway" v={<span className="bullets">{[...new Set(near.flatMap(n => n.s.routes))].filter(r => !/X$/.test(r)).slice(0, 8).map(r => <Bullet key={r} route={r} transit={data.router!.t} size={18} />)}</span>} sub={`${title(near[0].s.name)} · ${walkMinutes(near[0].m)} min walk`} />}
        {profile.destinations.slice(0, 2).map(d => <TripHighlight key={d.id} from={s.p} d={d} />)}
        {profile.diets.length > 0 && data.places && <Highlight icon={<Utensils size={15} />} k="Dietary" v={profile.diets.map(d => { const m = data.places!.dietMinutes(s.p, d); return `${DIETS.find(x => x.key === d)?.label} ${m ? `${m} min` : '20+ min'}`; }).join(' · ')} />}
      </div>
    </Section>);
}
function Highlight({ icon, k, v, sub }: { icon: ReactNode; k: string; v: ReactNode; sub?: string }) {
  return <div className="hl"><span className="hl-ico">{icon}</span><span className="hl-main"><small>{k}</small><b>{v}</b>{sub && <em>{sub}</em>}</span></div>;
}
function TripHighlight({ from, d }: { from: LngLat; d: Destination }) {
  const { data } = useApp(); const t = useMemo(() => data.router?.trip(from, [d.lon, d.lat]), [data.router, from, d]);
  return t ? <Highlight icon={<Timer size={15} />} k={`To ${d.name}`} v={fmtMin(t.seconds)} sub={t.legs.filter(l => l.route).map(l => l.route).join(' → ') || 'Walk'} /> : null;
}

// ---------- Value
function Value({ s }: { s: Subject }) {
  const { data } = useApp(); const h = s.home;
  const type = h?.type ?? 'condo';
  const v = useMemo(() => valuate({ lon: s.p[0], lat: s.p[1], type, sqft: h?.sqft, price: h?.price, bbl: s.bbl, id: h?.id }, data.sales), [data.sales, s.p, h, s.bbl, type]);
  const hood = h?.neighborhood ?? v.comps[0]?.neighborhood;
  const trend = useMemo(() => hood ? marketTrend(data.sales.filter(x => x.neighborhood === hood && x.type === type)) : [], [data.sales, hood, type]);
  const inBuilding = useMemo(() => s.bbl ? data.sales.filter(x => x.bbl === s.bbl && x.id !== h?.id).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')) : [], [data.sales, s.bbl, h]);
  const past = useAsync(() => s.bbl ? buildingSales(s.bbl, data.unitLots(s.bbl), data.salesFrom) : null, [s.bbl, data.salesFrom]);
  const ppsf = v.basis === 'ppsf';
  const [showAll, setShowAll] = useState(false);
  const history = [...inBuilding.map(x => ({ date: x.date!, price: x.price, unit: x.unit, sqft: x.sqft })), ...(past.v ?? [])];
  return (
    <Section id="value" icon={<Landmark size={15} />} title="Value" aside={`${v.n} comparable ${TYPE_LABEL[type].toLowerCase()} sales · ${v.radiusM} m · ${v.months} mo`}>
      {v.n === 0 ? <Note>No comparable sales nearby in the last {v.months} months.</Note> : <>
        {v.estimate != null && <div className="estimate"><small>Comps-based estimate</small><b>{fmtPrice(v.estimate)}</b>{h?.price != null && v.deltaPct != null && <ValueBadge delta={v.deltaPct} />}</div>}
        <RangeBar low={ppsf ? v.lowPpsf! : v.lowPrice} mid={ppsf ? v.medianPpsf! : v.medianPrice} high={ppsf ? v.highPpsf! : v.highPrice} mark={ppsf ? h?.ppsf : h?.price} fmt={ppsf ? n => `${fmtPpsf(n)}/ft²` : fmtPrice} />
        <Note>{ppsf ? 'Middle half of nearby sales by price per square foot' : 'Middle half of nearby sale prices (sizes unknown, so compare with care)'}{h?.price != null ? '; the dot is this home.' : '.'}</Note>
        <table className="comps"><thead><tr><th>Comparable sale</th><th>Date</th><th className="r">Price</th><th className="r">$/ft²</th></tr></thead><tbody>
          {v.comps.slice(0, 8).map(c => <CompRow key={c.id} c={c} from={s.p} />)}
        </tbody></table>
      </>}
      {trend.length > 2 && <div className="trend"><small>{title(hood!)} · median {ppsf ? '$/ft²' : 'price'} by month, last 12 months (bars: number of sales)</small>
        <Spark values={trend.map(t => ppsf ? t.medianPpsf : t.medianPrice)} bars={trend.map(t => t.n)} labels={trend.map(t => t.month)} fmt={ppsf ? fmtPpsf : fmtPrice} /></div>}
      {history.length > 0 && <div className="history"><small>Sales in this building · {history.length} since {history[history.length - 1].date.slice(0, 4)}</small>
        <ul>{history.slice(0, showAll ? undefined : 12).map((x, i) =>
          <li key={i}><span>{fmtDate(x.date)}</span><span>{x.unit ? `#${x.unit}` : ''}</span><b>{fmtPrice(x.price)}</b><em>{x.sqft ? `${fmtPpsf(x.price / x.sqft)}/ft²` : ''}</em></li>)}</ul>
        {history.length > 12 && <button className="link small" onClick={() => setShowAll(v => !v)}>{showAll ? 'Show fewer' : `Show all ${history.length}`}</button>}</div>}
      {past.loading && s.bbl && <Skel w="70%" />}
    </Section>);
}
function CompRow({ c, from }: { c: Property; from: LngLat }) {
  const { select } = useApp();
  return <tr onClick={() => select({ kind: 'home', id: c.id }, true)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && select({ kind: 'home', id: c.id }, true)}>
    <td><b>{c.address}{c.unit ? ` #${c.unit}` : ''}</b><small>{distanceMeters(from, [c.lon, c.lat]) < 15 ? 'Same building' : `${Math.round(distanceMeters(from, [c.lon, c.lat]))} m`} · {c.sqft ? `${fmtNum(c.sqft)} ft²` : TYPE_LABEL[c.type]}</small></td>
    <td>{fmtDate(c.date)}</td><td className="r">{fmtPrice(c.price)}</td><td className="r">{c.ppsf ? fmtPpsf(c.ppsf) : '–'}</td></tr>;
}

// ---------- Commute
const PRESETS: Destination[] = [
  { id: 'gct', name: 'Grand Central', lon: -73.9772, lat: 40.7527 }, { id: 'wall', name: 'Wall St / FiDi', lon: -74.0090, lat: 40.7074 },
  { id: 'hy', name: 'Hudson Yards', lon: -74.0020, lat: 40.7539 }, { id: 'rock', name: 'Rockefeller Ctr', lon: -73.9787, lat: 40.7587 },
  { id: 'cu', name: 'Columbia', lon: -73.9626, lat: 40.8075 }, { id: 'nyu', name: 'NYU', lon: -73.9965, lat: 40.7295 },
  { id: 'jfk', name: 'JFK (AirTrain)', lon: -73.8303, lat: 40.6604 }, { id: 'bk', name: 'Downtown Brooklyn', lon: -73.9900, lat: 40.6928 },
];
function Commute({ s }: { s: Subject }) {
  const { data, profile, setProfile, showTrip, tripTo, iso, setIso } = useApp(); const r = data.router;
  if (!r) return <Section id="commute" icon={<TrainFront size={15} />} title="Commute"><Skel /></Section>;
  const stations = r.near(s.p, 1000).slice(0, 4);
  const dests = profile.destinations.length ? profile.destinations : PRESETS.slice(0, 4);
  return (
    <Section id="commute" icon={<TrainFront size={15} />} title="Commute" aside={<label className="switch"><input type="checkbox" checked={iso} onChange={e => setIso(e.target.checked)} /> Time map</label>}>
      <div className="stations">{stations.map(({ s: st, m }) => (
        <div key={st.id} className="station"><span className="bullets">{st.routes.filter(x => !/X$/.test(x)).map(x => <Bullet key={x} route={x} transit={r.t} />)}</span>
          <span className="st-name">{title(st.name)}</span><span className="mins">{walkMinutes(m)}<small>min walk</small></span></div>))}
        {!stations.length && <Note>No subway station within a 15-minute walk.</Note>}
      </div>
      <h4>{profile.destinations.length ? `${profile.client || 'Client'}'s places` : 'Typical trips'} <small>door to door</small></h4>
      <div className="trips">{dests.map(d => <TripRow key={d.id} from={s.p} d={d} open={!!tripTo && tripTo[0] === d.lon && tripTo[1] === d.lat} onShow={on => showTrip(on ? [d.lon, d.lat] : null)}
        onRemove={profile.destinations.some(x => x.id === d.id) ? () => setProfile(p => ({ ...p, destinations: p.destinations.filter(x => x.id !== d.id) })) : undefined} />)}</div>
      <AddDestination />
      {!profile.destinations.length && <div className="chips wrap">{PRESETS.slice(4).map(d => <button key={d.id} className="chip" onClick={() => setProfile(p => ({ ...p, destinations: [...p.destinations, d] }))}><Plus size={13} />{d.name}</button>)}</div>}
      {iso && <div className="iso-legend"><i className="b15" />15 min<i className="b30" />30 min<i className="b45" />45 min <small>reachable by subway + walking</small></div>}
    </Section>);
}
function TripRow({ from, d, open, onShow, onRemove }: { from: LngLat; d: Destination; open: boolean; onShow: (on: boolean) => void; onRemove?: () => void }) {
  const { data } = useApp(); const r = data.router!;
  const t = useMemo(() => r.trip(from, [d.lon, d.lat]), [r, from, d]);
  return (
    <div className={`trip ${open ? 'open' : ''}`}>
      <button className="trip-head" onClick={() => onShow(!open)} aria-expanded={open}>
        <span className="trip-to"><MapPin size={14} />{d.name}</span>
        <span className="trip-modes">{t.legs.filter(l => l.kind === 'ride').map((l, i) => <span key={i} className="leg-bullet">{i > 0 && <ChevronRight size={12} />}<Bullet route={l.route!} transit={r.t} size={18} /></span>)}{!t.legs.some(l => l.kind === 'ride') && <Footprints size={15} />}</span>
        <b className="trip-time">{fmtMin(t.seconds)}</b>
      </button>
      {open && <ol className="legs">{t.legs.map((l, i) => <li key={i} className={l.kind}>
        {l.kind === 'walk' ? <><Footprints size={14} /><span>{l.from && l.to && l.from.name === l.to.name ? `Transfer inside ${title(l.to.name)} · ${fmtMin(l.seconds)}` : `Walk ${fmtMin(l.seconds)}${l.to ? ` to ${title(l.to.name)}` : i === t.legs.length - 1 ? ` to ${d.name}` : ''}`}</span></>
          : <><Bullet route={l.route!} transit={r.t} size={18} /><span><span className="leg-line">{title(l.from!.name)} <ArrowRight size={12} /> {title(l.to!.name)}</span><small>{l.stops} stop{l.stops === 1 ? '' : 's'} · ride {fmtMin(l.seconds)} · wait ~{fmtMin(l.wait ?? 0)}</small></span></>}
      </li>)}</ol>}
      {onRemove && open && <button className="link small" onClick={onRemove}>Remove {d.name}</button>}
    </div>);
}
function AddDestination() {
  const { setProfile } = useApp(); const [q, setQ] = useState(''); const [hits, setHits] = useState<GeoHit[]>([]);
  useEffect(() => { const c = new AbortController(); const t = setTimeout(() => suggest(q, c.signal).then(setHits).catch(() => {}), 220); return () => { clearTimeout(t); c.abort(); }; }, [q]);
  return (
    <div className="addr-add">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Add a place: office, school, family…" aria-label="Add a destination" />
      {hits.length > 0 && q && <ul className="suggest">{hits.map(h => <li key={h.label}><button onClick={() => { setProfile(p => ({ ...p, destinations: [...p.destinations, { id: `${h.lon},${h.lat}`, name: h.label.split(',')[0], lon: h.lon, lat: h.lat }] })); setQ(''); setHits([]); }}><MapPin size={13} />{h.label}</button></li>)}</ul>}
    </div>);
}

// ---------- Schools
function Schools({ s }: { s: Subject }) {
  const { data, select } = useApp(); const d = data.schools;
  if (!d) return <Section id="schools" icon={<GraduationCap size={15} />} title="Schools"><Skel /></Section>;
  const z = zonedSchools(s.p, d), avgEM = (d.averages.ela + d.averages.math) / 2;
  const hs = nearbySchools(s.p, d, 'HS', 12).filter(x => x.school.grad != null).sort((a, b) => b.school.grad! - a.school.grad!).slice(0, 4);
  const ms = z.district ? districtSchools(z.district, d, 'MS').filter(x => !x.levels.includes('HS') || x.levels.includes('MS')).slice(0, 3) : [];
  const card = (sc: typeof z.es, role: string, level: 'ES' | 'MS' | 'HS') => sc && (
    <button className="school" onClick={() => select({ kind: 'school', dbn: sc.dbn }, true)}>
      <span className="sc-role">{role}</span><b>{title(sc.name)}</b>
      <span className="sc-scores">{level !== 'HS' ? <>
        {sc.ela != null && <Meter label="Reading" v={sc.ela} avg={d.averages.ela} />}{sc.math != null && <Meter label="Math" v={sc.math} avg={d.averages.math} />}
        {sc.ela == null && sc.math == null && <small>No published scores</small>}</> : sc.grad != null && <Meter label="Graduates" v={sc.grad} avg={d.averages.grad} />}</span>
      <small>{walkMinutes(distanceMeters(s.p, [sc.lon, sc.lat]))} min walk · District {sc.district}{level !== 'HS' && schoolScore(sc, level) != null ? ` · ${scoreLabel(schoolScore(sc, level)!, avgEM)}` : ''}</small>
    </button>);
  return (
    <Section id="schools" icon={<GraduationCap size={15} />} title="Schools" aside={z.district ? `District ${z.district}` : undefined}>
      {card(z.es, 'Zoned elementary', 'ES') ?? <Note>{z.district === 1 ? 'District 1 has no elementary zones: admission is by choice across the district.' : 'No zoned elementary school at this address.'}</Note>}
      {card(z.ms, 'Zoned middle', 'MS')}
      {!z.ms && ms.length > 0 && <><h4>District {z.district} middle schools <small>admission by choice, district priority</small></h4>{ms.map(m => <div key={m.dbn}>{card(m, 'Middle', 'MS')}</div>)}</>}
      {hs.length > 0 && <><h4>Nearby high schools <small>citywide choice</small></h4>{hs.map(h => <div key={h.school.dbn}>{card(h.school, 'High school', 'HS')}</div>)}</>}
      <Note>% of students proficient on {d.schools.find(x => x.testYear)?.testYear ?? ''} state tests (grades 3–8, NYC DOE), vs NYC average {Math.round(d.averages.ela)}% reading / {Math.round(d.averages.math)}% math. Graduation: 4-year rate, class of {d.schools.find(x => x.gradCohort)?.gradCohort?.match(/\d{4}/)?.[0] ? +d.schools.find(x => x.gradCohort)!.gradCohort!.match(/\d{4}/)![0] + 4 : 'latest'}. Zones are the 2024-25 map; a zone gives priority, not a guaranteed seat.</Note>
    </Section>);
}
function Meter({ label, v, avg }: { label: string; v: number; avg: number }) {
  return <span className="meter" title={`${label}: ${Math.round(v)}% (NYC ${Math.round(avg)}%)`}><small>{label}</small><span className="m-track"><i style={{ width: `${v}%` }} className={v >= avg + 3 ? 'good' : v <= avg - 3 ? 'bad' : ''} /><em style={{ left: `${avg}%` }} /></span><b>{Math.round(v)}%</b></span>;
}

// ---------- Food
function Food({ s }: { s: Subject }) {
  const { data, profile, setProfile } = useApp(); const P = data.places;
  if (!P) return <Section id="food" icon={<Utensils size={15} />} title="Food & dietary"><Skel /></Section>;
  const diets = profile.diets;
  const toggle = (d: Diet) => setProfile(p => ({ ...p, diets: p.diets.includes(d) ? p.diets.filter(x => x !== d) : [...p.diets, d] }));
  const kinds = GROCERY_KINDS.map(k => ({ ...k, hit: P.nearestGrocery(s.p, { kind: k.key }) })).filter(k => k.hit && k.hit.min <= 20);
  const dietHits = diets.map(d => ({ d, g: P.nearestGrocery(s.p, { diet: d }), r: P.restaurants(s.p, 10, [d]) }));
  const all = P.restaurants(s.p, 10), stars = P.starsNear(s.p, 20);
  const cuisines = Object.entries(all.reduce<Record<string, number>>((m, x) => { const c = cuisineLabel(x.item.cuisine); if (x.item.cuisine) m[c] = (m[c] ?? 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const gradeA = all.filter(x => x.item.grade === 'A').length, graded = all.filter(x => x.item.grade).length;
  return (
    <Section id="food" icon={<Utensils size={15} />} title="Food & dietary">
      <div className="chips wrap" role="group" aria-label="Dietary needs">{DIETS.map(d => <button key={d.key} className={`chip ${diets.includes(d.key) ? 'on' : ''}`} aria-pressed={diets.includes(d.key)} onClick={() => toggle(d.key)}>{diets.includes(d.key) && <Check size={13} />}{d.label}</button>)}</div>
      {dietHits.map(({ d, g, r }) => <div key={d} className="diet-row"><b>{DIETS.find(x => x.key === d)!.label}</b>
        <span>{g ? <>Grocery: {g.place.name} · <b>{g.min} min</b></> : 'No grocery within 30 min'}</span>
        <span>{r.length} restaurant{r.length === 1 ? '' : 's'} within 10 min{r[0] ? ` · nearest ${r[0].item.name}` : ''}</span></div>)}
      <h4>Groceries <small>nearest of each kind</small></h4>
      <ul className="nlist">{kinds.map(k => <li key={k.key}><span className="nl-kind">{k.label}</span><span className="nl-name">{k.hit!.place.name}</span><b>{k.hit!.min}<small> min</small></b></li>)}</ul>
      <h4>Dining <small>{all.length} restaurants within a 10-minute walk{graded ? ` · ${Math.round((gradeA / graded) * 100)}% health grade A` : ''}</small></h4>
      <div className="chips wrap static">{cuisines.map(([c, n]) => <span key={c} className="chip">{c} <small>{n}</small></span>)}</div>
      {stars.length > 0 && <><h4><Star size={13} /> Michelin-starred within 20 min</h4>
        <ul className="nlist">{stars.slice(0, 6).map(x => <li key={x.item.name}><span className="stars">{'★'.repeat(x.item.stars)}</span><span className="nl-name">{x.item.name}<small>{x.item.cuisine}</small></span><b>{walkMinutes(x.m)}<small> min</small></b></li>)}</ul></>}
      <Note>Groceries and diet tags: OpenStreetMap. Restaurants and grades: NYC DOHMH inspections. Michelin: 2025 guide.</Note>
    </Section>);
}

// ---------- Area
function Area({ s }: { s: Subject }) {
  const { data } = useApp(); const P = data.places;
  const sf = useAsync(() => safety(s.p), [s.p[0], s.p[1]]);
  const nz = useAsync(() => noise(s.p), [s.p[0], s.p[1]]);
  const lot = useAsync(() => s.bbl ? lotFacts(s.bbl) : null, [s.bbl]);
  const bikes = useAsync(() => citiBike(s.p, 2), [s.p[0], s.p[1]]);
  const env = useAsync(() => environment(s.p), [s.p[0], s.p[1]]);
  const E = env.v?.fields;
  const park = P?.nearestOf(s.p, 'park'), play = P?.countWithin(s.p, 'playground', 10), gyms = P?.countWithin(s.p, 'gym', 10);
  const rel = (r?: number) => r == null ? '' : r < 0.7 ? 'well below' : r < 0.9 ? 'below' : r <= 1.1 ? 'about' : r <= 1.5 ? 'above' : 'well above';
  return (
    <Section id="area" icon={<Shield size={15} />} title="Area">
      <div className="area-grid">
        <AreaTile icon={<Shield size={15} />} k="Reported crime" loading={sf.loading} err={sf.err}
          v={sf.v && `${fmtNum(sf.v.felonies)} felonies`} sub={sf.v && `${rel(sf.v.ratio)} Manhattan average (${sf.v.ratio.toFixed(1)}×) · 800 m square, last 12 months of reports`} tone={sf.v && (sf.v.ratio > 1.5 ? 'bad' : sf.v.ratio < 0.9 ? 'good' : '')} />
        <AreaTile icon={<Volume2 size={15} />} k="Noise complaints" loading={nz.loading} err={nz.err}
          v={nz.v && `${fmtNum(nz.v.complaints)} / yr`} sub={nz.v && `${rel(nz.v.ratio)} average · mostly ${nz.v.top[0]?.type.toLowerCase() ?? '–'}`} tone={nz.v && (nz.v.ratio > 1.5 ? 'bad' : nz.v.ratio < 0.9 ? 'good' : '')} />
        {E?.within_floodplain_polygon ? <FloodTile f={E.within_floodplain_polygon} />
          : <AreaTile icon={<Waves size={15} />} k="Flood zone" loading={(lot.loading && !!s.bbl) || env.loading} v={lot.v ? (lot.v.flood100 ? '100-year floodplain' : 'Outside 100-yr floodplain') : s.bbl ? undefined : 'Unknown'} sub="FEMA 2015 preliminary map (PLUTO)" tone={lot.v?.flood100 ? 'bad' : lot.v ? 'good' : ''} />}
        <AreaTile icon={<Trees size={15} />} k="Parks & play" v={park ? `${title(park.place.name)}` : '–'} sub={park ? `${park.min} min · ${play} playgrounds, ${gyms} gyms within 10 min` : undefined} />
        <AreaTile icon={<Bus size={15} />} k="Citi Bike" loading={bikes.loading} err={bikes.err ? 'Live data unavailable' : undefined}
          v={bikes.v?.[0] && `${walkMinutes(bikes.v[0].m)} min to a dock`} sub={bikes.v?.[0] && `${bikes.v[0].num_bikes_available ?? '–'} bikes · ${bikes.v[0].num_docks_available ?? '–'} docks free now`} />
      </div>
      <Climate env={env} />
      <Note>Crime: NYPD complaints reported {sf.v?.period ?? 'over the latest 12 months'} (historic + year-to-date sets), felonies per area vs all of Manhattan. Busy commercial blocks score high because of daytime crowds.</Note>
    </Section>);
}
function AreaTile({ icon, k, v, sub, loading, err, tone }: { icon: ReactNode; k: string; v?: ReactNode; sub?: ReactNode; loading?: boolean; err?: string; tone?: string | false | undefined }) {
  return <div className={`atile ${tone || ''}`}><small>{icon}{k}</small>{loading ? <Skel w="70%" /> : err ? <em className="muted">{err}</em> : <><b>{v ?? '–'}</b>{sub && <em>{sub}</em>}</>}</div>;
}

/** Climate & environment from the Mireye Earth API: elevation and shoreline (storm-surge exposure), tree canopy, traffic, airport. */
function Climate({ env }: { env: { v?: import('../lib/area').Environment; err?: string; loading: boolean } }) {
  const E = env.v?.fields; if (env.err && !E) return null;
  const n = (f?: { value: unknown }) => typeof f?.value === 'number' ? f.value : undefined;
  const elev = n(E?.elevation), coast = n(E?.coast_distance_m), canopy = n(E?.tree_canopy_pct), road = n(E?.nearest_major_road_distance_m), air = n(E?.nearest_airport_distance_m);
  const lowLying = elev != null && coast != null && elev < 10 && coast < 5000;
  const src = (...fs: (import('../lib/area').EnvField | undefined)[]) => [...new Set(fs.filter(Boolean).map(f => `${f!.source.replace(/_/g, ' ')}${f!.confidence !== 'high' ? ` (${f!.confidence} confidence)` : ''}`))].join(', ');
  return (<>
    <h4>Climate & environment <small>Mireye Earth API</small></h4>
    <div className="area-grid">
      <AreaTile icon={<Waves size={15} />} k="Elevation & shoreline" loading={env.loading} v={elev != null ? `${Math.round(elev * 3.281)} ft above sea level` : undefined}
        sub={coast != null ? `${coast < 1000 ? `${Math.round(coast)} m` : `${(coast / 1000).toFixed(1)} km`} to the shoreline${lowLying ? ' · low-lying near the water: check storm-surge maps' : ''} · ${src(E?.elevation, E?.coast_distance_m)}` : undefined} tone={lowLying ? 'bad' : elev != null ? 'good' : ''} />
      <AreaTile icon={<Trees size={15} />} k="Tree canopy" loading={env.loading} v={canopy != null ? `${Math.round(canopy)}% of the block` : undefined} sub={canopy != null ? `${canopy >= 20 ? 'Leafy' : canopy >= 5 ? 'Some trees' : 'Little shade'} · ${src(E?.tree_canopy_pct)}` : undefined} tone={canopy != null && canopy >= 20 ? 'good' : ''} />
      <AreaTile icon={<Bus size={15} />} k="Traffic" loading={env.loading} v={road != null ? `${Math.round(road)} m to ${E?.nearest_major_road_name?.value ?? 'a major road'}` : undefined} sub={road != null ? `${road < 60 ? 'On a major road: expect traffic noise' : road < 150 ? 'Close to a major road' : 'Set back from major roads'} · ${src(E?.nearest_major_road_distance_m)}` : undefined} tone={road != null && road < 60 ? 'bad' : ''} />
      <AreaTile icon={<MapPin size={15} />} k="Nearest airport" loading={env.loading} v={air != null ? `${title(String(E?.nearest_airport_name?.value ?? 'Airport'))}` : undefined} sub={air != null ? `${(air / 1609).toFixed(1)} mi straight line · ${src(E?.nearest_airport_distance_m)}` : undefined} />
    </div>
  </>);
}
function FloodTile({ f }: { f: import('../lib/area').EnvField }) {
  const zone = femaZone(f.notes), inside = f.value === true;
  const moderate = !inside && /0\.2 PCT|500[- ]YEAR|SHADED/i.test(f.notes ?? '');
  const v = inside ? `100-year floodplain${zone ? ` (zone ${zone})` : ''}` : moderate ? `Zone ${zone ?? 'X'}: 500-year floodplain` : `Zone ${zone ?? 'X'}: minimal flood hazard`;
  return <AreaTile icon={<Waves size={15} />} k="Flood zone" v={v} sub={`Current FEMA flood map (NFHL) via Mireye${f.vintage ? ` · ${f.vintage}` : ''}`} tone={inside ? 'bad' : moderate ? '' : 'good'} />;
}

// ---------- Building / lot
function BuildingSec({ s }: { s: Subject }) {
  const lot = useAsync(() => s.bbl ? lotFacts(s.bbl) : null, [s.bbl]);
  const f = lot.v;
  return (
    <Section id="building" icon={<Building2 size={15} />} title="Building & zoning" aside={s.bbl ? <button className="link small" onClick={() => navigator.clipboard.writeText(s.bbl!)} title="Copy BBL">BBL {s.bbl} <Copy size={11} /></button> : undefined}>
      {!s.bbl ? <Note>Tax lot unknown for this point.</Note> : lot.loading ? <Skel /> : !f ? <Note>No PLUTO record for this lot.</Note> : <>
        <div className="kv">
          <KV k="Built" v={f.yearBuilt ?? '–'} /><KV k="Floors" v={f.floors ?? '–'} /><KV k="Residential units" v={f.unitsRes ?? '–'} />
          <KV k="Zoning" v={f.zoning ?? '–'} /><KV k="Lot area" v={f.lotArea ? `${fmtNum(f.lotArea)} ft²` : '–'} /><KV k="Building area" v={f.bldgArea ? `${fmtNum(f.bldgArea)} ft²` : '–'} />
          <KV k="FAR built / max res." v={`${f.builtFar?.toFixed(2) ?? '–'} / ${f.maxResFar?.toFixed(2) ?? '–'}`} />
          <KV k="Unused res. floor area" v={f.airRights ? `${fmtNum(f.airRights)} ft²` : 'None'} accent={!!f.airRights && f.airRights > 10000} />
          <KV k="Assessed value" v={f.assessed ? fmtPrice(f.assessed) : '–'} /><KV k="Owner of record" v={f.owner && !/unavailable/i.test(f.owner) ? title(f.owner) : 'Not listed (condo/co-op)'} />
        </div>
        {(f.historicDistrict || f.landmark) && <p className="flag"><Landmark size={14} /> {f.landmark ? `Landmark: ${title(f.landmark)}` : `In ${f.historicDistrict}`}. Exterior changes need LPC approval.</p>}
      </>}
    </Section>);
}
const KV = ({ k, v, accent }: { k: string; v: ReactNode; accent?: boolean }) => <div className={accent ? 'accent' : ''}><small>{k}</small><b>{v}</b></div>;

// ---------- Development facts (top of the sheet for new developments)
function DevFacts({ id }: { id: string }) {
  const { data } = useApp(); const d = data.devs.find(x => x.id === id)!;
  const steps = [['Filed', d.filed], ['Permitted', d.permitted], ['Completed', d.completed]] as const;
  return (
    <Section id="dev" icon={<Sparkles size={15} />} title="Project">
      <div className="specs"><Stat k="Homes" v={fmtNum(d.units)} accent /><Stat k="Floors" v={d.floors ?? '–'} /><Stat k="Status" v={d.status} /></div>
      <ol className="timeline">{steps.map(([k, v]) => <li key={k} className={v ? 'done' : ''}><i /><b>{k}</b><small>{v ? fmtDate(v) : 'Not yet'}</small></li>)}</ol>
      <Note>NYC DCP Housing Database (DOB filings). Ownership type: {d.owner ?? 'unknown'}.</Note>
    </Section>);
}

// ---------- small sheets
function MiniSheet() {
  const { sel, select, data } = useApp();
  let eyebrow = '', head = '', body: ReactNode = null;
  if (sel?.kind === 'place') {
    const all = data.places?.grid.items ?? []; const p = all.find(x => x.id === sel.id); if (!p) return null;
    eyebrow = p.cat === 'dining' ? cuisineLabel(p.cuisine) : GROCERY_KINDS.find(k => k.key === p.sub)?.label ?? p.sub; head = p.name;
    body = <>{p.addr && <p>{p.addr}</p>}{p.grade && <p>Health grade <b className={`grade g${p.grade}`}>{p.grade}</b></p>}{p.diets?.length ? <div className="chips wrap static">{p.diets.map(d => <span key={d} className="chip">{DIETS.find(x => x.key === d)?.label ?? d}</span>)}</div> : null}</>;
  } else if (sel?.kind === 'school') {
    const s = data.schools?.schools.find(x => x.dbn === sel.dbn); if (!s) return null;
    eyebrow = `${s.levels.join(' · ')} · District ${s.district}`; head = title(s.name);
    body = <div className="specs">{s.ela != null && <Stat k="Reading proficient" v={`${Math.round(s.ela)}%`} sub={`NYC ${Math.round(data.schools!.averages.ela)}%`} />}{s.math != null && <Stat k="Math proficient" v={`${Math.round(s.math)}%`} sub={`NYC ${Math.round(data.schools!.averages.math)}%`} />}{s.grad != null && <Stat k="4-yr graduation" v={`${Math.round(s.grad)}%`} sub={`NYC ${Math.round(data.schools!.averages.grad)}%`} />}<Stat k="DBN" v={s.dbn} /></div>;
  } else if (sel?.kind === 'station') {
    const st = data.router?.byId.get(sel.id); if (!st) return null;
    eyebrow = 'Subway station'; head = title(st.name);
    body = <span className="bullets">{st.routes.filter(r => !/X$/.test(r)).map(r => <Bullet key={r} route={r} transit={data.router!.t} size={24} />)}</span>;
  } else return null;
  return <aside className="sheet mini" aria-label="Details"><header className="sheet-head"><div className="sh-title"><small className="eyebrow">{eyebrow}</small><h2>{head}</h2></div><button className="icon-btn" onClick={() => select(null)} aria-label="Close"><X size={18} /></button></header><div className="sheet-body">{body}</div></aside>;
}
