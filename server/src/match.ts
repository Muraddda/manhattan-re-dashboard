import type { BentRule, ChecklistItem, Destination, ExcludedCount, HardRules, Listing, MatchItem, Preferences, Rule } from "./types";

export const LIMITS = { budget_over_pct: 10, beds_diff: 2, baths_diff: 1, move_in_early_days: 30, move_in_late_days: 10 } as const;
export const SPEED_KMH = 20;

const DAY = 86_400_000;
const toDay = (d: string) => Date.parse(d + "T00:00:00Z");
const fromDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const bedsLabel = (b: number) => (b === 0 ? "studio" : plural(b, "bed"));

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (x: number) => (x * Math.PI) / 180, R = 6371.0088;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export const travelMinutes = (km: number) => (km / SPEED_KMH) * 60;

/** checked_at older than staleDays (strictly) relative to today => stale. */
export function isStale(checked_at: string, today: string, staleDays: number): boolean {
  return (toDay(today) - toDay(checked_at)) / DAY > staleDays;
}

export const budgetRent = (l: Pick<Listing, "rent" | "gross_rent">) => l.gross_rent ?? l.rent;
type Eval = { checklist: ChecklistItem[]; travel: { label: string; minutes: number | null }[]; locked: boolean; out: boolean; noGeo: boolean; bent: Rule[] };

