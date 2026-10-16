export type PetsPolicy = "allowed" | "cats" | "dogs" | "none" | "unknown";
export type RentBasis = "lowest_term" | "base_before_fees" | "twelve_month" | "net_effective" | "listed";
export type Listing = {
  id: string; building_id: string; building_name: string;
  address: string; city: string; state: "NY" | "NJ"; zip: string;
  lat: number | null; lng: number | null;
  unit: string; rent: number; beds: number;
  gross_rent: number | null;     // stated gross rent for net_effective rows; budget is checked on gross_rent ?? rent
  baths: number; sqft: number | null; available_date: string | null;
  available_now: boolean;        // 'Now'/'Immediate' -> available_date = checked_at; blank date stays null
  rent_basis: RentBasis;         // QA addition
  pets_policy: PetsPolicy;
  fee_info: string | null; leasing_contact: string | null;
  source_url: string; checked_at: string; needs_verification: boolean;
  source_flags: string[];       // union of building + listing flags, e.g. 'owner_opposes_scraping'
  owner: string | null;
  pets_assumed: boolean;         // pets_policy blank at source; treated as allowed (Max, Oct 16). Not shown on dashboard.
  unverified: boolean;           // broker must verify: manual flag (e.g. Parkside West #2412 rent outlier) OR pets_policy 'unknown'
  geocode_source: "nyc_geosearch" | "census" | "override" | "building_fallback" | null;
  stale: boolean;
};
export type HardRules = {
  budget_max: number; beds_min: number; beds_max?: number; baths_min?: number;
  move_in_date: string;
  pets: "none" | "cat" | "dog" | "cat_and_dog";
  assistance_animal: boolean;
};
export type Destination = { label: string; lat: number; lng: number; max_minutes: number };
export type Preferences = { tags: string[] };
export type RuleStatus = "satisfied" | "not_satisfied" | "adjusted" | "unknown";
export type Rule = "budget" | "beds" | "baths" | "move_in" | "pets" | "destination";
export type ChecklistItem = { rule: Rule; status: RuleStatus; detail: string };
export type MatchItem = { listing: Listing; score: number; checklist: ChecklistItem[]; travel: { label: string; minutes: number | null }[] };
export type BentRule = { rule: string; limit: string; listing_ids: string[] };
export type ExcludedCount = { stale: number; locked_rule: number; out_of_limits: number; no_geocode: number };
export type MatchResponse = {
  run_id: string; generated_at: string; exact: MatchItem[]; stretch: MatchItem[];
  bent_rules: BentRule[]; area_geojson: any; excluded_count: ExcludedCount;
  needs_location: Listing[];     // listings with no coordinates (excluded from matches)
};
