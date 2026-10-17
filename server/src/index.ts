import { runMatch, isStale } from "./match";
import { grossFromNotes, normalizeAvailability, normalizeOwner, normalizePets, parseCsv, rentBasis, rentBasisFor, sourceFlags } from "./normalize";
import type { Destination, HardRules, Listing, Preferences } from "./types";

export interface Env { DB: D1Database; VERSION: string; BROKERAGE_ID: string; TURNSTILE_ENABLED?: string; TURNSTILE_SECRET?: string; TODAY?: string }

class HttpError extends Error { constructor(public status: number, public code: string, msg: string) { super(msg); } }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
const err = (status: number, code: string, message: string) => json({ error: { code, message } }, status);
const id = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
export const todayNY = (env: Env) => env.TODAY || new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s; // rejects 2026-02-30

async function body(req: Request): Promise<any> {
  try { return await req.json(); } catch { throw new HttpError(400, "bad_json", "Request body must be JSON"); }
}
async function staleDays(env: Env): Promise<number> {
  const r = await env.DB.prepare("SELECT listing_stale_days FROM settings WHERE brokerage_id=?").bind(env.BROKERAGE_ID).first<{ listing_stale_days: number }>();
  return r?.listing_stale_days ?? 7;
}

const LISTING_SQL = `SELECT l.*, b.name AS building_name, b.address, b.city, b.state, b.zip, b.lat, b.lng, b.geocode_source, b.owner, b.source_flags AS building_flags
  FROM listings l JOIN buildings b ON b.id = l.building_id WHERE l.brokerage_id = ? AND l.removed_at IS NULL`;
function toListing(r: any, today: string, sd: number): Listing & { amenities: string } {
  return { id: r.id, building_id: r.building_id, building_name: r.building_name, address: r.address, city: r.city, state: r.state, zip: r.zip,
    lat: r.lat, lng: r.lng, unit: r.unit, rent: r.rent, gross_rent: r.gross_rent > 0 ? r.gross_rent : null, beds: r.beds, baths: r.baths, sqft: r.sqft, available_date: r.available_date,
    available_now: !!r.available_now, rent_basis: r.rent_basis, pets_policy: r.pets_policy, fee_info: r.fee_info, leasing_contact: r.leasing_contact,
    source_url: r.source_url, checked_at: r.checked_at, needs_verification: !!r.needs_verification,
    source_flags: [...new Set([...JSON.parse(r.building_flags || "[]"), ...JSON.parse(r.source_flags || "[]")])], owner: r.owner ?? null,
    unverified: !!r.unverified, pets_assumed: r.pets_policy === "unknown", geocode_source: r.geocode_source ?? null, stale: isStale(r.checked_at, today, sd), amenities: r.amenities };
}
const pub = ({ amenities, ...l }: Listing & { amenities?: string }) => l;
async function allListings(env: Env) {
  const sd = await staleDays(env), today = todayNY(env);
  const { results } = await env.DB.prepare(LISTING_SQL + " ORDER BY b.name, l.unit").bind(env.BROKERAGE_ID).all();
  return results.map((r) => toListing(r, today, sd));
}
async function getListing(env: Env, lid: string) {
  const r = await env.DB.prepare(LISTING_SQL + " AND l.id = ?").bind(env.BROKERAGE_ID, lid).first();
  if (!r) throw new HttpError(404, "not_found", `Listing ${lid} not found`);
  return toListing(r, todayNY(env), await staleDays(env));
}

async function findOrCreateBuilding(env: Env, b: { building_name: string; address?: string; city: string; state: string; zip?: string }) {
  const ex = await env.DB.prepare("SELECT id FROM buildings WHERE brokerage_id=? AND name=? AND address=?").bind(env.BROKERAGE_ID, b.building_name, b.address ?? "").first<{ id: string }>();
  if (ex) return ex.id;
  const bid = id("bld");
  // New buildings are not geocoded at write time in the demo (lat/lng null); re-run the seed geocoder to fill them.
  await env.DB.prepare("INSERT INTO buildings (id, brokerage_id, name, address, city, state, zip) VALUES (?,?,?,?,?,?,?)")
    .bind(bid, env.BROKERAGE_ID, b.building_name, b.address ?? "", b.city, b.state, b.zip ?? "").run();
  return bid;
}

