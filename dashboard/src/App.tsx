import { useCallback, useRef, useState } from 'react';
import { MapView } from './components/MapView';
import { ClientForm } from './components/ClientForm';
import { Results } from './components/Results';
import { ApiError, postMatch, type MatchResult } from './lib/api';
import type { Destination, MatchRequest } from './types';

type Sheet = 'peek' | 'half' | 'full';
export default function App() {
  const [result, setResult] = useState<MatchResult | null>(null);
  const [dests, setDests] = useState<Destination[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'form' | 'results'>('form');
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>('half');
  const abort = useRef<AbortController | null>(null);

  async function run(req: MatchRequest) {
    abort.current?.abort(); const ac = new AbortController(); abort.current = ac;
    setBusy(true); setError(null);
    try { const r = await postMatch(req, ac.signal); setResult(r); setDests(req.destinations); setSelected(null); setView('results'); }
    catch (e) { if ((e as Error).name !== 'AbortError') setError(e instanceof ApiError ? `${e.code}: ${e.message}` : (e as Error).message); }
    finally { setBusy(false); }
  }
  const select = useCallback((id: string) => { setSelected(id); setView('results'); requestAnimationFrame(() => document.getElementById(`h-${id}`)?.closest('article')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })); }, []);
  const cycle = () => setSheet((s) => (s === 'peek' ? 'half' : s === 'half' ? 'full' : 'peek'));

  return (
    <div className="app">
      <a href="#panel-body" className="skip">Skip to panel</a>
      <MapView data={result?.data ?? null} destinations={dests} selected={selected} onSelect={select} />
      <div className="aura" aria-hidden="true" />
      <aside className={`panel sheet-${sheet}`} aria-label="Search and results">
        <button className="grab" onClick={cycle} aria-label={`Resize panel (currently ${sheet})`}><span /></button>
        <header className="brand">
          <div className="logo" aria-hidden="true">M</div>
          <div><b>M.Mardan &amp; Co.</b><small>Agent match desk · NYC + NJ</small></div>
          {result && <span className={`src ${result.source}`}>{result.source === 'api' ? 'Live API' : 'Sample response'}</span>}
        </header>
        <nav className="views" aria-label="Panel view">
          <button aria-current={view === 'form' ? 'page' : undefined} onClick={() => setView('form')}>Client</button>
          <button aria-current={view === 'results' ? 'page' : undefined} disabled={!result} onClick={() => setView('results')}>Results{result && <span className="count">{result.data.exact.length}</span>}</button>
        </nav>
        <div id="panel-body" className="panel-body" tabIndex={-1}>
          {error && <p className="error" role="alert">{error}</p>}
          <div hidden={view !== 'form'}><ClientForm onSubmit={run} busy={busy} /></div>
          {result && view === 'results' && <Results data={result.data} source={result.source} reason={result.reason} selected={selected} onSelect={select} />}
        </div>
      </aside>
    </div>
  );
}
