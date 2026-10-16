// Sample-response layer: implements contract v1 + Bill's Oct 16 rulings over the real listings (trial-10 + poc-100),
// so the UI works without the API. Output conforms exactly to MatchResponse.
import type { Feature, FeatureCollection } from 'geojson';
import raw from './listings.json';
import type { BentRule, ChecklistItem, Listing, MatchItem, MatchRequest, MatchResponse, Pets, PetsPolicy, RuleName } from '../types';
import { estMinutes, hull } from '../lib/geo';
import { budgetPrice, grossOf } from '../lib/format';

export const LISTINGS = raw as Listing[];
const LIMITS = { budgetPct: 10, beds: 2, baths: 1, early: 30, late: 10, staleDays: 7 };
const LIMIT_TEXT: Record<string, string> = { budget: '+10% budget', beds: '±2 bedrooms', baths: '±1 bathroom', move_in: '30 days early / 10 days late' };
const usd = (n: number) => `$${n.toLocaleString('en-US')}`;
const DAY = 864e5;
const days = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
const pl = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Stale = checked_at older than listing_stale_days (exactly 7 days old still matches). */
export const isStale = (l: Listing, ref = today()) => l.stale || days(ref, l.checked_at) > LIMITS.staleDays;

function petsOk(p: Pets, pol: PetsPolicy): boolean | null {
  if (p === 'none') return true;
  if (pol === 'unknown') return true;          // contract: blank policy = allowed (pets_assumed)
  if (pol === 'allowed') return true;
  if (pol === 'none') return false;
  return p === 'cat' ? pol === 'cats' : p === 'dog' ? pol === 'dogs' : false;
}

