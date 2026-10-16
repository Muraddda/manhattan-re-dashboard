import type { MatchRequest, MatchResponse } from '../types';
import { mockMatch } from '../mocks/match';

export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
export type MatchResult = { data: MatchResponse; source: 'api' | 'sample'; reason?: string };

/** POST /api/match. Falls back to the local sample layer only when the API is unreachable or not JSON (network error, 404 from a static host, 5xx). Validation errors (4xx with error body) are surfaced. */
export async function postMatch(req: MatchRequest, signal?: AbortSignal): Promise<MatchResult> {
  try {
    const res = await fetch(`${API_BASE}/api/match`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal });
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) throw new Error(`API returned ${res.status} ${ct || 'no content-type'}`);
    const body = await res.json();
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500 && res.status !== 404 && body?.error) throw new ApiError(body.error.code, body.error.message);
      throw new Error(`API ${res.status}`);
    }
    return { data: body as MatchResponse, source: 'api' };
  } catch (e) {
    if (e instanceof ApiError || (e as Error).name === 'AbortError') throw e;
    return { data: mockMatch(req), source: 'sample', reason: (e as Error).message };
  }
}
export class ApiError extends Error { constructor(public code: string, message: string) { super(message); } }

/** GET /api/listings/needs-location (standalone list; the match response also carries needs_location). */
export async function getNeedsLocation(signal?: AbortSignal) {
  const res = await fetch(`${API_BASE}/api/listings/needs-location`, { signal });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as { items: import('../types').Listing[] };
}