export function evaluate(l: Listing, hr: HardRules, dests: Destination[], today: string): Eval {
  const c: ChecklistItem[] = []; let locked = false, out = false, noGeo = false; const bent: Rule[] = [];
  const add = (rule: Rule, status: ChecklistItem["status"], detail: string) => {
    c.push({ rule, status, detail });
    if (status === "adjusted") bent.push(rule);
  };

  // budget: checked on gross_rent when stated (net_effective rows), else rent
  const br = budgetRent(l);
  const fig = l.gross_rent != null ? `${money(l.gross_rent)} gross (${money(l.rent)} net effective)` : money(l.rent);
  const pct = ((br - hr.budget_max) / hr.budget_max) * 100;
  if (br <= hr.budget_max) add("budget", "satisfied", `${fig} vs budget ${money(hr.budget_max)}`);
  else if (br * 100 <= hr.budget_max * (100 + LIMITS.budget_over_pct)) add("budget", "adjusted", `${fig} vs budget ${money(hr.budget_max)} (+${pct.toFixed(1)}%)`);
  else { out = true; add("budget", "not_satisfied", `${fig} vs budget ${money(hr.budget_max)} (+${pct.toFixed(1)}%, over the +${LIMITS.budget_over_pct}% limit)`); }

  // beds
  const bmax = hr.beds_max ?? Infinity;
  const want = hr.beds_max != null && hr.beds_max !== hr.beds_min ? `${hr.beds_min}-${hr.beds_max} beds` : hr.beds_max != null ? bedsLabel(hr.beds_min) : `${bedsLabel(hr.beds_min)}+`;
  if (l.beds >= hr.beds_min && l.beds <= bmax) add("beds", "satisfied", `${bedsLabel(l.beds)} vs wanted ${want}`);
  else {
    const diff = l.beds < hr.beds_min ? hr.beds_min - l.beds : l.beds - bmax;
    const sign = l.beds < hr.beds_min ? "-" : "+";
    if (diff <= LIMITS.beds_diff) add("beds", "adjusted", `${bedsLabel(l.beds)} vs wanted ${want} (${sign}${diff})`);
    else { out = true; add("beds", "not_satisfied", `${bedsLabel(l.beds)} vs wanted ${want} (${sign}${diff}, over the +/-${LIMITS.beds_diff} limit)`); }
  }

  // baths
  if (hr.baths_min == null) add("baths", "satisfied", `${l.baths} bath (no minimum)`);
  else if (l.baths >= hr.baths_min) add("baths", "satisfied", `${l.baths} bath vs min ${hr.baths_min}`);
  else {
    const diff = hr.baths_min - l.baths;
    if (diff <= LIMITS.baths_diff + 1e-9) add("baths", "adjusted", `${l.baths} bath vs min ${hr.baths_min} (-${diff})`);
    else { out = true; add("baths", "not_satisfied", `${l.baths} bath vs min ${hr.baths_min} (-${diff}, over the ${LIMITS.baths_diff} limit)`); }
  }

  // move-in. Null date = not listed -> 'unknown' (not excluded, not a bend). A past date (incl. available_now units,
  // whose date = checked_at) means available today.
  if (!l.available_date) add("move_in", "unknown", `Move-in date not listed (move-in ${hr.move_in_date}); verify with building`);
  else {
    const eff = l.available_date < today ? today : l.available_date;
    const days = Math.round((toDay(eff) - toDay(hr.move_in_date)) / DAY); // + = after move-in
    const label = l.available_now ? `available now (as of ${l.checked_at})` : l.available_date < today ? `available now (listed ${l.available_date})` : `available ${l.available_date}`;
    if (days <= 0 && -days <= LIMITS.move_in_early_days) add("move_in", "satisfied", `${label}; move-in ${hr.move_in_date}${days < 0 ? ` (${plural(-days, "day")} early)` : ""}`);
    else if (days > 0 && days <= LIMITS.move_in_late_days) add("move_in", "adjusted", `${label}; move-in ${hr.move_in_date} (${plural(days, "day")} late)`);
    else {
      out = true;
      add("move_in", "not_satisfied", days > 0
        ? `${label}; move-in ${hr.move_in_date} (${days} days late, over the ${LIMITS.move_in_late_days}-day limit)`
        : `${label}; move-in ${hr.move_in_date} (${-days} days early, over the ${LIMITS.move_in_early_days}-day limit)`);
    }
  }

  // pets (LOCKED). Assistance animals are not pets: they never exclude a no-pet building.
  const aa = hr.assistance_animal ? "; assistance animal not restricted by pet policy" : "";
  const needCat = hr.pets === "cat" || hr.pets === "cat_and_dog", needDog = hr.pets === "dog" || hr.pets === "cat_and_dog";
  const p = l.pets_policy;
  if (hr.pets === "none") add("pets", "satisfied", `no pets${aa}`);
  else if (p === "unknown") add("pets", "satisfied", `Yes (assumed): pet policy not listed, treated as allowed${aa}`);
  else {
    const ok = (!needCat || p === "allowed" || p === "cats") && (!needDog || p === "allowed" || p === "dogs");
    if (ok) add("pets", "satisfied", `policy '${p}' allows ${hr.pets.replace(/_/g, " ")}${aa}`);
    else { locked = true; add("pets", "not_satisfied", `policy '${p}' does not allow ${hr.pets.replace(/_/g, " ")} (locked)${aa}`); }
  }

  // destinations (LOCKED)
  const travel: Eval["travel"] = [];
  if (l.lat == null || l.lng == null) {
    noGeo = true;
    for (const d of dests) travel.push({ label: d.label, minutes: null });
    add("destination", "unknown", "listing has no coordinates; travel time unknown (needs location)");
  } else if (dests.length === 0) add("destination", "satisfied", "no destinations");
  else {
    const parts: string[] = []; let fail = false;
    for (const d of dests) {
      const raw = travelMinutes(haversineKm(l.lat, l.lng, d.lat, d.lng)); const m = Math.round(raw * 10) / 10;
      travel.push({ label: d.label, minutes: m });
      if (raw > d.max_minutes) fail = true; // raw float compare; exactly max passes
      parts.push(`${d.label}: ~${m} min vs max ${d.max_minutes} (estimate)`);
    }
    if (fail) locked = true;
    add("destination", fail ? "not_satisfied" : "satisfied", parts.join("; ") + (fail ? " (locked)" : ""));
  }
  return { checklist: c, travel, locked, out, noGeo, bent };
}