export function mockMatch(req: MatchRequest): MatchResponse {
  const { hard_rules: h, destinations, preferences } = req;
  const exact: MatchItem[] = [], stretch: MatchItem[] = [];
  const bent = new Map<string, BentRule>();
  const needs_location: Listing[] = [];
  const ex = { stale: 0, locked_rule: 0, out_of_limits: 0, no_geocode: 0 };

  for (const l of LISTINGS) {
    if (isStale(l)) { ex.stale++; continue; }
    if (l.lat == null || l.lng == null) { ex.no_geocode++; needs_location.push(l); continue; }
    const c: ChecklistItem[] = []; const bends: RuleName[] = []; let out = false;
    const add = (rule: RuleName, status: ChecklistItem['status'], detail: string) => { c.push({ rule, status, detail }); if (status === 'adjusted') bends.push(rule); if (status === 'not_satisfied') out = true; };

    // pets (LOCKED). Assistance animal never excludes a no-pet building.
    const po = petsOk(h.pets, l.pets_policy);
    if (po === false) { ex.locked_rule++; continue; }
    const aa = h.assistance_animal ? ' · assistance animal is an accommodation, never excludes' : '';
    add('pets', po ? 'satisfied' : 'unknown', (h.pets === 'none' ? 'No pets' : l.pets_assumed ? 'Yes (assumed): pet policy not listed, treated as allowed' : `Policy "${l.pets_policy}" fits ${h.pets.replace(/_/g, ' ')}`) + aa);

    // destination (LOCKED)
    const travel = destinations.map((d) => ({ label: d.label, minutes: estMinutes([l.lng!, l.lat!], [d.lng, d.lat]) as number | null }));
    if (destinations.some((d, i) => (travel[i].minutes ?? Infinity) > d.max_minutes)) { ex.locked_rule++; continue; }
    if (destinations.length) add('destination', 'satisfied', travel.map((t, i) => `${t.label} ~${t.minutes} min estimate (max ${destinations[i].max_minutes})`).join('; '));

    // budget
    // contract: budget is checked on gross_rent ?? rent
    const price = budgetPrice(l); const lbl = `${usd(price)}${grossOf(l) != null ? ' gross' : ''}`;
    const pct = ((price - h.budget_max) / h.budget_max) * 100;
    if (pct <= 0) add('budget', 'satisfied', `${lbl} within ${usd(h.budget_max)}`);
    else add('budget', pct <= LIMITS.budgetPct ? 'adjusted' : 'not_satisfied', `${lbl} vs budget ${usd(h.budget_max)} (+${pct.toFixed(1)}%)`);

    // beds: more than asked = satisfied (ruling); fewer up to 2 = adjusted. beds_max (if sent) treated the same way, up to 2 over.
    const bd = (n: number) => (n === 0 ? 'studio' : `${n} bd`);
    if (l.beds >= h.beds_min && (h.beds_max == null || l.beds <= h.beds_max || pct <= 0))
      add('beds', 'satisfied', l.beds > h.beds_min ? `${bd(l.beds)}, more than ${bd(h.beds_min)} asked` : `${bd(l.beds)} as asked`);
    else { const gap = l.beds < h.beds_min ? h.beds_min - l.beds : l.beds - h.beds_max!;
      add('beds', gap <= LIMITS.beds ? 'adjusted' : 'not_satisfied', `${bd(l.beds)} vs ${bd(h.beds_min)} asked (${l.beds < h.beds_min ? '−' : '+'}${gap})`); }

    // baths (can bend together with beds; each listed)
    if (h.baths_min != null) {
      const gap = h.baths_min - l.baths;
      if (gap <= 0) add('baths', 'satisfied', `${l.baths} ba, ${h.baths_min} asked`);
      else add('baths', gap <= LIMITS.baths ? 'adjusted' : 'not_satisfied', `${l.baths} ba vs ${h.baths_min} asked (−${gap})`);
    }

    // move-in: on/before move-in up to 30 days early = exact; up to 10 days late = stretch; blank date = unknown
    if (!l.available_date) add('move_in', 'unknown', 'Availability date not listed');
    else {
      const d = days(l.available_date, h.move_in_date); const when = l.available_now ? 'Available now' : `Available ${l.available_date}`;
      if (d <= 0 && d >= -LIMITS.early) add('move_in', 'satisfied', d ? `${when}, ${pl(-d, 'day')} before move-in` : `${when}, on move-in`);
      else if (d > 0 && d <= LIMITS.late) add('move_in', 'adjusted', `${when}, ${pl(d, 'day')} after move-in`);
      else add('move_in', 'not_satisfied', `${when} (${d > 0 ? `${pl(d, 'day')} late` : `${pl(-d, 'day')} early`})`);
    }
    if (out) { ex.out_of_limits++; continue; }

    const order: RuleName[] = ['budget', 'beds', 'baths', 'move_in', 'pets', 'destination'];
    c.sort((a, b) => order.indexOf(a.rule) - order.indexOf(b.rule));
    const item: MatchItem = { listing: l, score: score(l, h.budget_max, travel, destinations, preferences?.tags ?? [], bends.length), checklist: c, travel };
    if (bends.length) { stretch.push(item); for (const r of bends) { const b = bent.get(r) ?? { rule: r, limit: LIMIT_TEXT[r], listing_ids: [] }; b.listing_ids.push(l.id); bent.set(r, b); } }
    else exact.push(item);
  }
  exact.sort((a, b) => b.score - a.score); stretch.sort((a, b) => b.score - a.score);

  // area_geojson: hull of exact (tier=exact) and hull of exact+stretch (tier=stretch), plus Point per listing.
  const pt = (m: MatchItem) => [m.listing.lng!, m.listing.lat!] as [number, number];
  const feats: Feature[] = [];
  const poly = (pts: [number, number][], tier: string) => { const hp = hull(pts); if (hp.length >= 3) feats.push({ type: 'Feature', properties: { tier }, geometry: { type: 'Polygon', coordinates: [[...hp, hp[0]]] } }); };
  poly([...exact, ...stretch].map(pt), 'stretch'); poly(exact.map(pt), 'exact');
  for (const [tier, list] of [['exact', exact], ['stretch', stretch]] as const)
    for (const m of list) feats.push({ type: 'Feature', properties: { tier, listing_id: m.listing.id }, geometry: { type: 'Point', coordinates: pt(m) } });
  const area_geojson: FeatureCollection = { type: 'FeatureCollection', features: feats };
  return { run_id: `sample_${Date.now().toString(36)}`, generated_at: new Date().toISOString(), exact, stretch, bent_rules: [...bent.values()], area_geojson, needs_location, excluded_count: ex };
}

/** Ranking only. Preferences never filter. */
function score(l: Listing, budget: number, travel: { minutes: number | null }[], dests: { max_minutes: number }[], tags: string[], nBends: number) {
  let s = 60 + Math.max(0, (budget - budgetPrice(l)) / budget) * 20;
  travel.forEach((t, i) => (s += (1 - (t.minutes ?? dests[i].max_minutes) / dests[i].max_minutes) * 10));
  const eastVillage = l.lng! > -73.985 && l.lat! < 40.737, midtown = l.lat! > 40.738;
  if (tags.includes('eats_out') && (midtown || eastVillage)) s += 4;
  if (tags.includes('home_cook') && (l.state === 'NJ' || l.lat! < 40.71)) s += 3;
  if (tags.includes('goes_out') && (eastVillage || l.lat! < 40.745 && l.lng! < -73.99)) s += 4;
  if (tags.includes('stays_in') && (l.sqft ?? 0) > 700) s += 3;
  return Math.round(Math.min(100, s - nBends * 8));
}
