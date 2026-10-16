// Market tab: last-12-month Manhattan numbers, monthly trend, 10-year $/ft² history and a sortable neighborhood table.
import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Spark, Stat, fmtNum, fmtPpsf, fmtPrice } from './common';
import { marketTrend, percentile } from '../lib/value';
import { typeOf } from '../lib/sales';
import type { PropType } from '../model';

export function Market() {
  const { data } = useApp(); const [type, setType] = useState<PropType>('condo'); const [sort, setSort] = useState<'n' | 'price' | 'ppsf'>('n');
  const sales = useMemo(() => data.sales.filter(s => s.type === type), [data.sales, type]);
  const trend = useMemo(() => marketTrend(sales), [sales]);
  const hoods = useMemo(() => {
    const m = new Map<string, number[][]>();
    for (const s of sales) { const e = m.get(s.neighborhood) ?? [[], []]; e[0].push(s.price); if (s.ppsf) e[1].push(s.ppsf); m.set(s.neighborhood, e); }
    return [...m].filter(([, [p]]) => p.length >= 5).map(([hood, [p, f]]) => ({ hood, n: p.length, price: percentile(p, 50), ppsf: f.length >= 5 ? percentile(f, 50) : undefined }));
  }, [sales]);
  const rows = [...hoods].sort((a, b) => sort === 'n' ? b.n - a.n : sort === 'price' ? b.price - a.price : (b.ppsf ?? 0) - (a.ppsf ?? 0));
  const ppsfs = sales.map(s => s.ppsf).filter((x): x is number => !!x);
  // 10 years: average price by year for the same residential categories the sales use (DOF only records unit sqft
  // for condos in a couple of years, so a $/ft² history would be driven by commercial units).
  const years = useMemo(() => {
    const by = new Map<number, { p: number; n: number }>();
    for (const r of data.trends) if (typeOf(r.category) === type) { const e = by.get(r.year) ?? { p: 0, n: 0 }; e.p += r.sumPrice; e.n += r.n; by.set(r.year, e); }
    return [...by].sort((a, b) => a[0] - b[0]).map(([y, e]) => ({ y, avg: e.n ? e.p / e.n : undefined, n: e.n }));
  }, [data.trends, type]);
  const max = Math.max(1, ...rows.map(r => sort === 'ppsf' ? r.ppsf ?? 0 : sort === 'price' ? r.price : r.n));
  return (
    <div className="market">
      <div className="seg3" role="radiogroup" aria-label="Home type">{(['condo', 'coop', 'townhouse'] as PropType[]).map(t => <button key={t} role="radio" aria-checked={type === t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>{t === 'coop' ? 'Co-ops' : t === 'condo' ? 'Condos' : 'Townhouses'}</button>)}</div>
      <div className="stats">
        <Stat k="Sales, 12 mo" v={fmtNum(sales.length)} />
        <Stat k="Median price" v={fmtPrice(percentile(sales.map(s => s.price), 50))} />
        <Stat k="Median $/ft²" v={ppsfs.length >= 5 ? fmtPpsf(percentile(ppsfs, 50)) : '–'} sub={type === 'coop' ? 'Co-op sales record no size' : undefined} />
      </div>
      <section><h3>Last 12 months <small>median {ppsfs.length >= 20 ? '$/ft²' : 'price'} · bars = sales</small></h3>
        <Spark values={trend.map(t => ppsfs.length >= 20 ? t.medianPpsf : t.medianPrice)} bars={trend.map(t => t.n)} labels={trend.map(t => t.month)} fmt={ppsfs.length >= 20 ? fmtPpsf : fmtPrice} height={90} /></section>
      {years.length > 2 && <section><h3>10 years <small>average sale price by year · bars = sales (DOF annualized sales)</small></h3>
        <Spark values={years.map(y => y.avg)} bars={years.map(y => y.n)} labels={years.map(y => String(y.y))} fmt={fmtPrice} height={90} /></section>}
      <section><h3>By neighborhood <span className="sorter">{(['n', 'price', 'ppsf'] as const).map(k => <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>{k === 'n' ? 'Sales' : k === 'price' ? 'Price' : '$/ft²'}</button>)}</span></h3>
        <div className="hbars">{rows.slice(0, 40).map((r, i) => (
          <button key={r.hood} className="hbar" style={{ ['--i' as string]: Math.min(i, 15) }} onClick={() => window.dispatchEvent(new CustomEvent('skyline:hood', { detail: r.hood }))} title={`Show ${r.hood} homes`}>
            <span className="hb-label">{r.hood}<small>{r.n} sales · {r.ppsf ? `${fmtPpsf(r.ppsf)}/ft²` : fmtPrice(r.price)}</small></span>
            <span className="hb-track"><i style={{ width: `${((sort === 'ppsf' ? r.ppsf ?? 0 : sort === 'price' ? r.price : r.n) / max) * 100}%` }} /></span>
            <b>{sort === 'n' ? r.n : sort === 'price' ? fmtPrice(r.price) : fmtPpsf(r.ppsf)}</b></button>))}</div></section>
    </div>);
}
