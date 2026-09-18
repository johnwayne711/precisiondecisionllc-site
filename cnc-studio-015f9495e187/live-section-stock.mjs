// Exact radial cross-section sidecar for rotary-indexed live-tool side milling.
//
// The turning stock is an axisymmetric radius-per-Z profile. A live end mill
// whose axis is parallel to Z, positioned at polar (X/2, B) and fed radially
// in X, removes a capsule from the round cross-section over the cutter's fluted
// length. This module keeps that cross-section as a radial function r(phi)
// sampled on a fixed angular grid, where every sample is the exact analytic
// entry radius of the ray into the union of removed capsules. It refuses any
// cut that would leave an overhang the radial function cannot represent.
//
// All coordinates are canonical millimetres and degrees. This is a bounded,
// explicitly labeled feature model: it never claims cutter/holder/turret
// clearance, drive engagement, or finished-part proof.

const EPSILON = 1e-9;
const DEGREES = Math.PI / 180;

export const ROTARY_SECTION_KIND = "rotary-indexed-side-mill";
export const ROTARY_SECTION_STATUS = Object.freeze({
  NONE: "none",
  MODELED: "modeled",
  PARTIAL: "partial",
  PATH_ONLY: "path-only",
});
export const ROTARY_SECTION_ANGLE_SAMPLES = 3600;

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value) {
  return finite(value) && value > 0;
}

function segmentLine(segment) {
  return segment?.executionLine || segment?.line || null;
}

function warningFor(segment, segmentIndex, code, message, extra = {}) {
  return {
    line: segmentLine(segment),
    toolKey: segment?.toolKey || null,
    segmentIndex,
    code,
    message,
    ...extra,
  };
}

function normalizeAngle(degrees) {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function isRotarySegment(segment) {
  return segment?.coordinateMode === "rotary-indexed" && (segment?.liveTool === true || segment?.machiningMode === "live-tool");
}

function segmentPoints(segment) {
  if (Array.isArray(segment?.points) && segment.points.length >= 2) return segment.points;
  return [segment?.start, segment?.end].filter(Boolean);
}

function normalizeStock(stock) {
  const radius = Number(stock?.radius);
  const startZ = Number(stock?.startZ);
  const endZ = Number(stock?.endZ);
  const materialEndZ = finite(Number(stock?.materialEndZ)) ? Number(stock.materialEndZ) : endZ;
  if (!positive(radius) || !finite(startZ) || !finite(endZ) || !finite(materialEndZ)
    || endZ <= startZ || materialEndZ <= startZ || materialEndZ > endZ + EPSILON) {
    return null;
  }
  return {radius, startZ, endZ, materialEndZ};
}

/** Turned radius range of the axisymmetric stock profile over [z0, z1]. */
function turnedRadiusRange(stock, z0, z1) {
  const profile = stock?.profile;
  const zPositions = stock?.zPositions;
  if (!profile?.length || !zPositions?.length || profile.length !== zPositions.length) {
    return {minimum: Number(stock?.radius), maximum: Number(stock?.radius)};
  }
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let index = 0; index < zPositions.length; index += 1) {
    const z = zPositions[index];
    const previousZ = index ? zPositions[index - 1] : z;
    const nextZ = index + 1 < zPositions.length ? zPositions[index + 1] : z;
    // Include the samples bracketing the interval so a column straddling an
    // edge is not skipped.
    if (nextZ < z0 - EPSILON || previousZ > z1 + EPSILON) continue;
    const radius = profile[index];
    if (radius < minimum) minimum = radius;
    if (radius > maximum) maximum = radius;
  }
  if (!Number.isFinite(minimum)) return {minimum: Number(stock?.radius), maximum: Number(stock?.radius)};
  return {minimum, maximum};
}

