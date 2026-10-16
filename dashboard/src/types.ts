// Mirrors back-end/api-contract-v1.md exactly. Do not add fields here without a contract change.
import type { FeatureCollection } from 'geojson';
export type PetsPolicy = 'allowed' | 'cats' | 'dogs' | 'none' | 'unknown';
export type Listing = {
  id: string; building_id: string; building_name: string;
  address: string; city: string; state: 'NY' | 'NJ'; zip: string;
  lat: number | null; lng: number | null;
  unit: string; rent: number; beds: number; baths: number; sqft: number | null; available_date: string | null;
  pets_policy: PetsPolicy; fee_info: string | null; leasing_contact: string | null;
  source_url: string; checked_at: string; needs_verification: boolean; stale: boolean;
  available_now: boolean;          // "Now"/"Immediate" -> available_date = checked_at; blank date stays null
  rent_basis: RentBasis;
  pets_assumed: boolean;            // pet policy not listed -> treated as allowed; Pets line shows "Yes (assumed)"
  unverified: boolean;              // broker must verify (generic flag)
  gross_rent: number | null;        // set when the source states gross; budget is checked on gross_rent ?? rent
  source_flags: string[];           // e.g. ["owner_opposes_scraping"], agent-only
  geocode_source: 'nyc_geosearch' | 'census' | 'override' | null;
};
export type RentBasis = 'listed' | 'lowest_term' | 'base_before_fees' | 'twelve_month' | 'net_effective';
export type Pets = 'none' | 'cat' | 'dog' | 'cat_and_dog';
export type HardRules = {
  budget_max: number; beds_min: number; beds_max?: number; baths_min?: number;
  move_in_date: string; pets: Pets; assistance_animal: boolean;
};
export type Destination = { label: string; lat: number; lng: number; max_minutes: number };
export type Preferences = { tags: string[] };
export type RuleStatus = 'satisfied' | 'not_satisfied' | 'adjusted' | 'unknown';
export type RuleName = 'budget' | 'beds' | 'baths' | 'move_in' | 'pets' | 'destination';
export type ChecklistItem = { rule: RuleName; status: RuleStatus; detail: string };
export type MatchItem = { listing: Listing; score: number; checklist: ChecklistItem[]; travel: { label: string; minutes: number | null }[] };
export type BentRule = { rule: string; limit: string; listing_ids: string[] };
export type MatchRequest = { hard_rules: HardRules; destinations: Destination[]; preferences?: Preferences };
export type MatchResponse = {
  run_id: string; generated_at: string; exact: MatchItem[]; stretch: MatchItem[]; bent_rules: BentRule[];
  area_geojson: FeatureCollection; // Polygon per tier (properties.tier 'exact'|'stretch') + Point per listing (properties.tier, listing_id)
  needs_location: Listing[];        // listings without coordinates, excluded from matching
  excluded_count: { stale: number; locked_rule: number; out_of_limits: number; no_geocode: number };
};
