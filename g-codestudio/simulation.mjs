const CUT_TYPES = new Set(["linear", "arc-cw", "arc-ccw", "rough", "cycle-profile", "finish"]);
const EPSILON = 1e-9;

function samplesForSegment(segment, xScale, resolution = 1) {
  const samples = [];
  for (let pointIndex = 1; pointIndex < segment.points.length; pointIndex += 1) {
    const before = segment.points[pointIndex - 1];
    const after = segment.points[pointIndex];
    const beforeRadius = Math.abs(before.x * xScale);
    const afterRadius = Math.abs(after.x * xScale);
    const dz = after.z - before.z;
    const dr = afterRadius - beforeRadius;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dz), Math.abs(dr)) / resolution));
    for (let step = 0; step <= steps; step += 1) {
      const ratio = step / steps;
      samples.push({
        z: before.z + dz * ratio,
        x: before.x + (after.x - before.x) * ratio,
        radius: beforeRadius + dr * ratio,
        turning: Math.abs(dz) >= Math.abs(dr),
      });
    }
  }
  return samples;
}

function normalizedAngle(angle) {
  let result = angle % (Math.PI * 2);
  if (result < 0) result += Math.PI * 2;
  return result;
}

function angleOnSweep(angle, startAngle, sweep) {
  if (sweep >= 0) return normalizedAngle(angle - startAngle) <= sweep + EPSILON;
  return normalizedAngle(startAngle - angle) <= -sweep + EPSILON;
}

function sampleRange(zPositions, minimumZ, maximumZ) {
  const start = Math.max(0, Math.ceil((minimumZ - zPositions[0]) / (zPositions[1] - zPositions[0]) - EPSILON));
  const end = Math.min(zPositions.length - 1, Math.floor((maximumZ - zPositions[0]) / (zPositions[1] - zPositions[0]) + EPSILON));
  return {start, end};
}

function applyLineEnvelope(profile, zPositions, before, after, xScale, stockRadius) {
  const deltaZ = after.z - before.z;
  if (Math.abs(deltaZ) <= EPSILON) {
    const stockFrontZ = zPositions[zPositions.length - 1];
    if (before.z < zPositions[0] - EPSILON || before.z > stockFrontZ + EPSILON) return null;
    const beforeRadius = before.x * xScale;
    const afterRadius = after.x * xScale;
    const crossesSpindleCenter = Math.min(beforeRadius, afterRadius) <= EPSILON
      && Math.max(beforeRadius, afterRadius) >= -EPSILON;
    const faceRadius = crossesSpindleCenter
      ? 0
      : Math.min(Math.abs(beforeRadius), Math.abs(afterRadius), stockRadius);
    const {start, end} = sampleRange(zPositions, Math.max(zPositions[0], before.z), stockFrontZ);
    for (let index = start; index <= end; index += 1) profile[index] = Math.min(profile[index], faceRadius);
    return crossesSpindleCenter ? before.z : null;
  }

  const {start, end} = sampleRange(zPositions, Math.min(before.z, after.z), Math.max(before.z, after.z));
  for (let index = start; index <= end; index += 1) {
    const ratio = (zPositions[index] - before.z) / deltaZ;
    if (ratio < -EPSILON || ratio > 1 + EPSILON) continue;
    const signedRadius = (before.x + (after.x - before.x) * ratio) * xScale;
    profile[index] = Math.min(profile[index], Math.min(stockRadius, Math.abs(signedRadius)));
  }
  return null;
}

function applyArcEnvelope(profile, zPositions, segment, xScale, stockRadius) {
  const center = segment.center;
  const radius = Number(segment.radius);
  const sweep = Number(segment.sweep);
  if (!center || !(radius > EPSILON) || !Number.isFinite(sweep)) return false;
  const startAngle = Math.atan2(segment.start.x * xScale - center.x, segment.start.z - center.z);
  const {start, end} = sampleRange(zPositions, center.z - radius, center.z + radius);
  for (let index = start; index <= end; index += 1) {
    const cosine = (zPositions[index] - center.z) / radius;
    if (cosine < -1 - EPSILON || cosine > 1 + EPSILON) continue;
    const principal = Math.acos(Math.max(-1, Math.min(1, cosine)));
    for (const angle of [principal, -principal]) {
      if (!angleOnSweep(angle, startAngle, sweep)) continue;
      const candidate = Math.abs(center.x + Math.sin(angle) * radius);
      profile[index] = Math.min(profile[index], Math.min(stockRadius, candidate));
    }
  }
  return true;
}

function applySegmentEnvelope(profile, zPositions, segment, xScale, stockRadius) {
  const sourceMotion = segment.sourceMotion || segment.type;
  if ((sourceMotion === "arc-cw" || sourceMotion === "arc-ccw") && applyArcEnvelope(profile, zPositions, segment, xScale, stockRadius)) return null;
  const points = segment.points?.length >= 2 ? segment.points : [segment.start, segment.end];
  let materialEndZ = null;
  for (let index = 1; index < points.length; index += 1) {
    const facedToZ = applyLineEnvelope(profile, zPositions, points[index - 1], points[index], xScale, stockRadius);
    if (Number.isFinite(facedToZ)) materialEndZ = materialEndZ === null ? facedToZ : Math.min(materialEndZ, facedToZ);
  }
  return materialEndZ;
}

export function stockAxialBounds(stockLength, stockStartZ) {
  const length = Math.max(0, Number(stockLength) || 0);
  const suppliedStart = Number(stockStartZ);
  const startZ = stockStartZ !== undefined && Number.isFinite(suppliedStart) ? suppliedStart : -length;
  return {startZ, endZ: startZ + length, length};
}