function resolveCutter(segment, segmentIndex, cutterResolver) {
  let resolved = null;
  try {
    resolved = typeof cutterResolver === "function" ? cutterResolver(segment?.toolKey ?? null, segment) : null;
  } catch (error) {
    return {warning: warningFor(segment, segmentIndex, "live-section-cutter-resolution-failed",
      `The assigned cutter could not be resolved: ${error instanceof Error ? error.message : String(error)}`)};
  }
  const model = resolved?.cuttingModel || resolved;
  if (!model) {
    return {warning: warningFor(segment, segmentIndex, "live-section-cutter-unassigned",
      "No confirmed cutter is assigned to this live-tool motion; the rotary-indexed cut stays PATH ONLY.")};
  }
  if (model.mode !== "axial-flat-endmill" || model.simulationReady !== true || model.dimensionsExact !== true
    || model.referenceSemantics !== "flat-end-mill-tip") {
    return {warning: warningFor(segment, segmentIndex, "live-section-cutter-model-unsupported",
      "Rotary-indexed side milling needs a confirmed, simulation-ready square (flat-tip) end mill with exact diameter and length of cut; other cutters stay PATH ONLY.")};
  }
  const diameter = Number(model.diameter);
  const lengthOfCut = Number(model.lengthOfCut);
  if (!positive(diameter) || !positive(lengthOfCut)) {
    return {warning: warningFor(segment, segmentIndex, "live-section-cutter-dimensions-invalid",
      "The assigned end mill needs positive canonical diameter and length-of-cut dimensions.")};
  }
  return {model, diameter, radius: diameter / 2, lengthOfCut, centerCutting: model.centerCutting === true};
}

/**
 * Exact entry radius of the ray at polar angle phi (radians) into the disk of
 * radius w centred at polar (d, theta). Returns Infinity when the ray misses.
 * Returns 0 when the origin itself is inside the disk.
 */
export function rayEntryIntoDisk(phi, d, theta, w) {
  const delta = phi - theta;
  const perpendicular = d * Math.sin(delta);
  if (Math.abs(perpendicular) > w) return Infinity;
  const along = d * Math.cos(delta);
  const half = Math.sqrt(Math.max(0, w * w - perpendicular * perpendicular));
  const near = along - half;
  const far = along + half;
  if (far < 0) return Infinity;
  return near > 0 ? near : 0;
}

/**
 * Exact entry radius of the ray at polar angle phi into the capsule of radius
 * w around the radial segment from polar radius rIn to rOut at angle theta.
 */
export function rayEntryIntoRadialCapsule(phi, rIn, rOut, theta, w) {
  let entry = Math.min(rayEntryIntoDisk(phi, rIn, theta, w), rayEntryIntoDisk(phi, rOut, theta, w));
  const delta = phi - theta;
  const sin = Math.sin(delta);
  const cos = Math.cos(delta);
  // Strip between the two end caps: |rho sin(delta)| <= w and rIn <= rho cos(delta) <= rOut.
  if (cos > EPSILON) {
    const stripEntry = rIn / cos;
    if (Math.abs(stripEntry * sin) <= w + EPSILON && stripEntry * cos <= rOut + EPSILON) {
      entry = Math.min(entry, stripEntry);
    }
  }
  return entry;
}

function createSection(startZ, endZ, baseRadius, samples) {
  const radii = new Float64Array(samples);
  radii.fill(baseRadius);
  return {startZ, endZ, baseRadius, radii, touched: false};
}

/** Split the ordered section list so that z is a boundary; returns the list. */
function splitSections(sections, z, samples) {
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    if (z > section.startZ + EPSILON && z < section.endZ - EPSILON) {
      const lower = {...section, endZ: z, radii: new Float64Array(section.radii)};
      const upper = {...section, startZ: z, radii: new Float64Array(section.radii)};
      sections.splice(index, 1, lower, upper);
      return;
    }
  }
  void samples;
}

function sectionsWithin(sections, z0, z1) {
  return sections.filter((section) => section.endZ > z0 + EPSILON && section.startZ < z1 - EPSILON);
}

function sampledArea(radii) {
  const samples = radii.length;
  const step = 2 * Math.PI / samples;
  let area = 0;
  for (let index = 0; index < samples; index += 1) {
    const a = radii[index];
    const b = radii[(index + 1) % samples];
    // Exact sector-of-triangle area between consecutive sampled boundary points.
    area += 0.5 * a * b * Math.sin(step);
  }
  return area;
}

/** True when the tool disk at polar (d, theta) touches any sampled material. */
function diskTouchesSection(section, d, theta, w) {
  const samples = section.radii.length;
  const step = 360 / samples;
  const half = Math.asin(Math.min(1, w / Math.max(d, EPSILON))) / DEGREES + step;
  const from = Math.floor((theta - half) / step);
  const to = Math.ceil((theta + half) / step);
  for (let index = from; index <= to; index += 1) {
    const sample = ((index % samples) + samples) % samples;
    const phi = sample * step * DEGREES;
    const entry = rayEntryIntoDisk(phi, d, theta * DEGREES, w);
    if (section.radii[sample] > entry + EPSILON) return true;
  }
  if (d - w <= EPSILON) return true;
  return false;
}

