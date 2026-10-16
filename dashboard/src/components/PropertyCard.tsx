import type { MatchItem, RuleStatus } from '../types';
import { beds, rentLabel, RULE_LABEL } from '../lib/format';

const ICON: Record<RuleStatus, string> = { satisfied: '✓', not_satisfied: '✕', adjusted: '~', unknown: '?' };
const WORD: Record<RuleStatus, string> = { satisfied: 'Satisfied', not_satisfied: 'Not satisfied', adjusted: 'Adjusted', unknown: 'Unknown' };

export function PropertyCard({ m, selected, onSelect, tier }: { m: MatchItem; selected: boolean; onSelect: () => void; tier: 'exact' | 'stretch' }) {
  const l = m.listing; const r = rentLabel(l);
  return (
    <article className={`prop ${selected ? 'sel' : ''} ${tier}`} aria-labelledby={`h-${l.id}`}>
      <button className="prop-head" onClick={onSelect} aria-pressed={selected} aria-describedby={`d-${l.id}`}>
        <div className="prop-title">
          <h3 id={`h-${l.id}`}>{l.building_name} <span className="unitno">#{l.unit}</span></h3>
          <p id={`d-${l.id}`} className="addr">{l.address}, {l.city}, {l.state} {l.zip}</p>
        </div>
        <div className="price"><b>{r.main}</b><small className={r.strong ? 'ne' : undefined}>{r.note}</small></div>
      </button>
      <div className="chips">
        <span className="chip">{beds(l.beds)}</span><span className="chip">{l.baths} ba</span>
        {l.sqft && <span className="chip">{l.sqft} ft²</span>}
        {l.available_now ? <span className="chip now">Available now</span> : l.available_date && <span className="chip">Avail. {l.available_date}</span>}
        {l.unverified && <span className="chip subtle" title="Broker must verify details (e.g. pet policy) before showing">Unverified</span>}
        {l.source_flags?.includes('owner_opposes_scraping') && <span className="chip subtle agent-flag" title="Agent only: owner's terms oppose scraping. Remove first if the owner objects.">Owner opposes scraping · agent only</span>}
        {l.source_flags?.filter((f) => f !== 'owner_opposes_scraping').map((f) => <span key={f} className="chip subtle agent-flag" title="Agent-only source flag">{f.replace(/_/g, ' ')} · agent only</span>)}
        <span className="chip score" title="Ranking score (0–100)">Score {Math.round(m.score)}</span>
      </div>
      <ul className="checklist" aria-label="Requirement checklist">
        {m.checklist.map((c) => (
          <li key={c.rule} className={c.status}>
            <span className="ico" aria-hidden="true">{ICON[c.status]}</span>
            <span className="rule">{RULE_LABEL[c.rule] ?? c.rule}</span>
            <span className="sr-only">{WORD[c.status]}:</span>
            <span className="det">{c.detail}</span>
          </li>
        ))}
      </ul>
      {m.travel.length > 0 && (
        <p className="travel">{m.travel.map((t) => `${t.label} ~${t.minutes ?? '?'} min`).join(' · ')} <span className="est">estimate, straight-line</span></p>
      )}
      <p className="foot">
        {l.needs_verification && <span>Needs verification · </span>}Checked {l.checked_at} · <a href={l.source_url} target="_blank" rel="noreferrer">Source<span className="sr-only"> (opens new tab)</span></a>
        {l.fee_info && <span className="fee"> · {l.fee_info}</span>}
      </p>
    </article>
  );
}
