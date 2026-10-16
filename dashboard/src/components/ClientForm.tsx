import { useState, type FormEvent } from 'react';
import type { Destination, MatchRequest, Pets } from '../types';
import { PLACES } from '../lib/places';

type DestRow = { place: string; label: string; lat: string; lng: string; max: string };
const inMonth = () => { const d = new Date(); d.setDate(d.getDate() + 21); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }; // local date, not UTC
const PREFS = [
  { group: 'Meals', name: 'meals', opts: [['home_cook', 'Cooks at home'], ['eats_out', 'Eats out']] },
  { group: 'Evenings', name: 'evenings', opts: [['stays_in', 'Stays in'], ['goes_out', 'Goes out']] },
] as const;

export function ClientForm({ onSubmit, busy }: { onSubmit: (r: MatchRequest) => void; busy: boolean }) {
  const [budget, setBudget] = useState('5000');
  const [bedsMin, setBedsMin] = useState('1');
  const [baths, setBaths] = useState('1');
  const [moveIn, setMoveIn] = useState(inMonth());
  const [pets, setPets] = useState<Pets>('none');
  const [assist, setAssist] = useState(false);
  const [dests, setDests] = useState<DestRow[]>([{ place: 'Grand Central', label: 'Grand Central', lat: '', lng: '', max: '30' }]);
  const [prefs, setPrefs] = useState<Record<string, string>>({ meals: '', evenings: '' });
  const [err, setErr] = useState<string | null>(null);

  const upd = (i: number, p: Partial<DestRow>) => setDests((d) => d.map((r, j) => (j === i ? { ...r, ...p } : r)));

  function submit(e: FormEvent) {
    e.preventDefault();
    const destinations: Destination[] = [];
    for (const d of dests) {
      const preset = PLACES.find((p) => p.label === d.place);
      const lat = preset ? preset.lat : Number(d.lat), lng = preset ? preset.lng : Number(d.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (!preset && (!d.lat || !d.lng))) return setErr('Each custom destination needs a latitude and longitude.');
      destinations.push({ label: preset ? preset.label : d.label || 'Custom destination', lat, lng, max_minutes: Number(d.max) || 30 });
    }
    setErr(null);
    onSubmit({
      hard_rules: { budget_max: Number(budget), beds_min: Number(bedsMin), baths_min: Number(baths), move_in_date: moveIn, pets, assistance_animal: assist },
      destinations,
      preferences: { tags: Object.values(prefs).filter(Boolean) },
    });
  }

  return (
    <form className="form" onSubmit={submit} aria-labelledby="form-title">
      <h2 id="form-title" className="eyebrow">New search</h2>
      <fieldset className="card">
        <legend><span className="legend">Hard rules</span><span className="hint">Filter listings. Pets and commute are locked and never bent.</span></legend>
        <div className="grid2">
          <label>Max budget <span className="unit">/mo</span>
            <input type="number" inputMode="numeric" min={500} step={50} required value={budget} onChange={(e) => setBudget(e.target.value)} />
          </label>
          <label>Move-in date
            <input type="date" required value={moveIn} onChange={(e) => setMoveIn(e.target.value)} />
          </label>
          <label>Bedrooms <span className="unit">(min; more is fine)</span>
            <select value={bedsMin} onChange={(e) => setBedsMin(e.target.value)}>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 0 ? 'Studio' : n}</option>)}</select>
          </label>

          <label>Bathrooms (min)
            <select value={baths} onChange={(e) => setBaths(e.target.value)}>{[1, 1.5, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
          <label>Pets <span className="lock" title="Locked rule">🔒 locked</span>
            <select value={pets} onChange={(e) => setPets(e.target.value as Pets)}>
              <option value="none">No pets</option><option value="cat">Cat</option><option value="dog">Dog</option><option value="cat_and_dog">Cat and dog</option>
            </select>
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={assist} onChange={(e) => setAssist(e.target.checked)} />
          <span>Client has an assistance animal <small>(asked separately from pets; never excludes no-pet buildings)</small></span>
        </label>

        <div className="dests" role="group" aria-labelledby="dest-h">
          <div className="row-between"><span id="dest-h" className="sub">Destinations <span className="lock">🔒 locked</span></span>
            {dests.length < 3 && <button type="button" className="ghost" onClick={() => setDests([...dests, { place: 'World Trade Center', label: '', lat: '', lng: '', max: '30' }])}>+ Add</button>}</div>
          {dests.map((d, i) => (
            <div className="dest" key={i}>
              <label className="grow">Destination {i + 1}
                <select value={d.place} onChange={(e) => upd(i, { place: e.target.value })}>
                  {PLACES.map((p) => <option key={p.label}>{p.label}</option>)}<option value="custom">Custom (lat/lng)…</option>
                </select>
              </label>
              <label className="mins">Max min
                <input type="number" min={5} max={120} step={5} value={d.max} onChange={(e) => upd(i, { max: e.target.value })} />
              </label>
              {dests.length > 1 && <button type="button" className="ghost x" aria-label={`Remove destination ${i + 1}`} onClick={() => setDests(dests.filter((_, j) => j !== i))}>×</button>}
              {d.place === 'custom' && (
                <div className="grid3">
                  <label>Label<input value={d.label} onChange={(e) => upd(i, { label: e.target.value })} placeholder="Office" /></label>
                  <label>Lat<input inputMode="decimal" value={d.lat} onChange={(e) => upd(i, { lat: e.target.value })} placeholder="40.75" /></label>
                  <label>Lng<input inputMode="decimal" value={d.lng} onChange={(e) => upd(i, { lng: e.target.value })} placeholder="-73.98" /></label>
                </div>
              )}
            </div>
          ))}
          <p className="hint">Commute times are straight-line estimates (~20 km/h door to door), not transit routing.</p>
        </div>
      </fieldset>

      <fieldset className="card soft">
        <legend><span className="legend">Agent preferences</span><span className="hint">Ranking only. Never filters a listing.</span></legend>
        {PREFS.map((g) => (
          <div className="seg" role="radiogroup" aria-label={g.group} key={g.name}>
            <span className="sub">{g.group}</span>
            <div className="seg-opts">
              {[['', 'No preference'], ...g.opts].map(([v, t]) => (
                <label key={v} className={prefs[g.name] === v ? 'on' : ''}>
                  <input type="radio" name={g.name} value={v} checked={prefs[g.name] === v} onChange={() => setPrefs({ ...prefs, [g.name]: v })} />{t}
                </label>
              ))}
            </div>
          </div>
        ))}
      </fieldset>
      {err && <p className="error" role="alert">{err}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Matching…' : 'Find matches'}</button>
    </form>
  );
}