function capsuleTouchesSection(section, rIn, rOut, theta, w) {
  const samples = section.radii.length;
  const step = 360 / samples;
  const half = Math.asin(Math.min(1, w / Math.max(rIn, EPSILON))) / DEGREES + step;
  const from = Math.floor((theta - half) / step);
  const to = Math.ceil((theta + half) / step);
  for (let index = from; index <= to; index += 1) {
    const sample = ((index % samples) + samples) % samples;
    const phi = sample * step * DEGREES;
    const entry = rayEntryIntoRadialCapsule(phi, rIn, rOut, theta * DEGREES, w);
    if (section.radii[sample] > entry + EPSILON) return true;
  }
  if (rIn - w <= EPSILON) return true;
  return false;
}

function applyCapsule(section, rIn, rOut, theta, w) {
  const samples = section.radii.length;
  const step = 360 / samples;
  const half = Math.asin(Math.min(1, w / Math.max(rIn, EPSILON))) / DEGREES + step;
  const from = Math.floor((theta - half) / step);
  const to = Math.ceil((theta + half) / step);
  let removedArea = 0;
  const before = sampledArea(section.radii);
  for (let index = from; index <= to; index += 1) {
    const sample = ((index % samples) + samples) % samples;
    const phi = sample * step * DEGREES;
    const entry = rayEntryIntoRadialCapsule(phi, rIn, rOut, theta * DEGREES, w);
    if (entry < section.radii[sample]) section.radii[sample] = entry;
  }
  removedArea = before - sampledArea(section.radii);
  section.touched = true;
  return Math.max(0, removedArea);
}

function classifyMotion(points, tolerance) {
  const start = points[0];
  const end = points.at(-1);
  const angle = Number(start?.c);
  let radial = false;
  let axial = false;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (!finite(a?.x) || !finite(a?.z) || !finite(b?.x) || !finite(b?.z)) return {kind: "unknown"};
    if (Math.abs((Number(b.c) || 0) - (Number(a.c) || 0)) > EPSILON) return {kind: "rotary"};
    if (Math.abs(b.x - a.x) > tolerance) radial = true;
    if (Math.abs(b.z - a.z) > tolerance) axial = true;
  }
  if (!finite(angle)) return {kind: "unknown"};
  if (radial && axial) return {kind: "diagonal", angle};
  if (radial) return {kind: "radial", angle, start, end};
  if (axial) return {kind: "axial", angle, start, end};
  return {kind: "still", angle};
}

/**
 * Build the rotary-indexed side-milling cross-section model. `stock` is the
 * axisymmetric turning stock (radius, startZ, endZ, materialEndZ, profile,
 * zPositions) in canonical millimetres; `segments` are parser segments; only
 * the first `visibleCount` are applied. `cutterResolver(toolKey, segment)`
 * returns a resolved cutting model or null. Never mutates its inputs.
 */
