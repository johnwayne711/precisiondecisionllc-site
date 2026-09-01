const CUT_TYPES = new Set(["linear", "arc-cw", "arc-ccw", "rough", "cycle-profile", "finish"]);
const EPSILON = 1e-9;
const POINT_CUTTING_MODEL = Object.freeze({mode: "point", axialMin: 0, axialMax: 0, axialDirection: "both"});

function hasFiniteAxis(point, axis) {
  return typeof point?.[axis] === "number" && Number.isFinite(point[axis]);
}

/**
 * Identify motion that cannot be reduced to the axisymmetric X/Z turning
 * model. `machiningMode` is the canonical marker for parser-produced live
 * motion. The coordinate fallback deliberately fails closed when a future
 * parser retains Y or C before it can attach that marker.
 */
export function isLiveToolSegment(segment) {
  if (!segment || typeof segment !== "object") return false;
  if (segment.machiningMode === "live-tool" || segment.liveTool === true || segment.cAxisMotion) return true;
  const points = Array.isArray(segment.points) && segment.points.length
    ? segment.points
    : [segment.start, segment.end].filter(Boolean);
  return points.some((point) => hasFiniteAxis(point, "y") || hasFiniteAxis(point, "c"));
}

export function liveToolSimulationWarning(segment, capability) {
  if (!isLiveToolSegment(segment)) return null;
  const common = {
    line: segment.executionLine || segment.line || null,
    toolKey: segment.toolKey || null,
  };
  if (capability === "stock-removal") {
    return {
      ...common,
      code: "live-tool-stock-removal-unsupported",
      message: "Live-tool motion is displayed, but non-axisymmetric stock removal is not yet modeled; stock was left unchanged for this move.",
    };
  }
  if (capability === "collision") {
    return {
      ...common,
      code: "live-tool-collision-unsupported",
      message: "Live-tool motion is displayed, but its 3D cutter/holder collision sweep is not yet modeled; no clearance result was claimed for this move.",
    };
  }
  return null;
}

function isRapidSegment(segment) {
  return segment?.type === "rapid" || segment?.type === "live-rapid";
}

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

function minimumAbsoluteLinearValue(beforeValue, afterValue, minimumRatio, maximumRatio) {
  const first = beforeValue + (afterValue - beforeValue) * minimumRatio;
  const second = beforeValue + (afterValue - beforeValue) * maximumRatio;
  if (Math.min(first, second) <= EPSILON && Math.max(first, second) >= -EPSILON) return 0;
  return Math.min(Math.abs(first), Math.abs(second));
}

function roundedBandOffset(offset, minimumOffset, maximumOffset, cornerRadius) {
  const width = maximumOffset - minimumOffset;
  const radius = Math.max(0, Math.min(Number(cornerRadius) || 0, width / 2));
  if (offset < minimumOffset - EPSILON || offset > maximumOffset + EPSILON) return Infinity;
  if (radius <= EPSILON) return 0;
  if (offset < minimumOffset + radius) {
    const distance = offset - (minimumOffset + radius);
    return radius - Math.sqrt(Math.max(0, radius * radius - distance * distance));
  }
  if (offset > maximumOffset - radius) {
    const distance = offset - (maximumOffset - radius);
    return radius - Math.sqrt(Math.max(0, radius * radius - distance * distance));
  }
  return 0;
}

