import type { PetsPolicy, RentBasis } from "./types";

export function normalizePets(raw: string | null | undefined): PetsPolicy {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return "unknown";
  if (["allowed", "all", "yes", "pets allowed", "pet friendly", "pet-friendly", "cats and dogs", "cats & dogs", "dogs and cats"].includes(s)) return "allowed";
  if (/^(no|none|no pets|not allowed|pets not allowed)$/.test(s)) return "none";
  const cats = /\bcats?\b/.test(s), dogs = /\bdogs?\b/.test(s);
  if (/\bno\b/.test(s)) { if (cats && !dogs) return "dogs"; if (dogs && !cats) return "cats"; return "none"; } // "no dogs" -> cats only
  if (cats && dogs) return "allowed";
  if (cats) return "cats";
  if (dogs) return "dogs";
  if (/allow|friendly|welcome/.test(s)) return "allowed";
  return "unknown";
}

const NOW_RE = /^(now|immediate|immediately|available now)$/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** Blank -> null (not inferred). 'Now'/'Immediate' -> checked_at + available_now. 'Nov 3' -> next occurrence on/after checked_at.
 *  Returns null when the text cannot be parsed. */
export function normalizeAvailability(raw: string | null | undefined, checked_at: string): { available_date: string | null; available_now: boolean } | null {
  const s = (raw ?? "").trim();
  if (!s) return { available_date: null, available_now: false };
  if (NOW_RE.test(s)) return { available_date: checked_at, available_now: true };
  const md = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})$/);
  if (md && MONTHS.includes(md[1].slice(0, 3).toLowerCase()) && /^\d{4}-\d{2}-\d{2}$/.test(checked_at)) {
    const mm = String(MONTHS.indexOf(md[1].slice(0, 3).toLowerCase()) + 1).padStart(2, "0"), dd = md[2].padStart(2, "0");
    let y = Number(checked_at.slice(0, 4)); let d = `${y}-${mm}-${dd}`;
    if (d < checked_at) d = `${++y}-${mm}-${dd}`;
    return isNaN(Date.parse(d)) ? null : { available_date: d, available_now: false };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { available_date: s, available_now: false };
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return { available_date: `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`, available_now: false };
  return null;
}

const UDR = ["95 wall", "10 hanover square", "21 chelsea", "view 34"];
const NEWPORT = ["ellipse", "bisby", "parkside west"];
const OWNER_BASIS: Record<string, RentBasis> = { udr: "lowest_term", lefrak: "base_before_fees" };
/** Gross rent stated in notes ("gross rent $8,075", "gross price $3,505"). Never guessed. */
export function grossFromNotes(notes: string | null | undefined): number | null {
  const m = (notes ?? "").match(/gross (?:rent|price)\s*(?:of|is|:)?\s*\$([\d,]+)/i);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}
/** Owner from a buildings-log owner cell or notes. "Newport Rentals (LeFrak)" -> "LeFrak"; "unknown (...)" -> null. */
export function normalizeOwner(raw: string | null | undefined, notes?: string | null, buildingName?: string): string | null {
  const s = (raw ?? "").trim();
  if (/lefrak/i.test(s) || /\(lefrak\)/i.test(notes ?? "") || /\(newport rentals\)/i.test(buildingName ?? "")) return "LeFrak";
  if (!s || /^unknown/i.test(s)) return null;
  return s.replace(/\s*\(developer site\)\s*$/i, "");
}
/** Source flags for a row: note text "owner opposes scraping" (any case) or owner LeFrak. */
export function sourceFlags(notes: string | null | undefined, owner: string | null): string[] {
  const f = new Set<string>();
  if (/owner opposes scraping/i.test(notes ?? "") || owner === "LeFrak") f.add("owner_opposes_scraping");
  return [...f];
}
/** Basis stated in a row's notes, if any. */
export function rentBasisFromNotes(notes: string | null | undefined): RentBasis | null {
  const n = (notes ?? "").toLowerCase();
  // includes hedged "may reflect net-effective" (Halletts Point), per Bill/Arthur
  if (/(net[- ]effective|net rent shown)/.test(n)) return "net_effective";
  if (/lowest base rent/.test(n)) return "lowest_term";
  if (/\b(12|twelve)[- ]month\b/.test(n)) return "twelve_month";
  if (/^base rent shown|base rent; .*asterisked total|base rent shown/.test(n)) return "base_before_fees";
  return null;
}
/** Precedence: row notes > owner (buildings-log) > building-name rule > 'listed'. */
export function rentBasis(buildingName: string, notes?: string | null, owner?: string | null): RentBasis {
  const o = normalizeOwner(owner, null, buildingName);
  return rentBasisFromNotes(notes) ?? (o ? OWNER_BASIS[o.toLowerCase()] : undefined) ?? rentBasisFor(buildingName);
}
export function rentBasisFor(buildingName: string): RentBasis {
  const n = buildingName.toLowerCase();
  if (n.startsWith("stuytown") || n.includes("peter cooper village")) return "twelve_month";
  if (UDR.some((u) => n.startsWith(u))) return "lowest_term";
  if (NEWPORT.some((u) => n.startsWith(u))) return "base_before_fees";
  return "listed";
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let f = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...rest] = rows.filter((r) => r.some((x) => x.trim() !== ""));
  if (!h) return [];
  return rest.map((r) => Object.fromEntries(h.map((k, i) => [k.trim(), (r[i] ?? "").trim()])));
}
