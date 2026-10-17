import { describe, it, expect } from "vitest";
import { evaluate, runMatch, isStale, haversineKm, budgetRent } from "../src/match";
import { grossFromNotes, normalizeAvailability, normalizeOwner, normalizePets, rentBasis, rentBasisFor, sourceFlags } from "../src/normalize";
import type { Destination, HardRules, Listing } from "../src/types";

const TODAY = "2026-10-16";
const DEST: Destination = { label: "FiDi", lat: 40.7075, lng: -74.0113, max_minutes: 30 };
const base = (o: Partial<Listing> = {}): Listing => ({
  id: "L1", building_id: "B1", building_name: "Test", address: "1 Test St", city: "New York", state: "NY", zip: "10005",
  lat: 40.7075, lng: -74.0113, unit: "1A", rent: 3000, gross_rent: null, source_flags: [], owner: null, beds: 1, baths: 1, sqft: null, available_date: "2026-11-01",
  available_now: false, rent_basis: "listed", pets_policy: "allowed", fee_info: null, leasing_contact: null,
  source_url: "x", checked_at: TODAY, needs_verification: false, pets_assumed: false, unverified: false, geocode_source: "census", stale: false, ...o });
const hr = (o: Partial<HardRules> = {}): HardRules => ({ budget_max: 3000, beds_min: 1, baths_min: 1, move_in_date: "2026-11-01", pets: "none", assistance_animal: false, ...o });
const st = (l: Listing, h: HardRules, rule: string, d: Destination[] = [DEST]) => evaluate(l, h, d, TODAY).checklist.find((c) => c.rule === rule)!.status;
const tier = (l: Listing, h: HardRules, d: Destination[] = [DEST], include = false) => {
  const r = runMatch([l], h, d, { tags: [] }, { today: TODAY, includeStale: include, run_id: "r", generated_at: "g" });
  return r.exact.length ? "exact" : r.stretch.length ? "stretch" : "excluded";
};
// point due north of DEST at the given minutes (20 km/h)
const north = (min: number) => { const km = (min / 60) * 20; return { lat: DEST.lat + (km / 6371.0088) * (180 / Math.PI), lng: DEST.lng }; };

describe("pets (locked)", () => {
  it("cat owner: allowed/cats ok, dogs/none excluded", () => {
    for (const p of ["allowed", "cats"] as const) expect(tier(base({ pets_policy: p }), hr({ pets: "cat" }))).toBe("exact");
    for (const p of ["dogs", "none"] as const) expect(tier(base({ pets_policy: p }), hr({ pets: "cat" }))).toBe("excluded");
  });
  it("cat_and_dog needs 'allowed'", () => {
    expect(tier(base({ pets_policy: "allowed" }), hr({ pets: "cat_and_dog" }))).toBe("exact");
    expect(tier(base({ pets_policy: "cats" }), hr({ pets: "cat_and_dog" }))).toBe("excluded");
  });
  it("pets are never bent even if everything else is in stretch", () => {
    const r = runMatch([base({ pets_policy: "none", rent: 3100 })], hr({ pets: "dog" }), [DEST], { tags: [] }, { today: TODAY, run_id: "r", generated_at: "g" });
    expect(r.stretch.length + r.exact.length).toBe(0); expect(r.excluded_count.locked_rule).toBe(1);
  });
  it("unknown policy -> assumed allowed (Yes, assumed)", () => {
    const l = base({ pets_policy: "unknown" });
    expect(st(l, hr({ pets: "cat" }), "pets")).toBe("satisfied");
    expect(tier(l, hr({ pets: "cat" }))).toBe("exact");
  });
  it("no-pet client is satisfied anywhere", () => expect(st(base({ pets_policy: "none" }), hr(), "pets")).toBe("satisfied"));
});

describe("assistance animals", () => {
  it("never exclude a no-pet building", () => {
    const l = base({ pets_policy: "none" }), h = hr({ pets: "none", assistance_animal: true });
    expect(st(l, h, "pets")).toBe("satisfied"); expect(tier(l, h)).toBe("exact");
  });
  it("do not override a pet the client also has", () => expect(tier(base({ pets_policy: "none" }), hr({ pets: "dog", assistance_animal: true }))).toBe("excluded"));
});