function minimumRoundedBandRadius(stockZ, before, after, xScale, minimumOffset, maximumOffset, cornerRadius) {
  const deltaZ = after.z - before.z;
  const deltaX = after.x - before.x;
  const candidate = (ratio) => {
    if (ratio < -EPSILON || ratio > 1 + EPSILON) return Infinity;
    const clamped = Math.max(0, Math.min(1, ratio));
    const referenceZ = before.z + deltaZ * clamped;
    const radialOffset = roundedBandOffset(stockZ - referenceZ, minimumOffset, maximumOffset, cornerRadius);
    if (!Number.isFinite(radialOffset)) return Infinity;
    const radius = Math.abs((before.x + deltaX * clamped) * xScale);
    return radius + radialOffset;
  };

  if (Math.abs(deltaZ) <= EPSILON) {
    const radialOffset = roundedBandOffset(stockZ - before.z, minimumOffset, maximumOffset, cornerRadius);
    if (!Number.isFinite(radialOffset)) return Infinity;
    return minimumAbsoluteLinearValue(before.x * xScale, after.x * xScale, 0, 1) + radialOffset;
  }

  const width = maximumOffset - minimumOffset;
  const radius = Math.max(0, Math.min(Number(cornerRadius) || 0, width / 2));
  const breakpoints = [0, 1];
  for (const offset of [minimumOffset, minimumOffset + radius, maximumOffset - radius, maximumOffset]) {
    const ratio = (stockZ - before.z - offset) / deltaZ;
    if (ratio > EPSILON && ratio < 1 - EPSILON) breakpoints.push(ratio);
  }
  if (Math.abs(deltaX) > EPSILON) {
    const centerCrossing = -before.x / deltaX;
    if (centerCrossing > EPSILON && centerCrossing < 1 - EPSILON) breakpoints.push(centerCrossing);
  }
  breakpoints.sort((a, b) => a - b);
  const unique = breakpoints.filter((value, index) => !index || Math.abs(value - breakpoints[index - 1]) > EPSILON);
  let minimum = Infinity;
  for (const ratio of unique) minimum = Math.min(minimum, candidate(ratio));

  // Between the analytic breakpoints the radius-plus-corner-sag function is
  // convex. Golden-section minimization finds the physical cutter envelope
  // without reducing the insert to a rectangular display approximation.
  const phi = (Math.sqrt(5) - 1) / 2;
  for (let index = 1; index < unique.length; index += 1) {
    let left = unique[index - 1];
    let right = unique[index];
    if (right - left <= EPSILON) continue;
    const midpoint = (left + right) / 2;
    if (!Number.isFinite(candidate(midpoint))) continue;
    let first = right - (right - left) * phi;
    let second = left + (right - left) * phi;
    let firstValue = candidate(first);
    let secondValue = candidate(second);
    for (let iteration = 0; iteration < 36; iteration += 1) {
      if (firstValue <= secondValue) {
        right = second;
        second = first;
        secondValue = firstValue;
        first = right - (right - left) * phi;
        firstValue = candidate(first);
      } else {
        left = first;
        first = second;
        firstValue = secondValue;
        second = left + (right - left) * phi;
        secondValue = candidate(second);
      }
    }
    minimum = Math.min(minimum, firstValue, secondValue);
  }
  return minimum;
}

