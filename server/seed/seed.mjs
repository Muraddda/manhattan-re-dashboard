#!/usr/bin/env node
// Seed: geocode each distinct building address with the free US Census geocoder (cached in seed/geocodes.json),
// normalize rows, write seed/seed.sql, and load it into LOCAL D1 (wrangler --local). No Cloudflare account used.
// Usage: node seed/seed.mjs [--no-load] [--refresh-geocodes] [--owners buildings-log.csv] [--exclude-owner=NAME ...] [file.csv ...]
// --exclude-owner=LeFrak drops every row whose normalized owner matches NAME (case-insensitive); repeatable.
// With no CSV arguments the default source list below is used. Rows are de-duplicated by (building address, unit):
// the first file that lists a unit wins, so put the newest/most complete file first.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DEFAULT_SOURCES = [
  "/workspace/team/data-analyst/poc-100/listings.csv",       // 429 rows, superset of trial-10's 8 buildings
  "/workspace/team/data-analyst/poc-100/browser-sites.csv",  // 25 rows: 2 Gold St, StuyTown
  "/workspace/team/data-analyst/poc-100/listings-batch2.csv", // 109 rows: Brooklyn + Liberty Harbor (net-effective pricing)
  "/workspace/team/data-analyst/trial-10/listings.csv",      // 159 rows; all expected to be duplicates of poc-100
];
const DEFAULT_OWNERS = "/workspace/team/data-analyst/poc-100/buildings-log.csv";
const BROKERAGE = "brk_demo";
const CACHE = join(HERE, "geocodes.json");
const FALLBACK = join(HERE, "building-coords.json");
const OVERRIDES = join(HERE, "geocode-overrides.json");
// Manual broker-verification flags (QA trial-10-check.md): building name prefix + unit -> reason
const UNVERIFIED = [{ building: "Parkside West", unit: "2412", reason: "Rent outlier ($3,640 for 2BR vs 2BR IQR $5,956-$7,495); matches live page, needs human check" }];
const REMOVED = [{ building: "Parkside West", unit: "2412", reason: "Max confirmed unavailable 2026-10-16" }];
const argv = process.argv.slice(2);
const args = new Set(argv.filter((a) => a.startsWith("--")));
const oi = argv.indexOf("--owners");
const OWNERS_FILE = oi >= 0 ? argv[oi + 1] : DEFAULT_OWNERS;
const csvArgs = argv.filter((a, i) => !a.startsWith("--") && !(oi >= 0 && i === oi + 1));
const SOURCES = csvArgs.length ? csvArgs : DEFAULT_SOURCES;
const EXCLUDE_OWNERS = argv.filter((a) => a.startsWith("--exclude-owner=")).map((a) => a.split("=").slice(1).join("=").trim().toLowerCase()).filter(Boolean);

// Compile-free reuse of the worker's normalizers: transpile src/normalize.ts on the fly via esbuild (bundled with wrangler).
const esbuild = await import("esbuild");
const out = await esbuild.build({ entryPoints: [join(ROOT, "src/normalize.ts")], bundle: true, format: "esm", write: false, platform: "neutral" });
const norm = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));

const cache = existsSync(CACHE) && !args.has("--refresh-geocodes") ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
const overrides = existsSync(OVERRIDES) ? JSON.parse(readFileSync(OVERRIDES, "utf8")) : {};
const fallback = existsSync(FALLBACK) ? JSON.parse(readFileSync(FALLBACK, "utf8")) : {};

async function census(oneline) {
  const url = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=" + encodeURIComponent(oneline);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      const m = j?.result?.addressMatches?.[0];
      return m ? { lat: m.coordinates.y, lng: m.coordinates.x, matched: m.matchedAddress, matches: j.result.addressMatches.length } : { lat: null, lng: null, matched: null, matches: 0 };
    } catch (e) { if (attempt === 3) return { lat: null, lng: null, matched: null, matches: 0, error: String(e) }; await new Promise((s) => setTimeout(s, 1500 * attempt)); }
  }
}
// Reject Census matches whose house number or street name differs from the input (e.g. "Park Lane North" -> "PARK LN S",
// "Stuyvesant Oval" -> "STUYVESANT ST", "Hanover Square" -> "HANOVER ST"): those are wrong buildings, so treat as failures.
const ABBR = { street: "st", st: "st", avenue: "ave", ave: "ave", av: "ave", lane: "ln", ln: "ln", road: "rd", rd: "rd", parkway: "pkwy", pkwy: "pkwy",
  square: "sq", sq: "sq", oval: "oval", north: "n", south: "s", east: "e", west: "w", n: "n", s: "s", e: "e", w: "w", first: "1st", place: "pl", pl: "pl",
  court: "ct", ct: "ct", extension: "exn", ext: "exn", exn: "exn", drive: "dr", dr: "dr", boulevard: "blvd", blvd: "blvd", tenth: "10th", second: "2nd", third: "3rd" };
