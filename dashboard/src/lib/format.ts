import type { Listing } from '../types';
export const usd = (n: number) => `$${n.toLocaleString('en-US')}`;
export const beds = (n: number) => (n === 0 ? 'Studio' : `${n} bd`);
export function rentLabel(l: Listing): { main: string; note: string; strong?: boolean } {
  switch (l.rent_basis) {
    case 'lowest_term': return { main: `From ${usd(l.rent)}`, note: 'lowest lease term' };
    case 'base_before_fees': return { main: usd(l.rent), note: 'base rent before fees' };
    case 'twelve_month': return { main: usd(l.rent), note: '12-month lease' };
    case 'net_effective': return grossOf(l) != null
      ? { main: `${usd(grossOf(l)!)} gross`, note: `${usd(l.rent)} net effective (after free months)` }
      : { main: usd(l.rent), note: 'NET EFFECTIVE, gross not shown', strong: true };
    default: return { main: usd(l.rent), note: 'listed rent' };
  }
}
export const RULE_LABEL: Record<string, string> = { budget: 'Budget', beds: 'Bedrooms', baths: 'Bathrooms', move_in: 'Move-in', pets: 'Pets', destination: 'Commute' };
/** Gross rent only when it's a real positive number; null/0/undefined fall back to null (never show a unit as free). */
export const grossOf = (l: Pick<Listing, 'gross_rent'>): number | null => (typeof l.gross_rent === 'number' && l.gross_rent > 0 ? l.gross_rent : null);
/** Price used for budget/ranking: gross when known, otherwise rent. Never 0 from a missing gross. */
export const budgetPrice = (l: Pick<Listing, 'gross_rent' | 'rent'>): number => grossOf(l) ?? l.rent;