describe("destinations (locked) / commute", () => {
  it("haversine sanity: 1 deg lat ~ 111 km", () => expect(haversineKm(40, -74, 41, -74)).toBeCloseTo(111.2, 0));
  it("29.5 and exactly 30.0 min pass; 30.1 and 30.5 fail (raw float)", () => {
    expect(tier(base(north(29.5)), hr())).toBe("exact");
    expect(tier(base(north(30.0)), hr())).toBe("exact");
    expect(tier(base(north(30.1)), hr())).toBe("excluded");
    expect(tier(base(north(30.5)), hr())).toBe("excluded");
  });
  it("commute over the limit is never stretched", () => {
    const r = runMatch([base({ ...north(31), rent: 3200 })], hr(), [DEST], { tags: [] }, { today: TODAY, run_id: "r", generated_at: "g" });
    expect(r.stretch).toHaveLength(0); expect(r.excluded_count.locked_rule).toBe(1);
  });
  it("every destination must pass", () => expect(tier(base(), hr(), [DEST, { label: "Far", lat: 41.2, lng: -74, max_minutes: 30 }])).toBe("excluded"));
  it("no coordinates -> excluded as no_geocode and listed in needs_location", () => {
    const r = runMatch([base({ lat: null, lng: null })], hr(), [], { tags: [] }, { today: TODAY, run_id: "r", generated_at: "g" });
    expect(r.excluded_count.no_geocode).toBe(1); expect(r.needs_location.map((x) => x.id)).toEqual(["L1"]);
  });
});

describe("budget stretch (+10%)", () => {
  it("boundaries", () => {
    expect(tier(base({ rent: 3000 }), hr())).toBe("exact");
    expect(tier(base({ rent: 3001 }), hr())).toBe("stretch");
    expect(tier(base({ rent: 3300 }), hr())).toBe("stretch");
    expect(tier(base({ rent: 3301 }), hr())).toBe("excluded");
    expect(tier(base({ rent: 11000 }), hr({ budget_max: 10000 }))).toBe("stretch");
    expect(tier(base({ rent: 11001 }), hr({ budget_max: 10000 }))).toBe("excluded");
  });
  it("detail string", () => expect(evaluate(base({ rent: 4180 }), hr({ budget_max: 4000 }), [DEST], TODAY).checklist[0].detail).toBe("$4,180 vs budget $4,000 (+4.5%)"));
});

describe("net effective / gross rent", () => {
  it("budget uses gross_rent when present and the detail names both figures", () => {
    const l = base({ rent: 4125, gross_rent: 4500, rent_basis: "net_effective" });
    const c = evaluate(l, hr({ budget_max: 4600 }), [DEST], TODAY).checklist[0];
    expect(c.status).toBe("satisfied"); expect(c.detail).toBe("$4,500 gross ($4,125 net effective) vs budget $4,600");
    expect(tier(l, hr({ budget_max: 4200 }))).toBe("stretch");          // 4500 vs 4200 = +7.1%
    expect(tier(l, hr({ budget_max: 4000 }))).toBe("excluded");         // +12.5% on gross, though net is within 10%
  });
  it("falls back to rent when gross is not stated", () => expect(tier(base({ rent: 3000, gross_rent: null, rent_basis: "net_effective" }), hr())).toBe("exact"));
  it("parses gross only when stated", () => {
    expect(grossFromNotes("Net Rent shown ($7,225) with 2 months free; gross rent $8,075. Unit")).toBe(8075);
    expect(grossFromNotes("Net effective price shown; gross price $3,505. Site")).toBe(3505);
    expect(grossFromNotes("Price is net effective of concessions; Gross not shown.")).toBeNull();
    expect(rentBasis("X", "Price is net effective of concessions")).toBe("net_effective");
    expect(rentBasis("10 Halletts Point", "site says listed rent may reflect net-effective rent based on gross rent", "Durst")).toBe("net_effective");
    expect(grossFromNotes("site says listed rent may reflect net-effective rent based on gross rent. sqft not shown.")).toBeNull();
  });
  it("owner + source flags", () => {
    expect(normalizeOwner("Newport Rentals (LeFrak)")).toBe("LeFrak"); expect(normalizeOwner("unknown (marketed by MNS)")).toBeNull();
    expect(sourceFlags("...; FLAG: Owner Opposes Scraping (LeFrak)", null)).toEqual(["owner_opposes_scraping"]);
    expect(sourceFlags("", "LeFrak")).toEqual(["owner_opposes_scraping"]); expect(sourceFlags("", "UDR")).toEqual([]);
  });
});

