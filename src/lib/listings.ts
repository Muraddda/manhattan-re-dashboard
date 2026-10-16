// The agent's own listings: CSV import (StreetEasy/RLS exports or the template), geocoded, kept in this browser.
import Papa from 'papaparse';
import type { Property, PropType, Status } from '../model';
import { geocode } from './geosearch';

const KEY = 'skyline.listings.v1';
export const TEMPLATE_COLUMNS = ['address', 'unit', 'price', 'beds', 'baths', 'sqft', 'type', 'status', 'url', 'notes', 'lat', 'lon'];
export const templateCsv = () => `${TEMPLATE_COLUMNS.join(',')}\n"40 E 19th St",PH,5750000,3,3,2650,condo,Active,https://example.com/listing,"Corner unit, private terrace",,\n`;

export const loadListings = (): Property[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
export const saveListings = (ls: Property[]) => localStorage.setItem(KEY, JSON.stringify(ls));

const pick = (r: Record<string, string>, ...names: string[]) => { for (const n of names) { const k = Object.keys(r).find(x => x.trim().toLowerCase().replace(/[^a-z]/g, '') === n); if (k && r[k]?.trim()) return r[k].trim(); } return undefined; };
/** '$1,250,000' | '1.25m' | '950k' | '2,100' -> number. */
const money = (v?: string) => { const m = v?.replace(/[$,\s]/g, '').match(/^(\d+(?:\.\d+)?)([km])?$/i); return m ? +m[1] * ({ k: 1e3, m: 1e6 }[m[2]?.toLowerCase() as 'k' | 'm'] ?? 1) : undefined; };
const rooms = (v?: string) => v && /studio/i.test(v) ? 0 : money(v);
function typeOf(v = ''): PropType { const s = v.toLowerCase(); return /co-?op/.test(s) ? 'coop' : /condo/.test(s) ? 'condo' : /town|house/.test(s) ? 'townhouse' : /multi|rental/.test(s) ? 'multifamily' : 'condo'; }
function statusOf(v = ''): Status { const s = v.toLowerCase(); return /contract|pending/.test(s) ? 'In Contract' : /sold|closed/.test(s) ? 'Sold' : /off/.test(s) ? 'Off Market' : 'Active'; }

/** Parse a CSV and geocode rows without coordinates. Returns imported listings plus per-row problems. */
export async function importCsv(text: string, onProgress?: (done: number, total: number) => void) {
  const { data } = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const out: Property[] = [], problems: string[] = [];
  for (let i = 0; i < data.length; i++) {
    const r = data[i], address = pick(r, 'address', 'streetaddress', 'street'), price = money(pick(r, 'price', 'listprice', 'askingprice'));
    onProgress?.(i, data.length);
    if (!address || !price) { problems.push(`Row ${i + 2}: needs an address and a price`); continue; }
    let lat = +(pick(r, 'lat', 'latitude') ?? NaN), lon = +(pick(r, 'lon', 'lng', 'longitude') ?? NaN), bbl: string | undefined, neighborhood = pick(r, 'neighborhood', 'area') ?? '';
    if (!isFinite(lat) || !isFinite(lon)) {
      const g = await geocode(`${address}, Manhattan`).catch(() => undefined);
      if (!g) { problems.push(`Row ${i + 2}: could not find "${address}"`); continue; }
      ({ lat, lon, bbl } = g); neighborhood ||= g.neighbourhood ?? '';
    }
    const sqft = money(pick(r, 'sqft', 'squarefeet', 'size', 'area'));
    out.push({
      id: `lst:${(pick(r, 'id', 'listingid', 'mls') ?? `${address}-${pick(r, 'unit', 'apt', 'apartment') ?? ''}`).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      source: 'listing', address, unit: pick(r, 'unit', 'apt', 'apartment'), neighborhood, lon, lat, located: 'given', bbl,
      type: typeOf(pick(r, 'type', 'propertytype')), status: statusOf(pick(r, 'status')), price, date: new Date().toISOString().slice(0, 10),
      sqft, ppsf: sqft ? price / sqft : undefined, beds: rooms(pick(r, 'beds', 'bedrooms', 'br')), baths: rooms(pick(r, 'baths', 'bathrooms', 'ba')),
      url: pick(r, 'url', 'link'), notes: pick(r, 'notes', 'description', 'remarks'), photo: pick(r, 'photo', 'image', 'imageurl'),
    });
  }
  onProgress?.(data.length, data.length);
  return { listings: out, problems };
}
