import {stockMaterialIntervals} from "./simulation.mjs";

// Display-only sections of the station-based material model. Never feed these
// decimated polygons back into dimensional comparisons or stock subtraction.
const cache = new WeakMap();

export function hasStockCavities(stock) {
  return Number(stock?.pilotBoreRadius) > 0 || Number(stock?.pilotBoreDiameter) > 0
    || stock?.materialIntervals?.size > 0;
}

function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const pending = [[0, points.length - 1]];
  let work = 0;
  while (pending.length) {
    const [first, last] = pending.pop();
    const a = points[first], b = points[last];
    let maximum = tolerance, selected = -1;
    for (let index = first + 1; index < last; index += 1) {
      if (++work > 8000000) throw new RangeError("Stock section display exceeds its simplification budget; use 2D with a shorter program.");
      const point = points[index];
      const ratio = b.z === a.z ? 0 : (point.z - a.z) / (b.z - a.z);
      const error = Math.abs(point.radius - (a.radius + (b.radius - a.radius) * ratio));
      if (error > maximum) { maximum = error; selected = index; }
    }
    if (selected >= 0) {
      keep[selected] = 1;
      pending.push([first, selected], [selected, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

export function stockSectionPolygons(stock, {tolerance = 0.00254, maximumPoints = 16000} = {}) {
  if (!stock?.zPositions?.length) return [];
  const existing = cache.get(stock);
  if (existing?.tolerance === tolerance && existing.maximumPoints === maximumPoints) return existing.polygons;
  const positions = stock.zPositions;
  if (positions.length > 250001 || !(tolerance > 0)) throw new RangeError("Stock section display budget exceeded.");
  const endZ = Number.isFinite(stock.materialEndZ) ? stock.materialEndZ : positions.at(-1);
  const polygons = [];
  let current = null, pointCount = 0;
  const finish = (boundary) => {
    if (!current) return;
    for (const band of current.bands) {
      if (boundary > band.upper.at(-1).z) {
        band.lower.push({z: boundary, radius: band.lower.at(-1).radius});
        band.upper.push({z: boundary, radius: band.upper.at(-1).radius});
      }
      const points = [...simplify(band.lower, tolerance), ...simplify(band.upper, tolerance).reverse()];
      pointCount += points.length;
      if (pointCount > maximumPoints) throw new RangeError("Stock section has too many display edges; stock math is retained, but its display is blocked.");
      polygons.push(points);
    }
    current = null;
  };
  for (let index = 0; index < positions.length; index += 1) {
    const z = positions[index];
    if (z > endZ) break;
    const intervals = stockMaterialIntervals(stock, index).filter(([low, high]) => high > low);
    if (current && current.bands.length !== intervals.length) {
      finish(index ? (positions[index - 1] + z) / 2 : z);
    }
    if (!intervals.length) continue;
    if (!current) {
      const boundary = index ? Math.max(stock.startZ, (positions[index - 1] + z) / 2) : stock.startZ;
      current = {bands: intervals.map(([low, high]) => ({
        lower: [{z: boundary, radius: low}], upper: [{z: boundary, radius: high}],
      }))};
    }
    intervals.forEach(([low, high], bandIndex) => {
      const band = current.bands[bandIndex];
      if (z > band.lower.at(-1).z) {
        band.lower.push({z, radius: low}); band.upper.push({z, radius: high});
      }
    });
  }
  finish(endZ);
  cache.set(stock, {tolerance, maximumPoints, polygons});
  return polygons;
}