describe("beds stretch (2 fewer / 2 above beds_max)", () => {
  it("more beds than beds_min with no beds_max is satisfied", () => expect(st(base({ beds: 3 }), hr({ beds_min: 1 }), "beds")).toBe("satisfied"));
  it("fewer beds", () => {
    expect(tier(base({ beds: 1 }), hr({ beds_min: 3 }))).toBe("stretch");
    expect(tier(base({ beds: 0 }), hr({ beds_min: 3 }))).toBe("excluded");
    expect(tier(base({ beds: 0 }), hr({ beds_min: 2 }))).toBe("stretch");
  });
  it("above beds_max", () => {
    expect(st(base({ beds: 3 }), hr({ beds_min: 1, beds_max: 1 }), "beds")).toBe("adjusted");
    expect(tier(base({ beds: 4 }), hr({ beds_min: 1, beds_max: 1 }))).toBe("excluded");
  });
});

describe("baths stretch (-1)", () => {
  it("boundaries incl. half baths; extra baths satisfied", () => {
    expect(tier(base({ baths: 2 }), hr({ baths_min: 2 }))).toBe("exact");
    expect(tier(base({ baths: 1.5 }), hr({ baths_min: 2 }))).toBe("stretch");
    expect(tier(base({ baths: 1 }), hr({ baths_min: 2 }))).toBe("stretch");
    expect(tier(base({ baths: 1 }), hr({ baths_min: 2.5 }))).toBe("excluded");
    expect(st(base({ baths: 3 }), hr({ baths_min: 1 }), "baths")).toBe("satisfied");
  });
  it("beds and baths can bend together; bent_rules lists both", () => {
    const r = runMatch([base({ beds: 1, baths: 1 })], hr({ beds_min: 2, baths_min: 2 }), [DEST], { tags: [] }, { today: TODAY, run_id: "r", generated_at: "g" });
    expect(r.stretch).toHaveLength(1); expect(r.bent_rules.map((b) => b.rule).sort()).toEqual(["baths", "beds"]);
  });
});

describe("move-in window (30 early .. 10 late)", () => {
  const mi = "2026-11-20";
  const at = (d: string | null, now = false) => tier(base({ available_date: d, available_now: now }), hr({ move_in_date: mi }));
  it("on/before move-in up to 30 days early is exact", () => {
    expect(at("2026-11-20")).toBe("exact"); expect(at("2026-11-19")).toBe("exact"); expect(at("2026-10-21")).toBe("exact");
  });
  it("31 days early is excluded", () => expect(at("2026-10-20")).toBe("excluded"));
  it("1..10 days late is stretch, 11 is excluded", () => {
    expect(at("2026-11-21")).toBe("stretch"); expect(at("2026-11-30")).toBe("stretch"); expect(at("2026-12-01")).toBe("excluded");
  });
  it("past date counts as available today", () => {
    expect(tier(base({ available_date: "2026-09-01" }), hr({ move_in_date: "2026-10-30" }))).toBe("exact");
    expect(tier(base({ available_date: "2026-09-01" }), hr({ move_in_date: "2026-12-30" }))).toBe("excluded"); // today is >30 days early
  });
  it("available_now unit (date = checked_at) obeys the 30-day early rule", () => {
    expect(tier(base({ available_date: TODAY, available_now: true }), hr({ move_in_date: "2026-10-30" }))).toBe("exact");
    expect(tier(base({ available_date: TODAY, available_now: true }), hr({ move_in_date: "2026-11-16" }))).toBe("excluded");
  });
  it("null date -> unknown 'Move-in date not listed', not excluded, not bent", () => {
    const e = evaluate(base({ available_date: null }), hr(), [DEST], TODAY).checklist.find((c) => c.rule === "move_in")!;
    expect(e.status).toBe("unknown"); expect(e.detail).toMatch(/^Move-in date not listed/);
    expect(at(null)).toBe("exact");
  });
});

describe("stale cutoff (more than listing_stale_days)", () => {
  it("6 and 7 days fresh, 8 stale", () => {
    expect(isStale("2026-10-10", TODAY, 7)).toBe(false);
    expect(isStale("2026-10-09", TODAY, 7)).toBe(false);
    expect(isStale("2026-10-08", TODAY, 7)).toBe(true);
  });
  it("stale excluded unless include_stale", () => {
    const l = base({ stale: true });
    expect(tier(l, hr())).toBe("excluded"); expect(tier(l, hr(), [DEST], true)).toBe("exact");
  });
});

