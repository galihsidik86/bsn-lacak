// Shared geo helpers used by both petugas (Mobile) and admin (Tracking)
// screens so the visualized route is computed identically on both ends.

export function distMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371_000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat = ((a.lat + b.lat) / 2) * Math.PI / 180;
  const x = dLng * Math.cos(lat);
  return Math.hypot(dLat, x) * R;
}

// Greedy nearest-neighbor: from the start point, repeatedly pick the closest
// unvisited stop. O(n²) — fine for ≤ ~20 stops. Returns the reordered list
// plus total tour length in meters.
export function orderNearest<T extends { lat: number; lng: number }>(
  start: { lat: number; lng: number }, stops: T[],
): { ordered: T[]; meters: number } {
  const remaining = [...stops];
  const ordered: T[] = [];
  let cur = start;
  let total = 0;
  while (remaining.length) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = distMeters(cur, remaining[i]);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    total += bestDist;
    ordered.push(next);
    cur = next;
  }
  return { ordered, meters: total };
}
