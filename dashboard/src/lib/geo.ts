export function km(a: [number, number], b: [number, number]) {
  const R = 6371, r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** Contract v1: straight-line distance at ~20 km/h door to door. */
export const estMinutes = (a: [number, number], b: [number, number]) => Math.round((km(a, b) / 20) * 60);
/** Monotone-chain convex hull on [lng,lat]. */
export function hull(pts: [number, number][]): [number, number][] {
  const p = [...new Map(pts.map((x) => [x.join(), x])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const x of p) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], x) <= 0) lo.pop(); lo.push(x); }
  for (const x of [...p].reverse()) { while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], x) <= 0) up.pop(); up.push(x); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}