export function stockPlacement(overallLength, chuckFaceZ, gripLength = 0) {
  const length = Math.max(0, Number(overallLength) || 0);
  const grip = Math.min(length, Math.max(0, Number(gripLength) || 0));
  const stickout = Math.max(0, length - grip);
  const faceZ = Number.isFinite(Number(chuckFaceZ)) ? Number(chuckFaceZ) : 0;
  return {
    startZ: faceZ - grip,
    endZ: faceZ + stickout,
    length,
    stickoutLength: stickout,
    gripLength: grip,
    faceZ,
  };
}

export function stockContourPoints(stock) {
  const profile = Array.from(stock?.profile || []);
  const positions = stock?.zPositions;
  if (!profile.length || !positions?.length) return [];
  const startZ = Number.isFinite(Number(stock.startZ)) ? Number(stock.startZ) : Number(positions[0]);
  const nominalEndZ = Number.isFinite(Number(stock.endZ)) ? Number(stock.endZ) : Number(positions[positions.length - 1]);
  const materialEndZ = Number.isFinite(Number(stock.materialEndZ))
    ? Math.max(startZ, Math.min(nominalEndZ, Number(stock.materialEndZ)))
    : nominalEndZ;
  let points = profile.map((radius, index) => ({z: Number(positions[index]), radius: Number(radius)}));
  if ((points[0]?.z ?? startZ) > startZ + EPSILON) points.unshift({z: startZ, radius: points[0]?.radius || 0});
  if (materialEndZ < nominalEndZ - EPSILON) {
    points = points.filter((point) => point.z < materialEndZ - EPSILON);
    const faceRadius = [...points].reverse().find((point) => point.radius > EPSILON)?.radius;
    if (!(faceRadius > EPSILON)) return [];
    points.push({z: materialEndZ, radius: faceRadius});
    return points;
  }
  if ((points.at(-1)?.z ?? nominalEndZ) < nominalEndZ - EPSILON) {
    points.push({z: nominalEndZ, radius: points.at(-1)?.radius || 0});
  }
  return points;
}

export function buildStockProfile(segments, {
  stockDiameter, stockLength, stockStartZ, xScale = 0.5, visibleCount = segments.length, columns = 800,
} = {}) {
  const radius = Math.max(0, Number(stockDiameter) || 0) / 2;
  const {startZ, endZ, length} = stockAxialBounds(stockLength, stockStartZ);
  const sampleCount = Math.max(64, Math.round(columns));
  const step = sampleCount > 1 ? length / (sampleCount - 1) : 0;
  const zPositions = new Float64Array(sampleCount);
  const profile = new Float64Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    zPositions[index] = startZ + index * step;
    profile[index] = radius;
  }
  const stock = {
    profile, zPositions, columns: sampleCount, radius, length, startZ, endZ,
    materialEndZ: endZ, removedPercent: 0, analytic: true, visibleCount: 0,
  };
  return extendStockProfile(stock, segments, {startIndex: 0, endIndex: visibleCount, xScale});
}

export function extendStockProfile(stock, segments, {
  startIndex = stock?.visibleCount || 0, endIndex = segments.length, xScale = 0.5,
} = {}) {
  if (!stock?.profile || !stock?.zPositions) return stock;
  const start = Math.max(0, Math.min(segments.length, Math.round(Number(startIndex) || 0)));
  const end = Math.max(start, Math.min(segments.length, Math.round(Number(endIndex) || 0)));
  const profile = new Float64Array(stock.profile);
  const next = {...stock, profile, visibleCount: end};
  if (!next.radius || !next.length) return next;

  let materialEndZ = Number.isFinite(Number(stock.materialEndZ)) ? Number(stock.materialEndZ) : stock.endZ;
  for (const segment of segments.slice(start, end)) {
    if (!CUT_TYPES.has(segment.type)) continue;
    const facedToZ = applySegmentEnvelope(profile, next.zPositions, segment, xScale, next.radius);
    if (Number.isFinite(facedToZ)) materialEndZ = Math.min(materialEndZ, facedToZ);
  }

  let remainingArea = 0;
  for (const profileRadius of profile) remainingArea += profileRadius * profileRadius;
  const removedPercent = profile.length && next.radius
    ? Math.max(0, Math.min(100, (1 - remainingArea / (profile.length * next.radius * next.radius)) * 100))
    : 0;
  return {...next, materialEndZ, removedPercent};
}

// Compatibility alias for callers migrating from the former raster stock model.
export const buildStockGrid = buildStockProfile;

export function collisionPointForSegment(segment, {
  chuckFaceZ = -80, jawDiameter = 70, clearance = 3, chuckDepth = 18, xScale = 0.5,
} = {}) {
  const face = Number(chuckFaceZ);
  const jawRadius = Math.max(0, Number(jawDiameter) || 0) / 2;
  const margin = Math.max(0, Number(clearance) || 0);
  const back = face - Math.max(1, Number(chuckDepth) || 18);
  const samples = samplesForSegment(segment, xScale, 0.5);
  return samples.find((point) => (
    point.z <= face + margin
    && point.z >= back - margin
    && point.radius <= jawRadius + margin
  )) || null;
}

export function findCollisions(segments, options = {}) {
  const collisions = [];
  segments.forEach((segment, segmentIndex) => {
    const point = collisionPointForSegment(segment, options);
    if (point) collisions.push({segmentIndex, segment, point});
  });
  return collisions;
}
