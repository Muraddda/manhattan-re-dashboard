// App-wide state shared through context: loaded data, the selection, the persona and the client profile.
import { createContext, useContext } from 'react';
import type { Position } from 'geojson';
import type { Development, LngLat, Property, SchoolsData } from './model';
import type { PlaceIndex, Michelin } from './lib/places';
import type { Router } from './lib/transit';
import type { Grid } from './lib/grid';
import type { Profile } from './lib/profile';
import type { Scene } from './map/scene';

export type Persona = 'buyer' | 'seller' | 'developer' | 'agent';
export const PERSONAS: { key: Persona; label: string; hint: string }[] = [
  { key: 'buyer', label: 'Buyer', hint: 'Homes that fit a client: schools, commute, food, value' },
  { key: 'seller', label: 'Seller', hint: 'What a home is worth: comps, building history, market trend' },
  { key: 'developer', label: 'Developer', hint: 'Pipeline, soft sites, zoning and air rights' },
  { key: 'agent', label: 'Agent', hint: 'Shortlist, tour times, client links and reports' },
];

export interface SoftSite { bbl: string; address: string; lon: number; lat: number; zoning: string; lotArea: number; bldgArea: number; maxFar: number; builtFar: number; air: number; yearBuilt?: number; floors?: number; owner?: string; historic?: string }
export interface TrendRow { nta?: string; year: number; category: string; n: number; sumPrice: number; sumSqft: number; sumPriceSqft: number }

export interface Data {
  sales: Property[]; listings: Property[]; devs: Development[]; soft: SoftSite[]; trends: TrendRow[];
  schools?: SchoolsData; places?: PlaceIndex; router?: Router; michelin: Michelin[];
  homes: Property[];                         // listings + sales
  homeGrid?: Grid<Property>;
  byId: Map<string, Property>;
  /** Median $/ft² by `${neighborhood}|${type}` over the last 12 months (for value badges). */
  medPpsf: Map<string, number>;
  updated: Record<string, string | null>;
  loading: Set<string>;
  /** Condo unit lots of a building (billing BBL), from the DOF roll. */
  unitLots: (bbl: string) => number[];
  /** Earliest sale date in the rolling 12-month set (older history comes from the annualized set). */
  salesFrom?: string;
}

export type Sel =
  | { kind: 'home'; id: string }
  | { kind: 'site'; lon: number; lat: number; label: string; bbl?: string; ring?: Position[][]; height?: number }
  | { kind: 'dev'; id: string } | { kind: 'soft'; bbl: string }
  | { kind: 'place'; id: string } | { kind: 'school'; dbn: string } | { kind: 'station'; id: string }
  | null;

export interface Ctx {
  data: Data; persona: Persona; profile: Profile; setProfile: (f: (p: Profile) => Profile) => void;
  sel: Sel; select: (s: Sel, fly?: boolean) => void; anchor: LngLat | null;
  scene: Scene | null; showTrip: (to: LngLat | null) => void; tripTo: LngLat | null;
  iso: boolean; setIso: (v: boolean) => void; hoverId: string | null; setHover: (id: string | null) => void;
  toast: (msg: string) => void;
  setListings: (ls: Property[]) => void;
}
export const AppCtx = createContext<Ctx>(null!);
export const useApp = () => useContext(AppCtx);

/** Value vs the neighbourhood median $/ft² for the same type (needs the home's size). */
export function valueDelta(p: Property, med: Map<string, number>) {
  if (!p.ppsf) return undefined; const m = med.get(`${p.neighborhood}|${p.type}`);
  return m ? ((p.ppsf - m) / m) * 100 : undefined;
}
export const TYPE_LABEL: Record<Property['type'], string> = { condo: 'Condo', coop: 'Co-op', townhouse: 'Townhouse', multifamily: 'Multi-family', other: 'Other' };