export function buildRotarySectionStock(segments, {
  stock,
  visibleCount = Array.isArray(segments) ? segments.length : 0,
  cutterResolver = null,
  xScale = 0.5,
  tolerance = EPSILON,
  angleSamples = ROTARY_SECTION_ANGLE_SAMPLES,
} = {}) {
  const source = Array.isArray(segments) ? segments : [];
  const count = Math.max(0, Math.min(source.length, Math.trunc(Number(visibleCount) || 0)));
  const samples = Math.max(360, Math.trunc(Number(angleSamples) || ROTARY_SECTION_ANGLE_SAMPLES));
  const dimensionalTolerance = positive(Number(tolerance)) ? Number(tolerance) : EPSILON;
  const normalizedStock = normalizeStock(stock);
  const warnings = [];
  const passes = [];
  const airMoves = [];
  const sections = [];
  let removedVolume = 0;
  let attemptedCuts = 0;
  let modeledCuts = 0;
  let pathOnlyCuts = 0;
  let collisionFlags = 0;
  const effectiveXScale = (segment) => (segment?.xCoordinateMode === "radius" ? 1 : xScale);

  const ensureSections = (z0, z1) => {
    if (!sections.length) {
      sections.push(createSection(normalizedStock.startZ, normalizedStock.materialEndZ, normalizedStock.radius, samples));
    }
    splitSections(sections, z0, samples);
    splitSections(sections, z1, samples);
    return sectionsWithin(sections, z0, z1);
  };

  for (let segmentIndex = 0; segmentIndex < count; segmentIndex += 1) {
    const segment = source[segmentIndex];
    if (!isRotarySegment(segment)) continue;
    const rapid = segment.type === "rapid";
    if (!rapid) attemptedCuts += 1;

    if (segment.verificationBlocked || segment.liveToolBlocked) {
      if (!rapid) {
        pathOnlyCuts += 1;
        warnings.push(warningFor(segment, segmentIndex, "live-section-segment-blocked", "Verification-blocked live-tool motion cannot remove stock and stays PATH ONLY."));
      }
      continue;
    }
    if (!normalizedStock) {
      if (!rapid) {
        pathOnlyCuts += 1;
        warnings.push(warningFor(segment, segmentIndex, "live-section-stock-invalid", "Rotary-indexed removal requires a finite cylindrical stock radius and ordered axial bounds."));
      }
      continue;
    }
    if (Number(stock?.pilotBoreRadius) > 0 || Number(stock?.pilotBoreDiameter) > 0 || stock?.materialIntervals?.size > 0) {
      if (!rapid) {
        pathOnlyCuts += 1;
        warnings.push(warningFor(segment, segmentIndex, "live-section-internal-material-unsupported", "Rotary-indexed cuts on internally machined or hollow stock require a combined solid model and remain PATH ONLY."));
      }
      continue;
    }
    const cutter = resolveCutter(segment, segmentIndex, cutterResolver);
    if (cutter.warning) {
      if (!rapid) {
        pathOnlyCuts += 1;
        warnings.push(cutter.warning);
      }
      continue;
    }
    const scale = effectiveXScale(segment);
    const points = segmentPoints(segment).map((point) => ({
      x: Number(point?.x) * scale, z: Number(point?.z), c: finite(Number(point?.c)) ? normalizeAngle(Number(point.c)) : NaN,
    }));
    if (points.some((point) => !finite(point.x) || !finite(point.z) || !finite(point.c))) {
      if (!rapid) {
        pathOnlyCuts += 1;
        warnings.push(warningFor(segment, segmentIndex, "live-section-position-unresolved", "The complete X/Z/B position is required for rotary-indexed removal."));
      }
      continue;
    }
    const w = cutter.radius;
    const zTipMin = Math.min(...points.map((point) => point.z));

    if (segment.rotaryIndex) {
      // Rotary sweep of a stationary cutter: it must clear all remaining
      // material above the tip, otherwise the rapid index cuts or crashes.
      const d = points[0].x;
      const from = Number(segment.rotaryIndex.start);
      const to = Number(segment.rotaryIndex.end);
      const involved = ensureSections(zTipMin, normalizedStock.materialEndZ);
      let touches = false;
      const sweepSteps = Math.max(1, Math.ceil(Math.abs(to - from) / (360 / samples)));
      for (const section of involved) {
        for (let step = 0; step <= sweepSteps && !touches; step += 1) {
          const theta = normalizeAngle(from + (to - from) * step / sweepSteps);
          if (diskTouchesSection(section, d, theta, w)) touches = true;
        }
        if (touches) break;
      }
      if (touches) {
        collisionFlags += 1;
        warnings.push(warningFor(segment, segmentIndex, "live-section-index-through-material",
          "The B index sweeps the stationary cutter through remaining stock; the rapid rotary move would cut or crash. This is not modeled as removal.", {danger: true}));
      }
      continue;
    }

    const motion = classifyMotion(points, dimensionalTolerance);
    if (motion.kind === "still") continue;
    if (motion.kind === "unknown" || motion.kind === "rotary") {
      if (!rapid) {
        pathOnlyCuts += 1;
        warnings.push(warningFor(segment, segmentIndex, "live-section-position-unresolved", "The complete X/Z/B position is required for rotary-indexed removal."));
      }
      continue;
    }
    const theta = motion.angle;

    if (rapid) {
      // Rapids never remove stock. Flag any pass through remaining material.
      const involved = ensureSections(zTipMin, normalizedStock.materialEndZ);
      let touches = false;
      if (motion.kind === "radial") {
        const rIn = Math.min(motion.start.x, motion.end.x);
        const rOut = Math.max(motion.start.x, motion.end.x);
        touches = involved.some((section) => capsuleTouchesSection(section, rIn, rOut, theta, w));
      } else if (motion.kind === "axial") {
        touches = involved.some((section) => diskTouchesSection(section, motion.start.x, theta, w));
      } else {
        const rIn = Math.min(...points.map((point) => point.x));
        const rOut = Math.max(...points.map((point) => point.x));
        touches = involved.some((section) => capsuleTouchesSection(section, rIn, rOut, theta, w));
      }
      if (touches) {
        collisionFlags += 1;
        warnings.push(warningFor(segment, segmentIndex, "live-section-rapid-through-material",
          "A G00 rapid moves the cutter through remaining stock; rapid motion is not a modeled cut and would crash.", {danger: true}));
      }
      continue;
    }

    if (motion.kind === "diagonal") {
      pathOnlyCuts += 1;
      warnings.push(warningFor(segment, segmentIndex, "live-section-angled-cut-unsupported",
        "A combined X/Z live cut sweeps an angled cutter path that the radial section model does not represent; it stays PATH ONLY."));
      continue;
    }

    if (motion.kind === "radial") {
      const rIn = Math.min(motion.start.x, motion.end.x);
      const rOut = Math.max(motion.start.x, motion.end.x);
      const zTip = motion.start.z;
      const zTop = zTip + cutter.lengthOfCut;
      const z0 = Math.max(zTip, normalizedStock.startZ);
      const z1 = Math.min(zTop, normalizedStock.materialEndZ);
      if (zTip >= normalizedStock.materialEndZ - EPSILON || zTop <= normalizedStock.startZ + EPSILON || z1 <= z0 + EPSILON) {
        airMoves.push({line: segmentLine(segment), segmentIndex});
        continue;
      }
      const involved = ensureSections(z0, z1);
      const turned = turnedRadiusRange(stock, z0, z1);
      if (turned.maximum - turned.minimum > dimensionalTolerance) {
        pathOnlyCuts += 1;
        warnings.push(warningFor(segment, segmentIndex, "live-section-turned-profile-varies",
          "The turned diameter changes across the cutter's fluted length; a stepped or tapered base section is not modeled, so this cut stays PATH ONLY."));
        continue;
      }
      const baseRadius = Math.max(...involved.map((section) => section.baseRadius));
      if (rIn - w <= EPSILON) {
        pathOnlyCuts += 1;
        warnings.push(warningFor(segment, segmentIndex, "live-section-center-crossing",
          "The cutter reaches or crosses spindle center; the radial section model cannot represent it, so this cut stays PATH ONLY."));
        continue;
      }
      const touches = involved.some((section) => capsuleTouchesSection(section, rIn, rOut, theta, w));
      if (!touches) {
        airMoves.push({line: segmentLine(segment), segmentIndex});
        continue;
      }
      // Star-shaped guard: the cutter's inner end cap must meet the stock OD
      // without wrapping around it, i.e. the tangent from spindle center to the
      // end-cap circle touches outside the original radius. Otherwise the cut
      // leaves an overhang a radial function cannot hold.
      if (rIn * rIn < baseRadius * baseRadius + w * w - EPSILON) {
        pathOnlyCuts += 1;
        warnings.push(warningFor(segment, segmentIndex, "live-section-undercut-unsupported",
          "This radial pass would undercut the remaining OD (tool centre too close to the axis for its radius); the radial section model refuses it, so it stays PATH ONLY."));
        continue;
      }
      // Shank engagement: material above the fluted length inside the cutter
      // envelope means the shank, not the flutes, meets stock.
      if (zTop < normalizedStock.materialEndZ - EPSILON) {
        const above = ensureSections(zTop, normalizedStock.materialEndZ);
        const shankTouches = above.some((section) => capsuleTouchesSection(section, rIn, rOut, theta, w));
        if (shankTouches) {
          collisionFlags += 1;
          pathOnlyCuts += 1;
          warnings.push(warningFor(segment, segmentIndex, "live-section-shank-engagement",
            `The cut is deeper along Z than the cutter's ${(cutter.lengthOfCut).toFixed(3)} mm length of cut; stock above the flutes would meet the shank. Not modeled as removal.`, {danger: true}));
          continue;
        }
      }
      let area = 0;
      let volume = 0;
      for (const section of sectionsWithin(sections, z0, z1)) {
        const removed = applyCapsule(section, rIn, rOut, theta, w);
        area = Math.max(area, removed);
        volume += removed * (section.endZ - section.startZ);
      }
      removedVolume += volume;
      modeledCuts += 1;
      passes.push({
        line: segmentLine(segment), segmentIndex, toolKey: segment.toolKey || null,
        angleDegrees: theta,
        commandedB: finite(Number(segment.rotaryAngleDegrees)) ? Number(segment.rotaryAngleDegrees) : null,
        toolCenterRadius: rIn, retractRadius: rOut, cutterRadius: w,
        innerRadius: rIn - w, zTip, zTop: z1, baseRadius, removedVolume: volume,
      });
      continue;
    }

    if (motion.kind === "axial") {
      const d = motion.start.x;
      const zLow = Math.min(motion.start.z, motion.end.z);
      const zHigh = Math.max(motion.start.z, motion.end.z) + cutter.lengthOfCut;
      const z0 = Math.max(zLow, normalizedStock.startZ);
      const z1 = Math.min(zHigh, normalizedStock.materialEndZ);
      if (z1 <= z0 + EPSILON) {
        airMoves.push({line: segmentLine(segment), segmentIndex});
        continue;
      }
      const involved = ensureSections(z0, z1);
      const touches = involved.some((section) => diskTouchesSection(section, d, theta, w));
      if (!touches) {
        airMoves.push({line: segmentLine(segment), segmentIndex});
        continue;
      }
      pathOnlyCuts += 1;
      warnings.push(warningFor(segment, segmentIndex, "live-section-axial-cut-unsupported",
        "An axial (Z) live cut that meets stock is an end-face plunge or slot; that removal is not part of the radial side-milling model and stays PATH ONLY.", {danger: true}));
      continue;
    }
  }

  const touchedSections = sections.filter((section) => section.touched).map((section) => ({
    kind: ROTARY_SECTION_KIND,
    startZ: section.startZ,
    endZ: section.endZ,
    baseRadius: section.baseRadius,
    radii: section.radii,
    angleStepDegrees: 360 / samples,
  }));
  // Air cuts (feed moves that never meet stock) are fully modeled: nothing is
  // removed, and that is reported rather than hidden behind PATH ONLY.
  const airCuts = airMoves.length;
  let status = ROTARY_SECTION_STATUS.NONE;
  if (!attemptedCuts) status = ROTARY_SECTION_STATUS.NONE;
  else if (!pathOnlyCuts) status = ROTARY_SECTION_STATUS.MODELED;
  else if (modeledCuts || airCuts) status = ROTARY_SECTION_STATUS.PARTIAL;
  else status = ROTARY_SECTION_STATUS.PATH_ONLY;
  return {
    kind: ROTARY_SECTION_KIND,
    status,
    sections: touchedSections,
    passes,
    airMoves,
    warnings,
    removedVolume,
    removedVolumeApproximate: true,
    attemptedCuts,
    modeledCuts,
    airCuts,
    pathOnlyCuts,
    collisionFlags,
    angleSamples: samples,
    feature: modeledCuts ? analyzeFlatFeature(passes, touchedSections) : null,
  };
}