const DIRS = new Set(["n", "s", "e", "w"]);
const streetKey = (a) => a.toLowerCase().replace(/[.,]/g, " ").split(/\s+/).filter(Boolean).map((t) => ABBR[t] ?? t).map((t) => t.replace(/^(\d+)(st|nd|rd|th)$/, "$1")).join(" ");
function sameStreet(input, matched) {
  if (!matched) return false;
  const a = streetKey(input), b = streetKey(matched.split(",")[0]);
  if (a === b) return true;
  // allow the geocoder to add a trailing directional the input omitted ("25 River Drive" -> "25 RIVER DR S"),
  // but never a conflicting one ("Park Lane North" -> "PARK LN S")
  const at = a.split(" "), bt = b.split(" ");
  return bt.length === at.length + 1 && DIRS.has(bt[bt.length - 1]) && !DIRS.has(at[at.length - 1]) && bt.slice(0, -1).join(" ") === a;
}
// NYC GeoSearch (free, no key) for NY addresses. Accept only an address/venue hit with the same house number and street.
async function geosearch(oneline, address) {
  const url = "https://geosearch.planninglabs.nyc/v2/search?size=1&text=" + encodeURIComponent(oneline);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const f = (await r.json())?.features?.[0];
      const hn = address.trim().split(/\s+/)[0];
      if (!f || !["address", "venue"].includes(f.properties?.layer) || String(f.properties?.housenumber) !== hn || !sameStreet(address, `${f.properties.housenumber} ${f.properties.street}`)) return { lat: null, lng: null, matched: f?.properties?.label ?? null, matches: 0 };
      return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], matched: f.properties.label, matches: 1, confidence: f.properties.confidence };
    } catch (e) { if (attempt === 3) return { lat: null, lng: null, matched: null, matches: 0, error: String(e) }; await new Promise((s) => setTimeout(s, 1500 * attempt)); }
  }
}
const oneline = (r) => [r.address, r.city, [r.state, r.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
const hid = (p, s) => p + "_" + createHash("sha1").update(s).digest("hex").slice(0, 12);

const owners = {};
if (OWNERS_FILE && existsSync(OWNERS_FILE)) for (const o of norm.parseCsv(readFileSync(OWNERS_FILE, "utf8"))) owners[o.building.replace(/\s*\[.*\]\s*$/, "").trim()] = o.owner;
const ownerOf = (r) => norm.normalizeOwner(owners[r.building_name], r.notes, r.building_name);
let excludedByOwner = 0;
const rows = []; const seen = new Set(); let dupes = 0, blankFilled = 0;
for (const src of SOURCES) {
  const rs = norm.parseCsv(readFileSync(src, "utf8")); let added = 0;
  for (const r of rs) {
    if (EXCLUDE_OWNERS.length && EXCLUDE_OWNERS.includes((ownerOf(r) ?? "").toLowerCase())) { excludedByOwner++; continue; }
    if (REMOVED.some((x) => (r.building_name ?? r.building ?? "").startsWith(x.building) && String(r.unit ?? "").trim() === x.unit)) continue;
    // Blank unit (Glenwood shows listing IDs only): take the listing ID from source_url or notes; otherwise
    // 'L-' + 8 hex of sha1(source_url, rent, beds, baths, sqft). Never dedupe on a blank unit.
    if (!r.unit.trim()) {
      const m = (r.source_url || "").match(/[?&#](?:listing(?:_?id)?|id)=(\w+)/i) || (r.source_url || "").match(/\/listings?\/(\w+)\/?$/i) || (r.notes || "").match(/listing ID[:#\s]*(\w+)/i);
      if (m) { r.unit = `ID ${m[1]}`; r.notes = `unit field holds the source listing ID (unit number not shown). ${r.notes}`; }
      else { r.unit = "L-" + createHash("sha1").update([r.source_url, r.rent, r.beds, r.baths, r.sqft].join("|")).digest("hex").slice(0, 8); r.notes = `unit is a synthetic id (no unit number or listing ID in source). ${r.notes}`; }
      blankFilled++;
    }
    const normAddr = streetKey(r.address) + "|" + r.city.trim().toLowerCase();
    const key = `${normAddr}|${r.unit.trim().toLowerCase()}`;
    if (r.unit.trim() && seen.has(key)) { dupes++; continue; }
    seen.add(key); rows.push({ ...r, _src: src }); added++;
  }
  console.log(`${src}: ${rs.length} rows, ${added} new, ${rs.length - added} duplicates`);
}
console.log(`blank units filled: ${blankFilled}`);
console.log(`total unique rows: ${rows.length} (duplicates skipped: ${dupes}${EXCLUDE_OWNERS.length ? `, excluded by owner ${EXCLUDE_OWNERS.join(",")}: ${excludedByOwner}` : ""})`);

const buildings = new Map();
for (const r of rows) {
  const key = `${r.building_name}|${r.address}|${r.city}|${r.state}|${r.zip}`;
  if (!buildings.has(key)) buildings.set(key, { id: hid("bld", key), name: r.building_name, address: r.address, city: r.city, state: r.state, zip: r.zip, owner: ownerOf(r), flags: new Set() });
  const bb = buildings.get(key); if (!bb.owner) bb.owner = ownerOf(r);
  if (bb.owner === "LeFrak") bb.flags.add("owner_opposes_scraping");
}

const failures = [];
for (const b of buildings.values()) {
  const addr = b.address ? oneline(b) : "";
  const ov = overrides[b.address];
  if (ov) { Object.assign(b, { lat: ov.lat, lng: ov.lng, geocode_source: "override", geocode_confidence: "verified" }); continue; }
  let g;
  if (addr && b.state === "NY") {
    const k = "geosearch|" + addr;
    g = cache[k]; if (!g || g.error) { g = await geosearch(addr, b.address); cache[k] = { ...g, geocoded_at: new Date().toISOString() }; }
    if (g.lat != null) { Object.assign(b, { lat: g.lat, lng: g.lng, geocode_source: "nyc_geosearch", geocode_confidence: String(g.confidence ?? "") }); continue; }
  }
  g = addr ? cache[addr] : undefined;
  if (addr && (!g || g.error)) { g = await census(addr); cache[addr] = { ...g, geocoded_at: new Date().toISOString() }; }
  if (g && g.lat != null && !sameStreet(b.address, g.matched)) { g = { ...g, rejected: `matched '${g.matched}'` }; }
  if (g && g.lat != null && !g.rejected) { Object.assign(b, { lat: g.lat, lng: g.lng, geocode_source: "census", geocode_confidence: g.matches === 1 ? "exact" : `first_of_${g.matches}` }); continue; }
  // fallback: building-level public address (still geocoded by Census, never hand-entered)
  const fb = fallback[b.name];
  if (fb) {
    let f = cache[fb]; if (!f || f.error) { f = await census(fb); cache[fb] = { ...f, geocoded_at: new Date().toISOString() }; }
    if (f.lat != null && sameStreet(fb.split(",")[0], f.matched)) { Object.assign(b, { lat: f.lat, lng: f.lng, geocode_source: "building_fallback", geocode_confidence: "building" }); continue; }
  }
  Object.assign(b, { lat: null, lng: null, geocode_source: null, geocode_confidence: null });
  failures.push(`${b.name} | ${addr || "(no address)"}${g?.rejected ? " | Census " + g.rejected + " (rejected: wrong street)" : " | no Census match"}`);
}
writeFileSync(CACHE, JSON.stringify(cache, null, 2) + "\n");

const sql = ["DELETE FROM match_results; DELETE FROM match_runs; DELETE FROM listings; DELETE FROM buildings;"];
for (const b of buildings.values())
  sql.push(`INSERT INTO buildings (id, brokerage_id, name, address, city, state, zip, lat, lng, geocode_source, geocode_confidence, owner, source_flags) VALUES (${[b.id, BROKERAGE, b.name, b.address, b.city, b.state, b.zip, b.lat, b.lng, b.geocode_source, b.geocode_confidence, b.owner, JSON.stringify([...b.flags])].map(q).join(",")});`);
const bad = []; const stats = { net: 0, gross: 0, flagged: 0 };
const pets = {};
let n = 0;
for (const [i, r] of rows.entries()) {
  const b = buildings.get(`${r.building_name}|${r.address}|${r.city}|${r.state}|${r.zip}`);
  const av = norm.normalizeAvailability(r.available_date, r.checked_at);
  if (!av) { bad.push(`${r._src} row ${i + 2}: unparseable available_date '${r.available_date}'`); continue; }
  const p = norm.normalizePets(r.pets_policy); pets[p] = (pets[p] ?? 0) + 1;
  const basis = norm.rentBasis(r.building_name, r.notes, owners[r.building_name] ?? b.owner);
  const gross = basis === "net_effective" ? norm.grossFromNotes(r.notes) : null;
  const flags = norm.sourceFlags(r.notes, b.owner);
  stats.net += basis === "net_effective" ? 1 : 0; stats.gross += gross != null ? 1 : 0; stats.flagged += flags.length ? 1 : 0;
  const vals = [hid("lst", `${b.id}|${r.unit}`), BROKERAGE, b.id, r.unit, Math.round(Number(r.rent)), gross, JSON.stringify(flags), Number(r.beds), Number(r.baths), r.sqft ? Number(r.sqft) : null,
    av.available_date, av.available_now ? 1 : 0, basis, p, r.amenities ?? "", r.fee_info || null, r.leasing_contact || null,
    "csv", r.source_url, r.checked_at, /^(yes|true|1)$/i.test(r.needs_verification) ? 1 : 0, r.notes || null];
  const uv = UNVERIFIED.find((u) => r.building_name.startsWith(u.building) && r.unit === u.unit);
  vals.push(uv ? 1 : 0, uv?.reason ?? null);
  sql.push(`INSERT INTO listings (id, brokerage_id, building_id, unit, rent, gross_rent, source_flags, beds, baths, sqft, available_date, available_now, rent_basis, pets_policy, amenities, fee_info, leasing_contact, source, source_url, checked_at, needs_verification, notes, unverified, unverified_reason) VALUES (${vals.map(q).join(",")});`);
  n++;
}
writeFileSync(join(HERE, "seed.sql"), sql.join("\n") + "\n");
console.log(`buildings: ${buildings.size}, listings prepared: ${n}, skipped: ${bad.length}`);
bad.forEach((x) => console.log("  skipped:", x));
console.log("pets_policy:", JSON.stringify(pets));
console.log(`net_effective rows: ${stats.net} (gross stated: ${stats.gross}); rows flagged owner_opposes_scraping: ${stats.flagged}`);
const ow = {}; for (const b of buildings.values()) ow[b.owner ?? "(unknown)"] = (ow[b.owner ?? "(unknown)"] ?? 0) + 1; console.log("buildings by owner:", JSON.stringify(ow));
const fb = [...buildings.values()].filter((b) => b.flags.size).map((b) => b.name); console.log(`buildings flagged owner_opposes_scraping: ${new Set(fb).size}`);
const bySrc = {}; for (const b of buildings.values()) bySrc[b.geocode_source ?? "none"] = (bySrc[b.geocode_source ?? "none"] ?? 0) + 1;
console.log("geocode_source per building:", JSON.stringify(bySrc));
console.log(`geocode failures: ${failures.length}`); failures.forEach((f) => console.log("  -", f));
const rb = {}; for (const r of rows) { const k = `${r.building_name} => ${norm.rentBasis(r.building_name, r.notes, owners[r.building_name] ?? norm.normalizeOwner(null, r.notes, r.building_name))}`; rb[k] = (rb[k] ?? 0) + 1; }
console.log("rent_basis by building:"); Object.entries(rb).forEach(([k, v]) => console.log(`  ${k} (${v})`));
const nl = {}; for (const r of rows) { const b = buildings.get(`${r.building_name}|${r.address}|${r.city}|${r.state}|${r.zip}`); if (b.lat == null) nl[b.name] = (nl[b.name] ?? 0) + 1; }
console.log("needs_location (no coordinates):", JSON.stringify(nl));
writeFileSync(join(HERE, "seed-report.json"), JSON.stringify({ sources: SOURCES, unique_rows: rows.length, duplicates_skipped: dupes, buildings: buildings.size, geocode_failures: failures, needs_location: nl, rent_basis: rb }, null, 2) + "\n");
if (!args.has("--no-load")) {
  execSync("npx wrangler d1 migrations apply DB --local", { cwd: ROOT, stdio: "inherit", env: { ...process.env, CI: "1" } });
  execSync("npx wrangler d1 execute DB --local --file seed/seed.sql", { cwd: ROOT, stdio: "inherit" });
  console.log("Loaded into local D1.");
}
