// Domain model shared by the data pipelines (scripts/*), the libraries (src/lib/*) and the UI.
import type { FeatureCollection } from 'geojson';

export type LngLat = [number, number];
export type PropType = 'condo' | 'coop' | 'townhouse' | 'multifamily' | 'other';
export type Status = 'Active' | 'In Contract' | 'Sold' | 'Off Market';

/** A home on the map: a closed sale (NYC DOF) or a listing the agent imported. */
export interface Property {
  id: string;                      // 'sale:<block>-<lot>-<yyyymmdd>-<apt>' | 'lst:<agent id>'
  source: 'sale' | 'listing';
  address: string;                 // building address, title case, no unit
  unit?: string;
  zip?: string;
  neighborhood: string;            // DOF neighborhood (e.g. 'UPPER EAST SIDE (59-79)') title-cased
  lon: number; lat: number;
  /** How the point was found: exact tax lot, building address on the block, block centroid, or given by the agent. */
  located: 'lot' | 'address' | 'block' | 'given';
  bbl?: string;                    // 10-digit building BBL (condo billing lot when known)
  type: PropType;
  buildingClass?: string;          // DOF building class category, e.g. '13 CONDOS - ELEVATOR APARTMENTS'
  status: Status;
  price: number;
  date?: string;                   // ISO date: sale date, or list date
  sqft?: number;                   // unit (or whole townhouse) square feet when known
  ppsf?: number;                   // price / sqft when sqft is known
  beds?: number; baths?: number;
  yearBuilt?: number;
  totalUnits?: number;
  url?: string; notes?: string; photo?: string;
}

/** Compact PLUTO lot used to place sales on the map (details are fetched per click). */
export interface Lot { bbl: string; block: number; lot: number; lon: number; lat: number; address: string }

export interface School {
  dbn: string;                     // e.g. '02M041'
  name: string;
  lon: number; lat: number;
  district: number;
  grades: string;                  // e.g. 'PK,0K,01,02,03,04,05'
  levels: ('ES' | 'MS' | 'HS')[];
  address?: string;
  ela?: number; math?: number;     // % proficient (Level 3+4), all grades tested, latest year
  testYear?: number; tested?: number;
  grad?: number; gradCohort?: string; // 4-year graduation % (high schools)
}
export interface SchoolsData {
  generated: string; sources: string[];
  schools: School[];
  esZones: FeatureCollection;      // properties: { dbn, label, district }
  msZones: FeatureCollection;      // properties: { dbn, label, district }
  districts: FeatureCollection;    // properties: { district }
  averages: { ela: number; math: number; grad: number }; // NYC citywide all-schools reference for the same year
}

export interface Place { id: string; cat: 'grocery' | 'dining' | 'park' | 'playground' | 'gym' | 'pharmacy'; sub: string; name: string; lon: number; lat: number; diets?: string[]; cuisine?: string; brand?: string; addr?: string; grade?: string }
export type Diet = 'kosher' | 'halal' | 'vegan' | 'vegetarian' | 'gluten_free' | 'organic';

export interface Development {
  id: string; address: string; lon: number; lat: number; bbl?: string;
  status: string;                  // 'Filed' | 'Approved' | 'Permitted' | 'Completed' ...
  units: number; floors?: number; filed?: string; permitted?: string; completed?: string;
  owner?: string; neighborhood?: string; schoolEs?: string; schoolMs?: string;
}

/** Comparable-sales valuation for a home. */
export interface Valuation {
  n: number;                       // comps used
  medianPpsf?: number; lowPpsf?: number; highPpsf?: number;   // IQR
  medianPrice: number; lowPrice: number; highPrice: number;
  estimate?: number;               // medianPpsf * sqft, when sqft known
  deltaPct?: number;               // (price - estimate or median) / ... * 100, + = above market
  basis: 'ppsf' | 'price';
  radiusM: number; months: number;
  comps: Property[];               // nearest-first, up to 12
}