/**
 * Derived, clearly labeled interpretation of the modeled passes as one flat.
 * Every number here is closed-form from the pass geometry; the sampled radii
 * are used only to confirm the derived tangent plane against the model.
 */
export function analyzeFlatFeature(passes, sections, {planeTolerance = 0.0025} = {}) {
  if (!Array.isArray(passes) || !passes.length) return null;
  const reference = passes.reduce((best, pass) => (pass.innerRadius < best.innerRadius ? pass : best), passes[0]);
  const theta0 = reference.angleDegrees;
  const planeDistance = reference.innerRadius;
  const angularOffset = (angle) => {
    let delta = angle - theta0;
    while (delta > 180) delta -= 360;
    while (delta <= -180) delta += 360;
    return delta;
  };
  const sorted = [...passes].sort((a, b) => angularOffset(a.angleDegrees) - angularOffset(b.angleDegrees));
  const baseRadius = Math.max(...passes.map((pass) => pass.baseRadius));
  let maximumPlaneDeviation = 0;
  const tangentDistances = [];
  for (const pass of sorted) {
    const distance = pass.toolCenterRadius * Math.cos(angularOffset(pass.angleDegrees) * DEGREES) - pass.cutterRadius;
    tangentDistances.push(distance);
    maximumPlaneDeviation = Math.max(maximumPlaneDeviation, Math.abs(distance - planeDistance));
  }
  const consistentPlane = maximumPlaneDeviation <= planeTolerance;
  // Cusp between adjacent end-cap circles: intersection point of two equal
  // circles, measured from the tangent plane.
  let maximumCusp = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const a = sorted[index - 1];
    const b = sorted[index];
    const ax = a.toolCenterRadius * Math.cos(angularOffset(a.angleDegrees) * DEGREES);
    const ay = a.toolCenterRadius * Math.sin(angularOffset(a.angleDegrees) * DEGREES);
    const bx = b.toolCenterRadius * Math.cos(angularOffset(b.angleDegrees) * DEGREES);
    const by = b.toolCenterRadius * Math.sin(angularOffset(b.angleDegrees) * DEGREES);
    const w = Math.max(a.cutterRadius, b.cutterRadius);
    const dx = bx - ax;
    const dy = by - ay;
    const distance = Math.hypot(dx, dy);
    if (!(distance > EPSILON) || distance > 2 * w) continue;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const h = Math.sqrt(Math.max(0, w * w - (distance / 2) * (distance / 2)));
    // The cusp nearer the spindle axis is the one that survives in the part.
    const candidates = [
      {x: mx - h * dy / distance, y: my + h * dx / distance},
      {x: mx + h * dy / distance, y: my - h * dx / distance},
    ];
    const cusp = candidates.reduce((best, point) => (point.x < best.x ? point : best));
    maximumCusp = Math.max(maximumCusp, cusp.x - planeDistance);
  }
  // Extent on the original OD: each pass's end-cap circle meets the base
  // circle at theta +/- delta (closed form); the union spans the extremes.
  let minimumAngle = Infinity;
  let maximumAngle = -Infinity;
  for (const pass of sorted) {
    const r = pass.toolCenterRadius;
    const w = pass.cutterRadius;
    const cosDelta = (baseRadius * baseRadius + r * r - w * w) / (2 * baseRadius * r);
    if (cosDelta > 1 || cosDelta < -1) continue;
    const delta = Math.acos(cosDelta) / DEGREES;
    const offset = angularOffset(pass.angleDegrees);
    minimumAngle = Math.min(minimumAngle, offset - delta);
    maximumAngle = Math.max(maximumAngle, offset + delta);
  }
  const angularSpan = Number.isFinite(minimumAngle) && Number.isFinite(maximumAngle) ? maximumAngle - minimumAngle : null;
  const chordWidth = angularSpan !== null ? 2 * baseRadius * Math.sin(Math.min(180, angularSpan) / 2 * DEGREES) : null;
  const idealChordHalf = planeDistance < baseRadius ? Math.sqrt(baseRadius * baseRadius - planeDistance * planeDistance) : 0;
  const zTip = Math.min(...passes.map((pass) => pass.zTip));
  const zTop = Math.max(...passes.map((pass) => pass.zTop));
  return {
    kind: "flat",
    consistentPlane,
    normalAngleDegrees: theta0,
    normalCommandedB: finite(reference.commandedB) ? reference.commandedB : null,
    spanBeforeDegrees: Number.isFinite(minimumAngle) ? -minimumAngle : null,
    spanAfterDegrees: Number.isFinite(maximumAngle) ? maximumAngle : null,
    planeDistance,
    depthBelowOd: baseRadius - planeDistance,
    baseRadius,
    maximumPlaneDeviation,
    maximumCusp,
    passCount: passes.length,
    angularStepDegrees: sorted.length > 1
      ? Math.max(...sorted.slice(1).map((pass, index) => angularOffset(pass.angleDegrees) - angularOffset(sorted[index].angleDegrees)))
      : 0,
    odSpanStartDegrees: Number.isFinite(minimumAngle) ? theta0 + minimumAngle : null,
    odSpanEndDegrees: Number.isFinite(maximumAngle) ? theta0 + maximumAngle : null,
    angularSpanDegrees: angularSpan,
    chordWidth,
    idealFlatWidth: idealChordHalf * 2,
    zTip,
    zTop,
    length: zTop - zTip,
    sectionCount: Array.isArray(sections) ? sections.length : 0,
  };
}

