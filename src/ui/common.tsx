// Small shared UI pieces: subway bullets, value badges, stat tiles, range bars, sparklines, skeletons.
import type { ReactNode } from 'react';
import type { Transit } from '../lib/transit';

export const fmtPrice = (n?: number) => n == null || !isFinite(n) ? '–' : n >= 999500 ? `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : `$${Math.round(n / 1000)}K`;
export const fmtPpsf = (n?: number) => n == null || !isFinite(n) ? '–' : `$${Math.round(n).toLocaleString()}`;
export const fmtNum = (n?: number) => n == null || !isFinite(n) ? '–' : Math.round(n).toLocaleString();
export const fmtDate = (iso?: string) => iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '';
export const fmtMin = (s: number) => `${Math.max(1, Math.round(s / 60))} min`;
export const title = (s = '') => s.toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\b(Ny|Nyc|Us)\b/g, m => m.toUpperCase());

/** Official MTA route bullet. */
export function Bullet({ route, transit, size = 20 }: { route: string; transit?: Transit; size?: number }) {
  const r = transit?.routes[route]; const label = route.replace(/X$/, '');
  return <span className={`bullet ${route.endsWith('X') ? 'diamond' : ''}`} style={{ background: r?.color ?? '#808183', color: r?.text ?? '#fff', width: size, height: size, fontSize: size * 0.58 }} title={r?.name ?? route}>{label === 'GS' || label === 'FS' || label === 'H' ? 'S' : label}</span>;
}

/** "12% below market" style badge. delta = % vs market (negative = cheaper). */
export function ValueBadge({ delta, small }: { delta?: number; small?: boolean }) {
  if (delta == null || !isFinite(delta)) return null;
  const d = Math.round(delta), cls = d <= -5 ? 'good' : d >= 5 ? 'bad' : 'even';
  return <span className={`vbadge ${cls} ${small ? 'sm' : ''}`}>{Math.abs(d) < 3 ? 'At market' : `${Math.abs(d)}% ${d < 0 ? 'below' : 'above'}`}</span>;
}

export function Stat({ k, v, sub, accent }: { k: ReactNode; v: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return <div className={`stat ${accent ? 'accent' : ''}`}><small>{k}</small><b>{v}</b>{sub && <em>{sub}</em>}</div>;
}

/** Low–high range with the median tick and an optional marker (e.g. the asking price). */
export function RangeBar({ low, mid, high, mark, fmt = fmtPrice }: { low: number; mid: number; high: number; mark?: number; fmt?: (n: number) => string }) {
  const lo = Math.min(low, mark ?? low) * 0.96, hi = Math.max(high, mark ?? high) * 1.04, x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="rangebar" aria-label={`Market range ${fmt(low)} to ${fmt(high)}, median ${fmt(mid)}`}>
      <div className="rb-track"><i className="rb-band" style={{ left: x(low), width: `calc(${x(high)} - ${x(low)})` }} /><i className="rb-mid" style={{ left: x(mid) }} />
        {mark != null && <i className="rb-mark" style={{ left: x(mark) }} title={`Asking ${fmt(mark)}`} />}</div>
      <div className="rb-labels"><span>{fmt(low)}</span><b style={{ left: x(mid) }}>{fmt(mid)}</b><span>{fmt(high)}</span></div>
    </div>);
}

/** Minimal SVG line/bar chart for monthly series. */
export function Spark({ values, labels, bars, height = 64, fmt = fmtNum }: { values: (number | undefined)[]; labels?: string[]; bars?: number[]; height?: number; fmt?: (n: number) => string }) {
  const W = 300, H = height, pad = 4, vs = values.filter((v): v is number => v != null && isFinite(v));
  if (vs.length < 2) return <div className="muted small">Not enough data</div>;
  const min = Math.min(...vs), max = Math.max(...vs), bmax = Math.max(1, ...(bars ?? [1]));
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (values.length - 1), y = (v: number) => H - 14 - ((v - min) / (max - min || 1)) * (H - 26);
  const d = values.map((v, i) => v == null ? '' : `${values.slice(0, i).some(u => u != null) ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Trend from ${fmt(vs[0])} to ${fmt(vs[vs.length - 1])}`}>
      {bars?.map((b, i) => <rect key={i} x={x(i) - 5} width={10} y={H - 12 - (b / bmax) * (H * 0.45)} height={(b / bmax) * (H * 0.45)} rx={2} className="spark-bar" />)}
      <path d={d} className="spark-line" />
      {values.map((v, i) => v != null && i === values.length - 1 && <circle key={i} cx={x(i)} cy={y(v)} r={3.5} className="spark-dot" />)}
      {labels && [0, labels.length - 1].map(i => <text key={i} x={x(i)} y={H - 1} textAnchor={i ? 'end' : 'start'} className="spark-label">{labels[i]}</text>)}
    </svg>);
}

export const Skel = ({ w = '60%' }: { w?: string }) => <i className="skel" style={{ width: w }} />;
export function Section({ id, icon, title: t, children, aside }: { id: string; icon: ReactNode; title: string; children: ReactNode; aside?: ReactNode }) {
  return <section className="sec" id={`sec-${id}`} data-sec={id}><h3>{icon}{t}{aside && <span className="sec-aside">{aside}</span>}</h3>{children}</section>;
}
export function Note({ children }: { children: ReactNode }) { return <p className="note">{children}</p>; }