describe("response shape", () => {
  it("area_geojson has per-tier polygons and tiered points", () => {
    const ls = [0, 1, 2].map((i) => base({ id: "E" + i, lat: 40.70 + i * 0.002, lng: -74.01 + (i % 2) * 0.003 }))
      .concat([0, 1, 2].map((i) => base({ id: "S" + i, rent: 3100, lat: 40.71 + i * 0.002, lng: -74.0 + (i % 2) * 0.003 })));
    const r = runMatch(ls, hr(), [DEST], { tags: [] }, { today: TODAY, run_id: "r", generated_at: "g" });
    const polys = r.area_geojson.features.filter((f: any) => f.geometry.type === "Polygon").map((f: any) => f.properties.tier);
    expect(polys.sort()).toEqual(["exact", "stretch"]);
    expect(r.area_geojson.features.filter((f: any) => f.geometry.type === "Point").every((f: any) => ["exact", "stretch"].includes(f.properties.tier) && typeof f.properties.listing_id === "string")).toBe(true);
  });
  it("score ranks tag matches first, then rent closeness", () => {
    const a = { ...base({ id: "A", rent: 2000 }), amenities: "Gym, Roof deck" }, b = { ...base({ id: "B", rent: 2990 }), amenities: "" };
    const r = runMatch([b, a], hr(), [DEST], { tags: ["gym"] }, { today: TODAY, run_id: "r", generated_at: "g" });
    expect(r.exact.map((x) => x.listing.id)).toEqual(["A", "B"]);
    const r2 = runMatch([a, b], hr(), [DEST], { tags: [] }, { today: TODAY, run_id: "r", generated_at: "g" });
    expect(r2.exact.map((x) => x.listing.id)).toEqual(["B", "A"]);
  });
});

describe("normalization", () => {
  it("pets", () => {
    expect(normalizePets("")).toBe("unknown"); expect(normalizePets("Cats only")).toBe("cats"); expect(normalizePets("No pets")).toBe("none");
    expect(normalizePets("Cats and dogs welcome")).toBe("allowed"); expect(normalizePets("dogs ok")).toBe("dogs"); expect(normalizePets("No dogs")).toBe("cats");
  });
  it("availability", () => {
    expect(normalizeAvailability("Now", TODAY)).toEqual({ available_date: TODAY, available_now: true });
    expect(normalizeAvailability("immediate", TODAY)).toEqual({ available_date: TODAY, available_now: true });
    expect(normalizeAvailability("Available Now", TODAY)).toEqual({ available_date: TODAY, available_now: true });
    expect(normalizeAvailability("IMMEDIATELY", TODAY)).toEqual({ available_date: TODAY, available_now: true });
    expect(normalizeAvailability("available now", TODAY)).toEqual({ available_date: TODAY, available_now: true });
    expect(normalizeAvailability("", TODAY)).toEqual({ available_date: null, available_now: false });
    expect(normalizeAvailability("November 12", TODAY)).toEqual({ available_date: "2026-11-12", available_now: false });
    expect(normalizeAvailability("Oct 16", TODAY)?.available_date).toBe("2026-10-16");
    expect(normalizeAvailability("Oct 15", TODAY)?.available_date).toBe("2027-10-15");
    expect(normalizeAvailability("11/7/2026", TODAY)?.available_date).toBe("2026-11-07");
  });
  it("rent_basis", () => {
    expect(rentBasisFor("View 34")).toBe("lowest_term"); expect(rentBasisFor("VIA 57 West")).toBe("listed");
    expect(rentBasisFor("Bisby (Newport Rentals)")).toBe("base_before_fees"); expect(rentBasisFor("StuyTown / Peter Cooper Village")).toBe("twelve_month");
    expect(rentBasisFor("2 Gold St (TF Cornerstone)")).toBe("listed");
  });
});

describe("gross_rent 0 is treated as null", () => {
  it("budgetRent falls back to rent", () => { expect(budgetRent({ rent: 3000, gross_rent: 0 } as any)).toBe(3000); });
  it("notes with $0 gross give null", () => { expect(grossFromNotes("gross rent $0")).toBeNull(); });
});