export function score(l: Listing & { amenities?: string }, hr: HardRules, prefs: Preferences): number {
  const am = (l.amenities ?? "").toLowerCase();
  const tags = (prefs.tags ?? []).filter((t) => t && am.includes(t.toLowerCase())).length;
  const closeness = Math.max(0, 1 - Math.abs(budgetRent(l) - hr.budget_max) / hr.budget_max); // 0..1
  return Math.round((tags * 1000 + closeness * 100) * 100) / 100;
}

export function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...new Map(pts.map((x) => [x.join(","), x])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const x of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], x) <= 0) lo.pop(); lo.push(x); }
  for (const x of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], x) <= 0) up.pop(); up.push(x); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export function areaGeojson(items: { item: MatchItem; tier: "exact" | "stretch" }[]) {
  const features: any[] = [];
  for (const tier of ["exact", "stretch"] as const) {
    const pts = items.filter((x) => x.tier === tier && x.item.listing.lat != null).map((x) => [x.item.listing.lng!, x.item.listing.lat!] as [number, number]);
    const hull = convexHull(pts);
    // < 3 distinct points: no polygon, Point features only
    if (hull.length >= 3) features.push({ type: "Feature", properties: { kind: "area", tier }, geometry: { type: "Polygon", coordinates: [[...hull, hull[0]]] } });
  }
  for (const x of items) {
    const l = x.item.listing; if (l.lat == null || l.lng == null) continue;
    features.push({ type: "Feature", properties: { kind: "listing", listing_id: l.id, tier: x.tier, building_name: l.building_name, unit: l.unit, rent: l.rent }, geometry: { type: "Point", coordinates: [l.lng, l.lat] } });
  }
  return { type: "FeatureCollection", features };
}

const LIMIT_TEXT: Record<string, string> = {
  budget: `up to +${LIMITS.budget_over_pct}% over budget`, beds: `up to ${LIMITS.beds_diff} beds fewer than beds_min (or above beds_max)`, baths: `-${LIMITS.baths_diff} bath`,
  move_in: `available ${LIMITS.move_in_early_days} days before to ${LIMITS.move_in_late_days} days after move-in`,
};

export function runMatch(listings: (Listing & { amenities?: string })[], hr: HardRules, dests: Destination[], prefs: Preferences,
  opts: { today: string; includeStale?: boolean; run_id: string; generated_at: string }) {
  const excluded: ExcludedCount = { stale: 0, locked_rule: 0, out_of_limits: 0, no_geocode: 0 };
  const exact: MatchItem[] = [], stretch: MatchItem[] = [], needs_location: Listing[] = []; const bentMap = new Map<string, string[]>();
  for (const l of listings) {
    if (l.stale && !opts.includeStale) { excluded.stale++; continue; }
    const e = evaluate(l, hr, dests, opts.today);
    if (e.noGeo) { excluded.no_geocode++; { const { amenities: _x, ...nl } = l as any; needs_location.push(nl); } continue; }
    if (e.locked) { excluded.locked_rule++; continue; }
    if (e.out) { excluded.out_of_limits++; continue; }
    const { amenities: _a, ...pub } = l as any;
    const item: MatchItem = { listing: pub, score: score(l, hr, prefs), checklist: e.checklist, travel: e.travel };
    if (e.bent.length === 0) exact.push(item);
    else { stretch.push(item); for (const r of e.bent) bentMap.set(r, [...(bentMap.get(r) ?? []), l.id]); }
  }
  const sort = (a: MatchItem, b: MatchItem) => b.score - a.score || a.listing.rent - b.listing.rent;
  exact.sort(sort); stretch.sort(sort);
  const bent_rules: BentRule[] = [...bentMap].map(([rule, ids]) => ({ rule, limit: LIMIT_TEXT[rule], listing_ids: ids }));
  const area_geojson = areaGeojson([...exact.map((item) => ({ item, tier: "exact" as const })), ...stretch.map((item) => ({ item, tier: "stretch" as const }))]);
  return { run_id: opts.run_id, generated_at: opts.generated_at, exact, stretch, bent_rules, area_geojson, excluded_count: excluded, needs_location };
}
export { fromDay };