const LISTING_FIELDS = ["unit", "rent", "gross_rent", "beds", "baths", "sqft", "available_date", "available_now", "rent_basis", "pets_policy", "fee_info", "leasing_contact", "source_url", "checked_at", "needs_verification"] as const;
function validateListing(b: any, partial: boolean) {
  const req = ["building_name", "city", "state", "unit", "rent", "beds", "baths", "source_url", "checked_at"];
  if (!partial) for (const k of req) if (b[k] == null || b[k] === "") throw new HttpError(400, "validation", `${k} is required`);
  const num = (k: string, int = false) => { if (b[k] != null && (typeof b[k] !== "number" || b[k] < 0 || (int && !Number.isInteger(b[k])))) throw new HttpError(400, "validation", `${k} must be a non-negative ${int ? "integer" : "number"}`); };
  num("rent", true); if (b.gross_rent !== null) num("gross_rent", true); if (b.gross_rent === 0) b.gross_rent = null; num("beds", true);
  if (b.source_flags != null && (!Array.isArray(b.source_flags) || b.source_flags.some((f: any) => typeof f !== "string"))) throw new HttpError(400, "validation", "source_flags must be a string array"); num("baths"); if (b.sqft !== null) num("sqft", true);
  if (b.state != null && !["NY", "NJ"].includes(b.state)) throw new HttpError(400, "validation", "state must be NY or NJ");
  if (b.pets_policy != null && !["allowed", "cats", "dogs", "none", "unknown"].includes(b.pets_policy)) throw new HttpError(400, "validation", "invalid pets_policy");
  if (b.rent_basis != null && !["lowest_term", "base_before_fees", "twelve_month", "net_effective", "listed"].includes(b.rent_basis)) throw new HttpError(400, "validation", "invalid rent_basis");
  if (b.rent_basis != null && b.rent_basis !== "net_effective" && b.gross_rent != null) throw new HttpError(400, "validation", "gross_rent is only allowed with rent_basis net_effective");
  if (b.checked_at != null && !isDate(b.checked_at)) throw new HttpError(400, "validation", "checked_at must be YYYY-MM-DD");
  if (b.available_date != null && !isDate(b.available_date)) {
    const n = typeof b.available_date === "string" ? normalizeAvailability(b.available_date, b.checked_at ?? "") : null;
    if (!n || !b.checked_at) throw new HttpError(400, "validation", "available_date must be YYYY-MM-DD or null");
    b.available_date = n.available_date; b.available_now = n.available_now;
  }
}