function applyAxialBandLineEnvelope(profile, zPositions, before, after, xScale, stockRadius, axialMin, axialMax, cornerRadius = 0) {
  const minimumOffset = Math.min(axialMin, axialMax);
  const maximumOffset = Math.max(axialMin, axialMax);
  const deltaZ = after.z - before.z;
  const minimumZ = Math.min(before.z, after.z) + minimumOffset;
  const maximumZ = Math.max(before.z, after.z) + maximumOffset;
  const {start, end} = sampleRange(zPositions, minimumZ, maximumZ);
  const beforeRadius = before.x * xScale;
  const afterRadius = after.x * xScale;

  for (let index = start; index <= end; index += 1) {
    const stockZ = zPositions[index];
    if (Number(cornerRadius) > EPSILON) {
      const candidate = minimumRoundedBandRadius(
        stockZ, before, after, xScale, minimumOffset, maximumOffset, cornerRadius,
      );
      if (Number.isFinite(candidate)) profile[index] = Math.min(profile[index], Math.min(stockRadius, candidate));
      continue;
    }
    let minimumRatio = 0;
    let maximumRatio = 1;
    if (Math.abs(deltaZ) <= EPSILON) {
      if (stockZ < before.z + minimumOffset - EPSILON || stockZ > before.z + maximumOffset + EPSILON) continue;
    } else {
      const firstRatio = (stockZ - maximumOffset - before.z) / deltaZ;
      const secondRatio = (stockZ - minimumOffset - before.z) / deltaZ;
      minimumRatio = Math.max(0, Math.min(firstRatio, secondRatio));
      maximumRatio = Math.min(1, Math.max(firstRatio, secondRatio));
      if (minimumRatio > maximumRatio + EPSILON) continue;
    }
    const candidate = minimumAbsoluteLinearValue(beforeRadius, afterRadius, minimumRatio, maximumRatio);
    profile[index] = Math.min(profile[index], Math.min(stockRadius, candidate));
  }
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

function toolModelForSegment(segment, toolResolver) {
  if (typeof toolResolver !== "function") return POINT_CUTTING_MODEL;
  const resolved = toolResolver(segment.toolKey ?? null, segment);
  if (!resolved) return {mode: "unassigned"};
  return resolved.cuttingModel || resolved;
}

function cuttingOffsets(model) {
  if (Number.isFinite(model.axialMin) && Number.isFinite(model.axialMax)) {
    return {minimum: Number(model.axialMin), maximum: Number(model.axialMax)};
  }
  const width = Number(model.axialWidth);
  if (!(width > EPSILON)) return null;
  if (model.tipDatum === "negative-z-edge") return {minimum: 0, maximum: width};
  if (model.tipDatum === "positive-z-edge") return {minimum: -width, maximum: 0};
  if (model.tipDatum === "center") return {minimum: -width / 2, maximum: width / 2};
  return null;
}

function permittedAxialDirection(model, before, after) {
  const direction = model.axialDirection || "both";
  const deltaZ = after.z - before.z;
  if (Math.abs(deltaZ) <= EPSILON || direction === "both") return true;
  if (direction === "positive-z") return deltaZ > 0;
  if (direction === "negative-z") return deltaZ < 0;
  if (direction === "radial-only") return false;
  return false;
}

function warningFor(segment, code, message) {
  return {line: segment.executionLine || segment.line || null, toolKey: segment.toolKey || null, code, message};
}

function applySegmentEnvelope(profile, zPositions, segment, xScale, stockRadius, toolResolver) {
  const model = toolModelForSegment(segment, toolResolver);
  if (model.mode === "unassigned") {
    return {materialEndZ: null, warning: warningFor(segment, "tool-unassigned", `${segment.toolKey || "This motion"} has no confirmed tool assignment; stock removal was not applied.`)};
  }
  if (model.mode === "unsupported") {
    return {materialEndZ: null, warning: warningFor(segment, "tool-removal-unsupported", `${segment.toolKey || "The active tool"} does not yet have a supported stock-removal model.`)};
  }
  if (model.simulationReady === false) {
    return {materialEndZ: null, warning: warningFor(segment, "tool-removal-unconfirmed", `${segment.toolKey || "The active tool"} is not confirmed for dimensional stock removal.`)};
  }

  const offsets = model.mode === "axial-band" ? cuttingOffsets(model) : null;
  if (model.mode === "axial-band" && !offsets) {
    return {materialEndZ: null, warning: warningFor(segment, "tool-datum-unresolved", `${segment.toolKey || "The active groove tool"} needs an explicit cutting width and Z datum edge before stock removal can be modeled.`)};
  }
  const sourceMotion = segment.sourceMotion || segment.type;
  if (offsets && (sourceMotion === "arc-cw" || sourceMotion === "arc-ccw")) {
    return {materialEndZ: null, warning: warningFor(segment, "tool-arc-sweep-unsupported", `${segment.toolKey || "The active groove tool"} uses a finite-width cutter on an arc; exact swept-arc stock removal is not yet supported, so this cut was not applied.`)};
  }
  if (!offsets && (sourceMotion === "arc-cw" || sourceMotion === "arc-ccw") && applyArcEnvelope(profile, zPositions, segment, xScale, stockRadius)) {
    return {materialEndZ: null, warning: null};
  }
  const points = segment.points?.length >= 2 ? segment.points : [segment.start, segment.end];
  for (let index = 1; index < points.length; index += 1) {
    if (!permittedAxialDirection(model, points[index - 1], points[index])) {
      return {materialEndZ: null, warning: warningFor(segment, "tool-direction-blocked", `${segment.toolKey || "The active tool"} is not confirmed for this Z cutting direction; stock removal was not applied.`)};
    }
  }
  let materialEndZ = null;
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    if (offsets) {
      applyAxialBandLineEnvelope(
        profile, zPositions, before, after, xScale, stockRadius,
        offsets.minimum, offsets.maximum, model.cornerRadius,
      );
      continue;
    }
    const facedToZ = applyLineEnvelope(profile, zPositions, before, after, xScale, stockRadius);
    if (Number.isFinite(facedToZ)) materialEndZ = materialEndZ === null ? facedToZ : Math.min(materialEndZ, facedToZ);
  }
  return {materialEndZ, warning: null};
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

export function stockVerificationColumns(stockLength, {
  maximumStep = 0.00254, minimumColumns = 64, maximumColumns = 250001,
} = {}) {
  const length = Math.max(0, Number(stockLength) || 0);
  const step = Math.max(EPSILON, Number(maximumStep) || 0.00254);
  const minimum = Math.max(2, Math.round(Number(minimumColumns) || 64));
  const maximum = Math.max(minimum, Math.round(Number(maximumColumns) || 250001));
  const required = Math.max(minimum, Math.ceil(length / step) + 1);
  if (required > maximum) {
    throw new RangeError(`Stock length requires ${required.toLocaleString("en-US")} verification columns to hold the ${step} mm maximum axial step; the configured safe limit is ${maximum.toLocaleString("en-US")}.`);
  }
  return required;
}

function featurePreservingIndexes(length, maximumPoints, valueAt) {
  const limit = Number.isFinite(Number(maximumPoints)) ? Math.max(2, Math.floor(Number(maximumPoints))) : Infinity;
  if (length <= limit) return Array.from({length}, (_, index) => index);
  if (limit < 8) {
    return Array.from({length: limit}, (_, index) => Math.round(index * (length - 1) / (limit - 1)));
  }
  const indexes = new Set([0, length - 1]);
  const candidates = [];
  for (let index = 1; index < length - 1; index += 1) {
    const previous = Number(valueAt(index - 1));
    const current = Number(valueAt(index));
    const next = Number(valueAt(index + 1));
    if (![previous, current, next].every(Number.isFinite)) continue;
    const leftDelta = current - previous;
    const rightDelta = next - current;
    const curvature = Math.abs(rightDelta - leftDelta);
    if (curvature <= EPSILON) continue;
    const turning = (leftDelta < -EPSILON && rightDelta >= -EPSILON)
      || (leftDelta > EPSILON && rightDelta <= EPSILON);
    candidates.push({index, score: curvature + (turning ? Math.max(Math.abs(leftDelta), Math.abs(rightDelta)) : 0)});
  }
  candidates.sort((first, second) => second.score - first.score || first.index - second.index);
  const selectedCenters = [];
  const centerLimit = Math.max(1, Math.floor((limit - 2) / 3));
  for (const candidate of candidates) {
    if (selectedCenters.length >= centerLimit) break;
    if (selectedCenters.some((index) => Math.abs(index - candidate.index) <= 2)) continue;
    selectedCenters.push(candidate.index);
    for (const index of [candidate.index - 1, candidate.index, candidate.index + 1]) {
      if (index >= 0 && index < length && indexes.size < limit) indexes.add(index);
    }
  }
  for (let index = 1; indexes.size < limit && index < limit - 1; index += 1) {
    indexes.add(Math.round(index * (length - 1) / (limit - 1)));
  }
  return [...indexes].sort((first, second) => first - second);
}

function limitedContourPoints(points, maximumPoints) {
  return featurePreservingIndexes(points.length, maximumPoints, (index) => points[index].radius)
    .map((index) => points[index]);
}

export function stockContourPoints(stock, {maximumPoints = Infinity} = {}) {
  const profileSource = stock?.profile;
  const positions = stock?.zPositions;
  if (!profileSource?.length || !positions?.length) return [];
  const startZ = Number.isFinite(Number(stock.startZ)) ? Number(stock.startZ) : Number(positions[0]);
  const nominalEndZ = Number.isFinite(Number(stock.endZ)) ? Number(stock.endZ) : Number(positions[positions.length - 1]);
  const materialEndZ = Number.isFinite(Number(stock.materialEndZ))
    ? Math.max(startZ, Math.min(nominalEndZ, Number(stock.materialEndZ)))
    : nominalEndZ;
  const displayLimit = Number.isFinite(Number(maximumPoints))
    ? Math.max(2, Math.floor(Number(maximumPoints)))
    : Infinity;
  const sourceStartsAtStock = Math.abs(Number(positions[0]) - startZ) <= EPSILON;
  const sourceEndsAtStock = Math.abs(Number(positions[positions.length - 1]) - nominalEndZ) <= EPSILON;
  if (displayLimit < profileSource.length
    && materialEndZ >= nominalEndZ - EPSILON
    && sourceStartsAtStock
    && sourceEndsAtStock) {
    return featurePreservingIndexes(profileSource.length, displayLimit, (index) => Number(profileSource[index]))
      .map((sourceIndex) => ({z: Number(positions[sourceIndex]), radius: Number(profileSource[sourceIndex])}));
  }
  const profile = Array.from(profileSource);
  let points = profile.map((radius, index) => ({z: Number(positions[index]), radius: Number(radius)}));
  if ((points[0]?.z ?? startZ) > startZ + EPSILON) points.unshift({z: startZ, radius: points[0]?.radius || 0});
  if (materialEndZ < nominalEndZ - EPSILON) {
    points = points.filter((point) => point.z < materialEndZ - EPSILON);
    const faceRadius = [...points].reverse().find((point) => point.radius > EPSILON)?.radius;
    if (!(faceRadius > EPSILON)) return [];
    points.push({z: materialEndZ, radius: faceRadius});
    return limitedContourPoints(points, maximumPoints);
  }
  if ((points.at(-1)?.z ?? nominalEndZ) < nominalEndZ - EPSILON) {
    points.push({z: nominalEndZ, radius: points.at(-1)?.radius || 0});
  }
  return limitedContourPoints(points, maximumPoints);
}

export function buildStockProfile(segments, {
  stockDiameter, stockLength, stockStartZ, xScale = 0.5, visibleCount = segments.length, columns = 800, toolResolver = null,
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
  return extendStockProfile(stock, segments, {startIndex: 0, endIndex: visibleCount, xScale, toolResolver});
}

export function extendStockProfile(stock, segments, {
  startIndex = stock?.visibleCount || 0, endIndex = segments.length, xScale = 0.5, toolResolver = null,
} = {}) {
  if (!stock?.profile || !stock?.zPositions) return stock;
  const start = Math.max(0, Math.min(segments.length, Math.round(Number(startIndex) || 0)));
  const end = Math.max(start, Math.min(segments.length, Math.round(Number(endIndex) || 0)));
  const profile = new Float64Array(stock.profile);
  const next = {...stock, profile, visibleCount: end};
  if (!next.radius || !next.length) return next;

  let materialEndZ = Number.isFinite(Number(stock.materialEndZ)) ? Number(stock.materialEndZ) : stock.endZ;
  const toolWarnings = [...(stock.toolWarnings || [])];
  const warningKeys = new Set(toolWarnings.map((warning) => `${warning.code}|${warning.line}|${warning.toolKey}`));
  for (const segment of segments.slice(start, end)) {
    if (segment?.verificationBlocked || segment?.liveToolBlocked) {
      const warning = {
        line: segment.executionLine || segment.line || null,
        toolKey: segment.toolKey || null,
        code: "verification-blocked-stock-removal",
        message: "Verification-blocked motion is displayed but excluded from stock-removal claims.",
      };
      const key = `${warning.code}|${warning.line}|${warning.toolKey}`;
      if (!warningKeys.has(key)) {
        warningKeys.add(key);
        toolWarnings.push(warning);
      }
      continue;
    }
    if (isLiveToolSegment(segment)) {
      if (!isRapidSegment(segment)) {
        const warning = liveToolSimulationWarning(segment, "stock-removal");
        const key = `${warning.code}|${warning.line}|${warning.toolKey}`;
        if (!warningKeys.has(key)) {
          warningKeys.add(key);
          toolWarnings.push(warning);
        }
      }
      continue;
    }
    if (!CUT_TYPES.has(segment.type)) continue;
    const result = applySegmentEnvelope(profile, next.zPositions, segment, xScale, next.radius, toolResolver);
    if (Number.isFinite(result.materialEndZ)) materialEndZ = Math.min(materialEndZ, result.materialEndZ);
    if (result.warning) {
      const key = `${result.warning.code}|${result.warning.line}|${result.warning.toolKey}`;
      if (!warningKeys.has(key)) {
        warningKeys.add(key);
        toolWarnings.push(result.warning);
      }
    }
  }

  let remainingArea = 0;
  for (const profileRadius of profile) remainingArea += profileRadius * profileRadius;
  const removedPercent = profile.length && next.radius
    ? Math.max(0, Math.min(100, (1 - remainingArea / (profile.length * next.radius * next.radius)) * 100))
    : 0;
  return {...next, materialEndZ, removedPercent, toolWarnings};
}

// Compatibility alias for callers migrating from the former raster stock model.
export const buildStockGrid = buildStockProfile;

export function collisionPointForSegment(segment, {
  chuckFaceZ = -80, jawDiameter = 70, clearance = 3, chuckDepth = 18, xScale = 0.5,
} = {}) {
  if (isLiveToolSegment(segment)) {
    throw new Error("Live-tool collision clearance is unresolved in the axisymmetric model; use evaluateCollisions() and inspect its warnings.");
  }
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

export function evaluateCollisions(segments, options = {}) {
  const collisions = [];
  const warnings = [];
  const warningKeys = new Set();
  for (const operation of Array.isArray(options.unresolvedOperations) ? options.unresolvedOperations : []) {
    if (!operation?.blocked || operation?.displayed) continue;
    const warning = {
      line: operation.line || null,
      toolKey: null,
      code: "unresolved-live-tool-operation",
      message: "A verification-blocked live-tool operation has no drawable segment; collision clearance is PATH ONLY.",
    };
    const key = `${warning.code}|${warning.line}|${warning.toolKey}`;
    if (!warningKeys.has(key)) {
      warningKeys.add(key);
      warnings.push(warning);
    }
  }
  for (const motion of Array.isArray(options.cAxisMotions) ? options.cAxisMotions : []) {
    if (motion?.combinedWithLinearAxes) continue;
    const warning = {
      line: motion?.line || null,
      toolKey: null,
      code: "c-axis-collision-unsupported",
      message: "Standalone C-axis motion is retained for timing and comparison, but collision clearance is PATH ONLY.",
    };
    const key = `${warning.code}|${warning.line}|${warning.toolKey}`;
    if (!warningKeys.has(key)) {
      warningKeys.add(key);
      warnings.push(warning);
    }
  }
  segments.forEach((segment, segmentIndex) => {
    if (isLiveToolSegment(segment)) {
      const warning = liveToolSimulationWarning(segment, "collision");
      const key = `${warning.code}|${warning.line}|${warning.toolKey}`;
      if (!warningKeys.has(key)) {
        warningKeys.add(key);
        warnings.push(warning);
      }
      return;
    }
    const point = collisionPointForSegment(segment, options);
    if (point) collisions.push({segmentIndex, segment, point});
  });
  return {collisions, warnings};
}

export function findCollisions(segments, options = {}) {
  const evaluation = evaluateCollisions(segments, options);
  if (evaluation.warnings.length) {
    throw new Error("Collision verification is unresolved for one or more live-tool moves; use evaluateCollisions() and inspect both collisions and warnings.");
  }
  return evaluation.collisions;
}
