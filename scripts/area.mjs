// Coarse polygon: Manhattan south of 59th St / Central Park South.
export const MANHATTAN_SOUTH = [
  [-74.0195,40.7000],[-74.0185,40.7080],[-74.0160,40.7160],[-74.0140,40.7300],[-74.0118,40.7440],[-74.0095,40.7525],
  [-74.0045,40.7610],[-73.9975,40.7705],[-73.9925,40.7740],[-73.9585,40.7595],[-73.9685,40.7470],[-73.9715,40.7380],
  [-73.9735,40.7280],[-73.9720,40.7180],[-73.9760,40.7105],[-73.9900,40.7075],[-74.0000,40.7045],[-74.0100,40.7000],[-74.0195,40.7000]
];
export function inPoly([x,y], poly = MANHATTAN_SOUTH) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