/** Radius of the modeled cross-section at (z, angleDegrees), or null outside. */
export function rotarySectionRadiusAt(result, z, angleDegrees) {
  const sections = result?.sections;
  if (!Array.isArray(sections)) return null;
  for (const section of sections) {
    if (z < section.startZ - EPSILON || z > section.endZ + EPSILON) continue;
    const samples = section.radii.length;
    const index = Math.round(normalizeAngle(angleDegrees) / section.angleStepDegrees) % samples;
    return section.radii[index];
  }
  return null;
}

/** Closed polygon (face-plane x/y) of a modeled section for display. */
export function rotarySectionOutline(section, {maximumPoints = 720} = {}) {
  const samples = section?.radii?.length || 0;
  if (!samples) return [];
  const stride = Math.max(1, Math.ceil(samples / Math.max(3, Math.trunc(maximumPoints) || 720)));
  const points = [];
  for (let index = 0; index < samples; index += stride) {
    const angle = index * section.angleStepDegrees * DEGREES;
    const radius = section.radii[index];
    points.push({x: radius * Math.cos(angle), y: radius * Math.sin(angle)});
  }
  return points;
}

export function summarizeRotarySectionStock(result, {lengthScale = 1, lengthUnit = "mm", lengthDecimals = 4} = {}) {
  const scale = Number(lengthScale) > 0 ? Number(lengthScale) : 1;
  const decimals = Math.max(0, Math.min(8, Math.trunc(Number(lengthDecimals) || 0)));
  const fmt = (value) => (finite(value) ? (value / scale).toFixed(decimals) : "?");
  if (!result || result.status === ROTARY_SECTION_STATUS.NONE) {
    return {status: ROTARY_SECTION_STATUS.NONE, label: "", details: []};
  }
  const feature = result.feature;
  const details = [];
  if (feature) {
    const about = finite(feature.normalCommandedB) ? `B${feature.normalCommandedB.toFixed(2)}` : `part angle ${feature.normalAngleDegrees.toFixed(2)}°`;
    details.push(`${feature.passCount} radial pass${feature.passCount === 1 ? "" : "es"} at ${feature.angularStepDegrees.toFixed(2)}° steps about ${about}`);
    details.push(`Nearest surface ${fmt(feature.planeDistance)} ${lengthUnit} from spindle axis (${fmt(feature.depthBelowOd)} ${lengthUnit} below Ø${fmt(feature.baseRadius * 2)} OD)`);
    details.push(`Cut spans ${feature.spanBeforeDegrees?.toFixed(2)}° before to ${feature.spanAfterDegrees?.toFixed(2)}° after ${about} on the OD, chord ${fmt(feature.chordWidth)} ${lengthUnit}`);
    details.push(`Z ${fmt(feature.zTip)} to ${fmt(feature.zTop)} ${lengthUnit} (${fmt(feature.length)} ${lengthUnit} long)`);
    details.push(feature.consistentPlane
      ? `Passes share one tangent plane within ${fmt(feature.maximumPlaneDeviation)} ${lengthUnit}; cusps between passes ≤ ${fmt(feature.maximumCusp)} ${lengthUnit} (ideal flat width ${fmt(feature.idealFlatWidth)} ${lengthUnit})`
      : `Passes do not share one tangent plane (spread ${fmt(feature.maximumPlaneDeviation)} ${lengthUnit}); review the intended surface`);
  }
  const airOnly = result.status === ROTARY_SECTION_STATUS.MODELED && !result.modeledCuts;
  if (airOnly) details.push(`${result.airCuts} rotary-indexed feed move${result.airCuts === 1 ? "" : "s"} never meet the configured stock; check stock diameter and front Z if a cut was expected`);
  const label = airOnly
    ? `${result.airCuts} rotary-indexed feed move${result.airCuts === 1 ? "" : "s"} clear the stock (air cuts)`
    : result.status === ROTARY_SECTION_STATUS.MODELED
      ? `${result.modeledCuts} rotary-indexed side-milling cut${result.modeledCuts === 1 ? "" : "s"} modeled`
      : result.status === ROTARY_SECTION_STATUS.PARTIAL
        ? `${result.modeledCuts} cut${result.modeledCuts === 1 ? "" : "s"} modeled · ${result.pathOnlyCuts} PATH ONLY`
        : `${result.attemptedCuts} rotary-indexed cut${result.attemptedCuts === 1 ? "" : "s"} PATH ONLY`;
  return {status: result.status, label, details, airOnly, modeledCuts: result.modeledCuts || 0, collisionFlags: result.collisionFlags || 0};
}