async function createListing(env: Env, b: any) {
  validateListing(b, false);
  if (b.available_now === true) b.available_date = b.checked_at;
  else b.available_now = false; // a null available_date stays null
  const bid = await findOrCreateBuilding(env, b);
  const lid = id("lst");
  await env.DB.prepare(`INSERT INTO listings (id, brokerage_id, building_id, unit, rent, gross_rent, source_flags, beds, baths, sqft, available_date, available_now, rent_basis, pets_policy, amenities, fee_info, leasing_contact, source, source_url, checked_at, needs_verification)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(lid, env.BROKERAGE_ID, bid, String(b.unit), b.rent, b.gross_rent ?? null, JSON.stringify(b.source_flags ?? []), b.beds, b.baths, b.sqft ?? null, b.available_date, b.available_now ? 1 : 0,
    b.rent_basis ?? rentBasisFor(b.building_name), b.pets_policy ?? "unknown", b.amenities ?? "", b.fee_info ?? null, b.leasing_contact ?? null, b.source ?? "manual", b.source_url, b.checked_at, b.needs_verification ? 1 : 0).run();
  return lid;
}

function validateRules(hr: any, dests: any): asserts hr is HardRules {
  if (!hr || typeof hr !== "object") throw new HttpError(400, "validation", "hard_rules is required");
  if (!Number.isInteger(hr.budget_max) || hr.budget_max <= 0) throw new HttpError(400, "validation", "hard_rules.budget_max must be a positive whole-dollar integer");
  if (!Number.isInteger(hr.beds_min) || hr.beds_min < 0) throw new HttpError(400, "validation", "hard_rules.beds_min must be an integer >= 0");
  if (hr.beds_max != null && (!Number.isInteger(hr.beds_max) || hr.beds_max < hr.beds_min)) throw new HttpError(400, "validation", "hard_rules.beds_max must be an integer >= beds_min");
  if (hr.baths_min != null && (typeof hr.baths_min !== "number" || hr.baths_min < 0)) throw new HttpError(400, "validation", "hard_rules.baths_min must be >= 0");
  if (!isDate(hr.move_in_date)) throw new HttpError(400, "validation", "hard_rules.move_in_date must be YYYY-MM-DD");
  if (!["none", "cat", "dog", "cat_and_dog"].includes(hr.pets)) throw new HttpError(400, "validation", "hard_rules.pets must be none|cat|dog|cat_and_dog");
  if (typeof hr.assistance_animal !== "boolean") throw new HttpError(400, "validation", "hard_rules.assistance_animal must be boolean");
  if (!Array.isArray(dests)) throw new HttpError(400, "validation", "destinations must be an array");
  for (const d of dests) if (typeof d?.label !== "string" || typeof d.lat !== "number" || typeof d.lng !== "number" || typeof d.max_minutes !== "number" || d.max_minutes <= 0
    || Math.abs(d.lat) > 90 || Math.abs(d.lng) > 180)
    throw new HttpError(400, "validation", "each destination needs label, lat (-90..90), lng (-180..180), max_minutes > 0");
}
function validatePrefs(p: any) {
  if (p == null) return;
  if (typeof p !== "object" || (p.tags !== undefined && (!Array.isArray(p.tags) || p.tags.some((t: any) => typeof t !== "string"))))
    throw new HttpError(400, "validation", "preferences.tags must be an array of strings");
}

async function doMatch(env: Env, hr: HardRules, dests: Destination[], prefs: Preferences, includeStale: boolean, clientId: string | null) {
  const listings = await allListings(env);
  const run_id = id("run"), generated_at = new Date().toISOString();
  const res = runMatch(listings, hr, dests, prefs, { today: todayNY(env), includeStale, run_id, generated_at });
  const stmts = [env.DB.prepare("INSERT INTO match_runs (id, brokerage_id, client_id, params_json) VALUES (?,?,?,?)")
    .bind(run_id, env.BROKERAGE_ID, clientId, JSON.stringify({ hard_rules: hr, destinations: dests, preferences: prefs, include_stale: includeStale }))];
  for (const [tier, arr] of [["exact", res.exact], ["stretch", res.stretch]] as const)
    for (const m of arr) stmts.push(env.DB.prepare("INSERT INTO match_results (run_id, brokerage_id, listing_id, tier, score, checklist_json) VALUES (?,?,?,?,?,?)")
      .bind(run_id, env.BROKERAGE_ID, m.listing.id, tier, m.score, JSON.stringify(m.checklist)));
  await env.DB.batch(stmts);
  return res;
}

const toClient = (r: any) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, hard_rules: JSON.parse(r.hard_rules_json),
  destinations: JSON.parse(r.destinations_json), preferences: JSON.parse(r.preferences_json), created_at: r.created_at });
async function getClient(env: Env, cid: string) {
  const r = await env.DB.prepare("SELECT * FROM clients WHERE brokerage_id=? AND id=?").bind(env.BROKERAGE_ID, cid).first();
  if (!r) throw new HttpError(404, "not_found", `Client ${cid} not found`);
  return toClient(r);
}
const prefsOf = (p: any): Preferences => ({ tags: Array.isArray(p?.tags) ? p.tags.filter((t: any) => typeof t === "string") : [] });

async function verifyTurnstile(env: Env, token: unknown, ip: string | null) {
  if (typeof token !== "string" || !token) return false;
  if (env.TURNSTILE_ENABLED !== "true") return true; // stub: any non-empty token passes locally
  const form = new FormData(); form.append("secret", env.TURNSTILE_SECRET ?? ""); form.append("response", token); if (ip) form.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  return ((await r.json()) as any).success === true;
}

async function importCsv(env: Env, req: Request) {
  const fd = await req.formData().catch(() => { throw new HttpError(400, "bad_request", "Expected multipart/form-data with a 'file' field"); });
  const file = fd.get("file") as unknown as File | null;
  if (!file || typeof (file as any).text !== "function") throw new HttpError(400, "validation", "file is required");
  const rows = parseCsv(await file.text());
  let inserted = 0, updated = 0; const failed: { row: number; reason: string }[] = [];
  for (const [i, r] of rows.entries()) {
    try {
      const av = normalizeAvailability(r.available_date, r.checked_at);
      if (!av) throw new HttpError(400, "validation", `bad available_date '${r.available_date}'`);
      const b: any = { building_name: r.building_name, address: r.address, city: r.city, state: r.state, zip: r.zip, unit: r.unit,
        rent: Number(r.rent), beds: Number(r.beds), baths: Number(r.baths), sqft: r.sqft ? Number(r.sqft) : null, ...av,
        pets_policy: normalizePets(r.pets_policy), amenities: r.amenities, fee_info: r.fee_info || null, leasing_contact: r.leasing_contact || null,
        source_url: r.source_url, checked_at: r.checked_at, needs_verification: /^(yes|true|1)$/i.test(r.needs_verification), source: "csv",
        rent_basis: rentBasis(r.building_name, r.notes) };
      if (b.rent_basis === "net_effective") b.gross_rent = grossFromNotes(r.notes);
      b.source_flags = sourceFlags(r.notes, normalizeOwner(null, r.notes, r.building_name));
      validateListing(b, false);
      const bid = await findOrCreateBuilding(env, b);
      const ex = await env.DB.prepare("SELECT id FROM listings WHERE brokerage_id=? AND building_id=? AND unit=? AND removed_at IS NULL").bind(env.BROKERAGE_ID, bid, b.unit).first<{ id: string }>();
      if (ex) {
        await env.DB.prepare(`UPDATE listings SET rent=?, beds=?, baths=?, sqft=?, available_date=?, available_now=?, pets_policy=?, amenities=?, fee_info=?, leasing_contact=?, source_url=?, checked_at=?, needs_verification=?, updated_at=datetime('now') WHERE id=?`)
          .bind(b.rent, b.beds, b.baths, b.sqft, b.available_date, b.available_now ? 1 : 0, b.pets_policy, b.amenities, b.fee_info, b.leasing_contact, b.source_url, b.checked_at, b.needs_verification ? 1 : 0, ex.id).run();
        updated++;
      } else { await createListing(env, b); inserted++; }
    } catch (e: any) { failed.push({ row: i + 2, reason: e.message }); }
  }
  const job_id = id("imp");
  await env.DB.prepare("INSERT INTO import_jobs (id, brokerage_id, status, rows_ok, rows_failed, errors_json) VALUES (?,?,?,?,?,?)")
    .bind(job_id, env.BROKERAGE_ID, "done", inserted + updated, failed.length, JSON.stringify(failed)).run();
  return { job_id, inserted, updated, failed };
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url), p = url.pathname.replace(/\/+$/, "") || "/", m = req.method;
  const B = env.BROKERAGE_ID;
  if (m === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE", "access-control-allow-headers": "content-type" } });

  if (p === "/api/health" && m === "GET") {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM listings WHERE brokerage_id=? AND removed_at IS NULL").bind(B).first<{ n: number }>();
    return json({ ok: true, listings: r?.n ?? 0, version: env.VERSION });
  }
  if (p === "/api/listings" && m === "GET") {
    const q = url.searchParams; let items = await allListings(env);
    if (q.get("state")) items = items.filter((l) => l.state === q.get("state")!.toUpperCase());
    if (q.get("beds")) items = items.filter((l) => l.beds === Number(q.get("beds")));
    if (q.get("max_rent")) items = items.filter((l) => l.rent <= Number(q.get("max_rent")));
    if (q.get("include_stale") !== "true") items = items.filter((l) => !l.stale);
    return json({ items: items.map(pub) });
  }
  if (p === "/api/listings/needs-location" && m === "GET")
    return json({ items: (await allListings(env)).filter((l) => l.lat == null || l.lng == null).map(pub) });
  if (p === "/api/listings" && m === "POST") return json(pub(await getListing(env, await createListing(env, await body(req)))), 201);
  if (p === "/api/listings/import" && m === "POST") return json(await importCsv(env, req));
  let mt = p.match(/^\/api\/listings\/([\w-]+)$/);
  if (mt) {
    const lid = mt[1];
    if (m === "GET") return json(pub(await getListing(env, lid)));
    if (m === "DELETE") {
      await getListing(env, lid);
      await env.DB.prepare("UPDATE listings SET removed_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND brokerage_id=?").bind(lid, B).run();
      return new Response(null, { status: 204 });
    }
    if (m === "PATCH") {
      const cur = await getListing(env, lid); const b = await body(req);
      for (const k of ["id", "lat", "lng", "stale", "building_id"]) if (k in b) throw new HttpError(400, "validation", `${k} is read-only`);
      validateListing({ ...b, checked_at: b.checked_at ?? cur.checked_at }, true);
      if (b.available_date !== undefined && !isDate(b.available_date)) { const n = normalizeAvailability(b.available_date, b.checked_at ?? cur.checked_at)!; b.available_date = n.available_date; b.available_now = n.available_now; }
      else if (b.available_date === null) b.available_now = false;
      else if (b.available_date && b.available_now === undefined) b.available_now = false;
      if (b.available_now === true && b.available_date === undefined) b.available_date = b.checked_at ?? cur.checked_at;
      if (["building_name", "address", "city", "state", "zip"].some((k) => k in b))
        b.building_id = await findOrCreateBuilding(env, { building_name: b.building_name ?? cur.building_name, address: b.address ?? cur.address, city: b.city ?? cur.city, state: b.state ?? cur.state, zip: b.zip ?? cur.zip });
      const sets: string[] = [], vals: any[] = [];
      for (const k of [...LISTING_FIELDS, "building_id", "amenities", "source_flags"]) if (k in b) { sets.push(`${k}=?`); vals.push(typeof b[k] === "boolean" ? (b[k] ? 1 : 0) : Array.isArray(b[k]) ? JSON.stringify(b[k]) : b[k]); }
      if (sets.length) await env.DB.prepare(`UPDATE listings SET ${sets.join(", ")}, updated_at=datetime('now') WHERE id=? AND brokerage_id=?`).bind(...vals, lid, B).run();
      return json(pub(await getListing(env, lid)));
    }
  }
  if (p === "/api/match" && m === "POST") {
    const b = await body(req); validateRules(b.hard_rules, b.destinations ?? []); validatePrefs(b.preferences);
    return json(await doMatch(env, b.hard_rules, b.destinations ?? [], prefsOf(b.preferences), b.include_stale === true, null));
  }
  if (p === "/api/clients" && m === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM clients WHERE brokerage_id=? ORDER BY created_at DESC").bind(B).all();
    return json({ items: results.map(toClient) });
  }
  if (p === "/api/clients" && m === "POST") {
    const b = await body(req);
    if (typeof b.name !== "string" || !b.name.trim()) throw new HttpError(400, "validation", "name is required");
    validateRules(b.hard_rules, b.destinations ?? []); validatePrefs(b.preferences);
    const cid = id("cli");
    await env.DB.prepare("INSERT INTO clients (id, brokerage_id, name, email, phone, hard_rules_json, destinations_json, preferences_json) VALUES (?,?,?,?,?,?,?,?)")
      .bind(cid, B, b.name.trim(), b.email ?? null, b.phone ?? null, JSON.stringify(b.hard_rules), JSON.stringify(b.destinations ?? []), JSON.stringify(prefsOf(b.preferences))).run();
    return json(await getClient(env, cid), 201);
  }
  mt = p.match(/^\/api\/clients\/([\w-]+)(\/match)?$/);
  if (mt) {
    const cid = mt[1];
    if (mt[2] && m === "POST") {
      const c = await getClient(env, cid); const b = await body(req).catch(() => ({}));
      return json(await doMatch(env, c.hard_rules, c.destinations, c.preferences, b?.include_stale === true, cid));
    }
    if (!mt[2] && m === "GET") return json(await getClient(env, cid));
    if (!mt[2] && m === "PATCH") {
      const c = await getClient(env, cid); const b = await body(req);
      const next = { ...c, ...b, hard_rules: b.hard_rules ? { ...c.hard_rules, ...b.hard_rules } : c.hard_rules, preferences: b.preferences ? prefsOf(b.preferences) : c.preferences };
      validateRules(next.hard_rules, next.destinations);
      await env.DB.prepare("UPDATE clients SET name=?, email=?, phone=?, hard_rules_json=?, destinations_json=?, preferences_json=?, updated_at=datetime('now') WHERE id=? AND brokerage_id=?")
        .bind(next.name, next.email ?? null, next.phone ?? null, JSON.stringify(next.hard_rules), JSON.stringify(next.destinations), JSON.stringify(next.preferences), cid, B).run();
      return json(await getClient(env, cid));
    }
  }
  if (p === "/api/settings") {
    if (m === "GET") return json({ listing_stale_days: await staleDays(env) });
    if (m === "PATCH") {
      const b = await body(req);
      if (!Number.isInteger(b.listing_stale_days) || b.listing_stale_days < 1) throw new HttpError(400, "validation", "listing_stale_days must be an integer >= 1");
      await env.DB.prepare("UPDATE settings SET listing_stale_days=?, updated_at=datetime('now') WHERE brokerage_id=?").bind(b.listing_stale_days, B).run();
      return json({ listing_stale_days: b.listing_stale_days });
    }
  }
  if (p === "/public/requests" && m === "POST") {
    const b = await body(req);
    if (!(await verifyTurnstile(env, b.turnstile_token, req.headers.get("cf-connecting-ip")))) throw new HttpError(403, "turnstile_failed", "Turnstile verification failed");
    if (typeof b.name !== "string" || !b.name.trim() || typeof b.email !== "string" || !/^\S+@\S+\.\S+$/.test(b.email)) throw new HttpError(400, "validation", "name and a valid email are required");
    validateRules(b.hard_rules, b.destinations ?? []);
    await env.DB.prepare("INSERT INTO requests (id, brokerage_id, name, email, phone, hard_rules_json, destinations_json) VALUES (?,?,?,?,?,?,?)")
      .bind(id("req"), B, b.name.trim(), b.email, b.phone ?? null, JSON.stringify(b.hard_rules), JSON.stringify(b.destinations ?? [])).run();
    return json({ ok: true }, 201);
  }
  if (p === "/api/requests" && m === "GET") {
    const st = url.searchParams.get("status");
    const { results } = await env.DB.prepare(`SELECT * FROM requests WHERE brokerage_id=? ${st ? "AND status=?" : ""} ORDER BY created_at DESC`).bind(...(st ? [B, st] : [B])).all();
    const nc = await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE brokerage_id=? AND status='new'").bind(B).first<{ n: number }>();
    return json({ items: results.map((r: any) => ({ id: r.id, name: r.name, email: r.email, phone: r.phone, hard_rules: JSON.parse(r.hard_rules_json), destinations: JSON.parse(r.destinations_json), status: r.status, created_at: r.created_at })), new_count: nc?.n ?? 0 });
  }
  return err(404, "not_found", `No route for ${m} ${p}`);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try { return await route(req, env); }
    catch (e: any) {
      if (e instanceof HttpError) return err(e.status, e.code, e.message);
      console.error(e); return err(500, "internal", "Internal error");
    }
  },
};
