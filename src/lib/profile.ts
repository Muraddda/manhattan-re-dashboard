// The client being shown homes: needs that drive badges and filters everywhere, plus the agent's shortlist.
// Kept in localStorage; "Share" encodes it (and the shortlist) into the URL hash so a client opens the same view.
import type { Diet, Property } from '../model';
import { loadListings, saveListings } from './listings';

export interface Destination { id: string; name: string; lon: number; lat: number }
export interface Profile {
  client: string;                  // "The Cohens", shown on shared links and the printed report
  diets: Diet[];
  destinations: Destination[];     // office, school, family... travel times appear on every home
  maxCommute?: number;             // minutes to the first destination, filter
  minSchool?: number;              // zoned elementary: minimum % proficient (avg of ELA and Math)
  budget: [number | null, number | null];
  shortlist: string[];             // property ids, tour order
}
export const EMPTY_PROFILE: Profile = { client: '', diets: [], destinations: [], budget: [null, null], shortlist: [] };
const KEY = 'skyline.profile.v1';

/** The saved profile, or the one in a shared link. A shared link is read once: the agent's own profile is kept as a
 *  backup, the link's profile becomes the working one, and the hash is removed so reloads keep later edits. */
export function loadProfile(): Profile {
  const own = (() => { try { return clean(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return EMPTY_PROFILE; } })();
  const shared = readHash(); if (!shared) return own;
  localStorage.setItem(`${KEY}.before-link`, JSON.stringify(own));
  saveProfile(shared); history.replaceState(null, '', location.pathname + location.search);
  return shared;
}
export const saveProfile = (p: Profile) => localStorage.setItem(KEY, JSON.stringify(p));

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
/** A link that opens this app with the same client profile and shortlist. */
/** Shortlisted listings the agent imported travel inside the link (they exist only in the agent's browser). */
export const shareUrl = (p: Profile, listings: Property[] = []) => `${location.origin}${location.pathname}#c=${b64(JSON.stringify({ ...p, listings: listings.filter(l => p.shortlist.includes(l.id)) }))}`;
function readHash(): Profile | null {
  const m = location.hash.match(/#c=([\w-]+)/); if (!m) return null;
  try {
    const j = JSON.parse(unb64(m[1]));
    const listings = (Array.isArray(j?.listings) ? j.listings : []).filter(okListing);
    if (listings.length) saveListings([...loadListings().filter(l => !listings.some((n: Property) => n.id === l.id)), ...listings]);
    return clean(j);
  } catch { return null; }
}
const TYPES = ['condo', 'coop', 'townhouse', 'multifamily', 'other'], STATUSES = ['Active', 'In Contract', 'Sold', 'Off Market'];
/** A listing from a link must look exactly like one the importer would create. */
function okListing(l: Property): boolean {
  return !!l && typeof l.id === 'string' && l.id.startsWith('lst:') && typeof l.address === 'string' && l.source === 'listing'
    && [l.lon, l.lat, l.price].every(v => typeof v === 'number' && isFinite(v)) && TYPES.includes(l.type) && STATUSES.includes(l.status)
    && (l.url == null || /^https?:\/\//.test(l.url)) && (l.photo == null || /^https?:\/\//.test(l.photo));
}
const DIET_KEYS: Diet[] = ['kosher', 'halal', 'vegan', 'vegetarian', 'gluten_free', 'organic'];
const num = (v: unknown) => typeof v === 'number' && isFinite(v) ? v : undefined;
/** Never trust stored or linked JSON: keep only well-formed fields. */
function clean(x: unknown): Profile {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const arr = (v: unknown) => Array.isArray(v) ? v : [];
  const budget = arr(o.budget);
  return {
    client: typeof o.client === 'string' ? o.client.slice(0, 80) : '',
    diets: arr(o.diets).filter((d): d is Diet => DIET_KEYS.includes(d as Diet)),
    destinations: arr(o.destinations).filter((d): d is Destination => !!d && typeof d === 'object' && typeof (d as Destination).name === 'string' && num((d as Destination).lon) != null && num((d as Destination).lat) != null)
      .map(d => ({ id: String(d.id ?? `${d.lon},${d.lat}`), name: d.name.slice(0, 80), lon: d.lon, lat: d.lat })).slice(0, 8),
    maxCommute: num(o.maxCommute), minSchool: num(o.minSchool),
    budget: [num(budget[0]) ?? null, num(budget[1]) ?? null],
    shortlist: arr(o.shortlist).filter((s): s is string => typeof s === 'string').slice(0, 60),
  };
}
