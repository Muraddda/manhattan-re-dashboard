// Develop tab: the new-building pipeline (DCP Housing Database) and soft sites (lots with unused residential floor area).
import { useMemo, useState } from 'react';
import { ChevronRight, Construction, Layers } from 'lucide-react';
import { useApp } from '../state';
import { Stat, fmtDate, fmtNum } from './common';
import { devSummary } from '../lib/devs';

export function Develop() {
  const { data, select } = useApp(); const [view, setView] = useState<'pipeline' | 'soft'>('pipeline'); const [status, setStatus] = useState('all');
  const sum = useMemo(() => devSummary(data.devs), [data.devs]);
  const devs = useMemo(() => data.devs.filter(d => status === 'all' || d.status === status).sort((a, b) => b.units - a.units), [data.devs, status]);
  const soft = useMemo(() => [...data.soft].sort((a, b) => b.air - a.air), [data.soft]);
  const statuses = Object.keys(sum.byStatus ?? {});
  return (
    <div className="develop">
      <div className="seg3" role="radiogroup"><button role="radio" aria-checked={view === 'pipeline'} className={view === 'pipeline' ? 'on' : ''} onClick={() => setView('pipeline')}><Construction size={14} /> Pipeline</button>
        <button role="radio" aria-checked={view === 'soft'} className={view === 'soft' ? 'on' : ''} onClick={() => setView('soft')}><Layers size={14} /> Soft sites</button></div>
      {view === 'pipeline' ? <>
        <div className="stats"><Stat k="Projects" v={fmtNum(sum.count)} /><Stat k="New homes" v={fmtNum(sum.units)} /><Stat k="Under way" v={fmtNum((sum.byStatus?.Permitted?.units ?? 0) + (sum.byStatus?.Approved?.units ?? 0))} sub="approved + permitted units" /></div>
        <div className="chips">{['all', ...statuses].map(s => <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{s === 'all' ? 'All' : s}<small>{s === 'all' ? sum.count : sum.byStatus[s].count}</small></button>)}</div>
        <div className="list">{devs.slice(0, 150).map(d => (
          <button key={d.id} className="row dev" onClick={() => select({ kind: 'dev', id: d.id }, true)}>
            <span className={`dot st-${d.status.toLowerCase().replace(/\W+/g, '')}`} />
            <span className="row-main"><b>{d.address}</b><small>{d.neighborhood ?? ''} · {d.status} {fmtDate(d.completed ?? d.permitted ?? d.filed)}</small></span>
            <span className="row-price">{fmtNum(d.units)}<small>homes{d.floors ? ` · ${d.floors} fl` : ''}</small></span><ChevronRight size={16} className="chev" /></button>))}</div>
        <p className="note">New residential buildings filed since 2019 (NYC DCP Housing Database, from DOB filings).</p>
      </> : <>
        <p className="note">Lots whose current building uses far less residential floor area than zoning allows (max residential FAR × lot area − built area &gt; 15,000 ft²), excluding landmarks and parks. A starting point for site sourcing, not a feasibility study.</p>
        <div className="list">{soft.slice(0, 150).map(s => (
          <button key={s.bbl} className="row dev" onClick={() => select({ kind: 'soft', bbl: s.bbl }, true)}>
            <span className="dot soft" />
            <span className="row-main"><b>{s.address}</b><small>{s.zoning} · lot {fmtNum(s.lotArea)} ft² · built FAR {s.builtFar.toFixed(1)} of {s.maxFar.toFixed(1)}{s.historic ? ' · historic district' : ''}</small></span>
            <span className="row-price">{fmtNum(s.air)}<small>ft² unused</small></span><ChevronRight size={16} className="chev" /></button>))}</div>
      </>}
    </div>);
}
