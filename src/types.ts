export type LngLat = [number, number];

/** A building footprint. `id` = `bld-<lat5>-<|lon|5>` from the footprint centroid (~1 m precision): stable across reloads and data rebuilds as long as the OSM geometry is unchanged. */
export interface Building {
  id: string;
  /** One or more footprint rings (several when the building was split across vector tiles). */
  parts: LngLat[][];
  height: number;
  minHeight: number;
  colour: string | null;
  centroid: LngLat;
  osmTileFeatureId?: number;
  /** Simplified mode only: 'block' | 'landmark' | 'listing' | 'building'. */
  kind?: 'block' | 'landmark' | 'listing' | 'building';
  /** Simplified mode: full polygons (outer + holes) per part, for rendering cut-outs. */
  polys?: LngLat[][][];
  /** Detailed building ids represented by this feature (a block lists all merged buildings). */
  buildingIds?: string[];
  listings?: string[];
  name?: string | null;
  blockId?: string;
}

/** Per-building business data, keyed by building id. Extend freely (owner, units, CRM notes, comps...). */
export interface BuildingData {
  name?: string;
  notes?: string;
  listings?: string[]; // listing ids located in this building
  [key: string]: unknown;
}
export type BuildingStore = Record<string, BuildingData>;

export interface Listing {
  id: string; address: string; neighborhood: string; lat: number; lon: number;
  price: number; beds: number; baths: number; sqft: number; status: string; type: string; sample: boolean;
  buildingId?: string;
}
export interface Amenity { id: string; name: string; kind: string; lon: number; lat: number; }
export type AmenityCategory = 'grocery' | 'schools' | 'parks' | 'subway';
export type Amenities = Record<AmenityCategory, Amenity[]>;
export interface Development { id: string; name: string; address: string; lat: number; lon: number; units: number; floors: number; completion: string; status: string; }

export type Selection =
  | { kind: 'building'; id: string }
  | { kind: 'listing'; id: string }
  | { kind: 'development'; id: string }
  | { kind: 'amenity'; category: AmenityCategory; id: string }
  | null;
