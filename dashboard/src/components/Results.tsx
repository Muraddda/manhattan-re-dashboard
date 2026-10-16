import { useState } from 'react';
import type { MatchResponse } from '../types';
import { PropertyCard } from './PropertyCard';
import { RULE_LABEL, beds, rentLabel } from '../lib/format';

export function Results({ data, source, reason, selected, onSelect }: { data: MatchResponse; source: 'api' | 'sample'; reason?: string; selected: string | null; onSelect: (id: string) => void }) {
  const [tab, setTab] = useState<'exact' | 'stretch'>('exact');
  const list = tab === 'exact' ? data.exact : data.stretch;
  const ex = data.excluded_count;
  const key = (e: React.KeyboardEvent) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const t = tab === 'exact' ? 'stretch' : 'exact'; setTab(t); document.getElementById(`tab-${t}`)?.focus(); } };
  return (
    <section className="results" aria-label="Match results">
      {source === 'sample' && <div className="sample" role="status"><b>Sample response</b> · API unreachable, results computed locally from the real listings (Data Analyst CSVs).{reason && <small> ({reason})</small>}</div>}
      <div className="tabs" role="tablist" aria-label="Result tiers" onKeyDown={key}>
        <button role="tab" id="tab-exact" aria-selected={tab === 'exact'} aria-controls="panel" tabIndex={tab === 'exact' ? 0 : -1} onClick={() => setTab('exact')}>Exact <span className="count">{data.exact.length}</span></button>
        <button role="tab" id="tab-stretch" aria-selected={tab === 'stretch'} aria-controls="panel" tabIndex={tab === 'stretch' ? 0 : -1} onClick={() => setTab('stretch')}>Stretch <span className="count">{data.stretch.length}</span> <span className="agent">agent only</span></button>
      </div>
      <div id="panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'stretch' && (
          <div className="bent card soft">
            <p className="sub">What was bent, and why it is still in range</p>
            {data.bent_rules.length === 0 ? <p className="hint">Nothing needed bending.</p> : (
              <ul>{data.bent_rules.map((b) => <li key={b.rule}><b>{RULE_LABEL[b.rule] ?? b.rule}</b> <span className="hint">limit {b.limit}</span> · {b.listing_ids.length} unit{b.listing_ids.length === 1 ? '' : 's'}</li>)}</ul>
            )}
            <p className="hint">Limits: budget +10%, beds ±2 or baths ±1, availability 30 days early to 10 days late. Pets and commute never bent. Do not share this list with clients.</p>
          </div>
        )}
        <p className="excl hint">Excluded: {ex.locked_rule} locked rule · {ex.out_of_limits} out of limits · {ex.stale} stale · {ex.no_geocode} no location</p>
        <div className="legend-map" aria-label="Map legend"><span className="sw ex" />Exact area <span className="sw st" />Stretch area <span className="sw dot" />Stretch unit</div>
        {list.length === 0 ? <p className="empty">No {tab} matches. {tab === 'exact' ? 'Check the Stretch tab.' : ''}</p> :
          list.map((m) => <PropertyCard key={m.listing.id} m={m} tier={tab} selected={selected === m.listing.id} onSelect={() => onSelect(m.listing.id)} />)}
      </div>
      {(data.needs_location?.length ?? 0) > 0 && (
        <details className="needsloc card">
          <summary>Needs location <span className="count">{data.needs_location.length}</span> <span className="hint">no coordinates, excluded from matching</span></summary>
          <ul>{data.needs_location.map((l) => <li key={l.id}><b>{l.building_name}</b> #{l.unit} · {l.address} · {beds(l.beds)} · {rentLabel(l).main}{l.unverified && <span className="chip subtle">Unverified</span>}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
