// Tour tab (agent): shortlist in visiting order with travel time between stops, order optimisation, a client link,
// a printable client report, and CSV import of the agent's own listings.
import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Link2, Printer, Shuffle, Trash2, Upload, X } from 'lucide-react';
import { useApp, TYPE_LABEL, valueDelta } from '../state';
import { Bullet, ValueBadge, fmtMin, fmtNum, fmtPpsf, fmtPrice, fmtDate } from './common';
import { importCsv, saveListings, templateCsv } from '../lib/listings';
import { shareUrl } from '../lib/profile';
import type { Property } from '../model';

export function Tour() {
  const { data, profile, setProfile, select, toast } = useApp();
  const stops = profile.shortlist.map(id => data.byId.get(id)).filter((p): p is Property => !!p);
  const legs = useMemo(() => stops.slice(1).map((p, i) => data.router?.trip([stops[i].lon, stops[i].lat], [p.lon, p.lat])), [profile.shortlist.join(), data.router]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = legs.reduce((s, t) => s + (t?.seconds ?? 0), 0);
  const move = (i: number, d: number) => setProfile(p => { const s = [...p.shortlist]; [s[i], s[i + d]] = [s[i + d], s[i]]; return { ...p, shortlist: s }; });
  /** Nearest-neighbour order from the first stop, by actual travel time. */
  const optimise = () => {
    if (!data.router || stops.length < 3) return;
    const left = stops.slice(1), order = [stops[0]];
    while (left.length) { const cur = order[order.length - 1]; let bi = 0, bt = Infinity; left.forEach((p, i) => { const t = data.router!.trip([cur.lon, cur.lat], [p.lon, p.lat]).seconds; if (t < bt) { bt = t; bi = i; } }); order.push(left.splice(bi, 1)[0]); }
    setProfile(p => ({ ...p, shortlist: order.map(o => o.id) })); toast('Tour reordered by travel time');
  };
  return (
    <div className="tour">
      <section>
        <h3>{profile.client ? `${profile.client}'s tour` : 'Tour'} <small>{stops.length} homes{legs.length ? ` · ${fmtMin(total)} travelling` : ''}</small></h3>
        {!stops.length && <p className="note">Tap ♥ on any home to add it. Stops are visited in this order; travel times are subway + walking.</p>}
        <ol className="stops">{stops.map((p, i) => (<li key={p.id}>
          {i > 0 && legs[i - 1] && <div className="hop"><span>{legs[i - 1]!.legs.filter(l => l.route).map((l, k) => <Bullet key={k} route={l.route!} transit={data.router!.t} size={16} />)}{!legs[i - 1]!.legs.some(l => l.route) && 'Walk'}</span><b>{fmtMin(legs[i - 1]!.seconds)}</b></div>}
          <div className="stop"><span className="num">{i + 1}</span>
            <button className="stop-main" onClick={() => select({ kind: 'home', id: p.id }, true)}><b>{p.address}{p.unit ? ` #${p.unit}` : ''}</b><small>{fmtPrice(p.price)} · {TYPE_LABEL[p.type]} · {p.neighborhood}</small></button>
            <span className="stop-tools"><button className="icon-btn sm" disabled={!i} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={14} /></button><button className="icon-btn sm" disabled={i === stops.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={14} /></button>
              <button className="icon-btn sm" onClick={() => setProfile(x => ({ ...x, shortlist: x.shortlist.filter(id => id !== p.id) }))} aria-label="Remove"><X size={14} /></button></span></div>
        </li>))}</ol>
        {stops.length > 0 && <div className="actions">
          {stops.length > 2 && <button className="btn" onClick={optimise}><Shuffle size={15} />Best order</button>}
          <button className="btn" onClick={() => { navigator.clipboard.writeText(shareUrl(profile, data.listings)); toast('Client link copied'); }}><Link2 size={15} />Copy client link</button>
          <button className="btn primary" onClick={() => window.print()}><Printer size={15} />Client report</button>
        </div>}
      </section>
      <Import />
      <PrintReport stops={stops} />
    </div>);
}

function Import() {
  const { data, toast, setListings } = useApp(); const onImported = setListings; const file = useRef<HTMLInputElement>(null); const [busy, setBusy] = useState<string | null>(null); const [problems, setProblems] = useState<string[]>([]);
  const run = async (f: File) => {
    setBusy('Reading…'); setProblems([]);
    const { listings, problems } = await importCsv(await f.text(), (d, t) => setBusy(`Locating ${d} of ${t}…`));
    const merged = [...data.listings.filter(l => !listings.some(n => n.id === l.id)), ...listings];
    saveListings(merged); onImported(merged); setProblems(problems); setBusy(null);
    toast(`${listings.length} listing${listings.length === 1 ? '' : 's'} imported`);
  };
  return (
    <section className="import">
      <h3>My listings <small>{data.listings.length} in this browser</small></h3>
      <div className="drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; f && run(f); }}>
        <Upload size={18} /><span>{busy ?? <>Drop a CSV of listings here or <button className="link" onClick={() => file.current?.click()}>choose a file</button></>}</span>
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={e => { const f = e.target.files?.[0]; f && run(f); e.target.value = ''; }} />
      </div>
      <p className="note">Columns: address, unit, price, beds, baths, sqft, type, status, url, notes (lat/lon optional; addresses are located with the NYC geocoder). Works with RLS / StreetEasy exports that use these names. <a className="link" href={`data:text/csv;charset=utf-8,${encodeURIComponent(templateCsv())}`} download="listings-template.csv"><Download size={12} /> Template</a></p>
      {problems.length > 0 && <ul className="problems">{problems.slice(0, 8).map(p => <li key={p}>{p}</li>)}</ul>}
      {data.listings.length > 0 && <button className="link small danger" onClick={() => { if (confirm('Remove all imported listings from this browser?')) { saveListings([]); onImported([]); } }}><Trash2 size={12} /> Clear my listings</button>}
    </section>);
}

/** Print-only one-page summary per shortlisted home (window.print). */
function PrintReport({ stops }: { stops: Property[] }) {
  const { data, profile } = useApp();
  return (
    <div className="print-only" aria-hidden>
      <h1>{profile.client ? `Homes for ${profile.client}` : 'Shortlisted homes'}</h1><p>{new Date().toLocaleDateString('en-US', { dateStyle: 'long' })} · {stops.length} homes</p>
      {stops.map((p, i) => {
        const near = data.router?.near([p.lon, p.lat], 900)[0];
        return <article key={p.id}><h2>{i + 1}. {p.address}{p.unit ? ` #${p.unit}` : ''}</h2>
          <p><b>{fmtPrice(p.price)}</b>{p.ppsf ? ` · ${fmtPpsf(p.ppsf)}/ft²` : ''} · {TYPE_LABEL[p.type]}{p.sqft ? ` · ${fmtNum(p.sqft)} ft²` : ''}{p.beds != null ? ` · ${p.beds} bd` : ''} · {p.neighborhood} · {p.source === 'listing' ? p.status : `Sold ${fmtDate(p.date)}`} <ValueBadge delta={valueDelta(p, data.medPpsf)} small /></p>
          {near && <p>Subway: {near.s.name} ({near.s.routes.filter(r => !/X$/.test(r)).join(', ')}), {Math.round(near.m * 1.25 / 80)} min walk</p>}
          {profile.destinations.map(d => { const t = data.router?.trip([p.lon, p.lat], [d.lon, d.lat]); return t && <p key={d.id}>To {d.name}: {fmtMin(t.seconds)}</p>; })}
          {p.notes && <p>{p.notes}</p>}</article>;
      })}
      <p className="small">Sources: NYC Open Data (DOF sales, PLUTO, DOE), MTA. Commute times are typical weekday-morning averages.</p>
    </div>);
}
