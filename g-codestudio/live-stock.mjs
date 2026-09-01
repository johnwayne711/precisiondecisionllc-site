const EPSILON = 1e-9;

export const AXIAL_FLAT_BORE_KIND = "axial-flat-bore";
export const AXIAL_FLAT_ENDMILL_MODE = "axial-flat-endmill";
export const LIVE_STOCK_STATUS = Object.freeze({
  NONE: "none",
  MODELED: "modeled",
  PATH_ONLY: "path-only",
});

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value) {
  return finite(value) && value > 0;
}

function segmentLine(segment) {
  return segment?.executionLine || segment?.line || null;
}

function warningFor(segment, segmentIndex, code, message) {
  return {
    line: segmentLine(segment),
    toolKey: segment?.toolKey || null,
    segmentIndex,
    code,
    message,
  };
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

function isLiveCut(segment) {
  const live = segment?.machiningMode === "live-tool" || segment?.liveTool === true;
  const rapid = segment?.type === "rapid" || segment?.type === "live-rapid";
  return live && !rapid;
}

function segmentPoints(segment) {
  if (Array.isArray(segment?.points) && segment.points.length >= 2) return segment.points;
  return [segment?.start, segment?.end].filter(Boolean);
}

function canonicalPlunge(segment, tolerance) {
  if (segment?.verificationBlocked || segment?.liveToolBlocked) {
    return {error: ["live-stock-segment-blocked", "Verification-blocked live-tool motion cannot remove stock."]};
  }
  if (segment?.coordinateMode !== "g112-face" || segment?.xCoordinateMode !== "radius"
    || segment?.plane !== "G17" || segment?.type !== "linear") {
    return {error: [
      "live-stock-motion-unsupported",
      "Only an unblocked linear G112/G17 plunge with physical radius-mode X/Y coordinates can create an axial flat bore.",
    ]};
  }
  if (segment?.liveToolRunning !== true) {
    return {error: ["live-stock-spindle-unresolved", "The live spindle must be positively known running for axial bore removal."]};
  }
  const points = segmentPoints(segment);
  if (points.length < 2 || points.some((point) => !finite(point?.x) || !finite(point?.y) || !finite(point?.z))) {
    return {error: ["live-stock-position-unresolved", "The complete G112 X/Y/Z plunge position is required for axial bore removal."]};
  }
  const start = points[0];
  const end = points.at(-1);
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    if (Math.abs(after.x - start.x) > tolerance || Math.abs(after.y - start.y) > tolerance) {
      return {error: ["live-stock-not-axial", "X/Y changed during the live cut; slots, interpolated bores, and angled cutter sweeps remain PATH ONLY."]};
    }
    if (!(after.z < before.z - tolerance)) {
      return {error: ["live-stock-plunge-direction-unsupported", "The bounded axial-bore model requires a strictly decreasing-Z plunge."]};
    }
  }
  return {start, end, centerX: start.x, centerY: start.y};
}

function resolveCutter(segment, segmentIndex, cutterResolver) {
  let resolved = null;
  try {
    resolved = typeof cutterResolver === "function"
      ? cutterResolver(segment?.toolKey ?? null, segment)
      : null;
  } catch (error) {
    return {
      warning: warningFor(
        segment,
        segmentIndex,
        "live-stock-cutter-resolution-failed",
        `The assigned cutter could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
      ),
    };
  }
  const model = resolved?.cuttingModel || resolved;
  if (!model) {
    return {warning: warningFor(segment, segmentIndex, "live-stock-cutter-unassigned", "No confirmed cutter model is assigned to this live-tool cut.")};
  }
  if (model.mode !== AXIAL_FLAT_ENDMILL_MODE
    || model.simulationReady !== true
    || model.dimensionsExact !== true
    || model.centerCutting !== true
    || model.referenceSemantics !== "flat-end-mill-tip") {
    return {
      warning: warningFor(
        segment,
        segmentIndex,
        "live-stock-cutter-model-unsupported",
        "Axial bore removal requires an exact, simulation-ready, center-cutting axial flat end mill with flat-end-mill-tip reference semantics.",
      ),
    };
  }
  const diameter = Number(model.diameter);
  const lengthOfCut = Number(model.lengthOfCut);
  if (!positive(diameter) || !positive(lengthOfCut)) {
    return {
      warning: warningFor(
        segment,
        segmentIndex,
        "live-stock-cutter-dimensions-invalid",
        "The assigned flat end mill needs positive canonical diameter and length-of-cut dimensions.",
      ),
    };
  }
  return {model, diameter, radius: diameter / 2, lengthOfCut};
}

function sameBoreAxisAndDiameter(bore, candidate, tolerance) {
  return Math.hypot(bore.centerX - candidate.centerX, bore.centerY - candidate.centerY) <= tolerance
    && Math.abs(bore.radius - candidate.radius) <= tolerance;
}

function overlappingBore(bore, candidate, tolerance) {
  const radialDistance = Math.hypot(bore.centerX - candidate.centerX, bore.centerY - candidate.centerY);
  const radialOverlap = radialDistance < bore.radius + candidate.radius - tolerance;
  const axialOverlap = Math.max(bore.bottomZ, candidate.bottomZ) < Math.min(bore.frontZ, candidate.frontZ) - tolerance;
  return radialOverlap && axialOverlap;
}

function boreFeature({plunge, cutter, stock, segment, segmentIndex, bottomZ}) {
  const depth = stock.materialEndZ - bottomZ;
  return {
    kind: AXIAL_FLAT_BORE_KIND,
    centerX: plunge.centerX,
    centerY: plunge.centerY,
    radius: cutter.radius,
    frontZ: stock.materialEndZ,
    bottomZ,
    depth,
    removedVolume: Math.PI * cutter.radius * cutter.radius * depth,
    toolKey: segment?.toolKey || null,
    sourceLines: [segmentLine(segment)].filter((line) => line !== null),
    segmentIndexes: [segmentIndex],
  };
}

function mergeBore(bore, candidate, segment, segmentIndex) {
  const bottomZ = Math.min(bore.bottomZ, candidate.bottomZ);
  const depth = bore.frontZ - bottomZ;
  return {
    ...bore,
    bottomZ,
    depth,
    removedVolume: Math.PI * bore.radius * bore.radius * depth,
    sourceLines: [...new Set([...bore.sourceLines, segmentLine(segment)].filter((line) => line !== null))],
    segmentIndexes: [...bore.segmentIndexes, segmentIndex],
  };
}

function unresolvedCutWarnings(unresolvedOperations, visibleSourceLine) {
  const warnings = [];
  for (const operation of Array.isArray(unresolvedOperations) ? unresolvedOperations : []) {
    if (operation?.displayed || operation?.rapid === true) continue;
    if (finite(visibleSourceLine) && finite(operation?.line) && operation.line > visibleSourceLine) continue;
    warnings.push({
      line: operation?.line || null,
      toolKey: null,
      segmentIndex: null,
      code: "live-stock-operation-not-drawn",
      message: "A live-tool cutting attempt has no verified drawable segment; non-axisymmetric stock remains PATH ONLY.",
    });
  }
  return warnings;
}

/**
 * Build the exact analytic sidecar for the first supported non-axisymmetric
 * stock feature. All coordinates and dimensions are canonical millimeters;
 * removedVolume is cubic millimeters. This function never mutates segments,
 * stock, resolved cutter models, or previously returned bore records.
 */
export function buildAxialFlatBoreStock(segments, {
  stock,
  visibleCount = Array.isArray(segments) ? segments.length : 0,
  cutterResolver = null,
  unresolvedOperations = [],
  visibleSourceLine = null,
  tolerance = EPSILON,
  maximumBores = 64,
} = {}) {
  const source = Array.isArray(segments) ? segments : [];
  const count = Math.max(0, Math.min(source.length, Math.trunc(Number(visibleCount) || 0)));
  const dimensionalTolerance = positive(Number(tolerance)) ? Number(tolerance) : EPSILON;
  const boreLimit = Math.max(1, Math.trunc(Number(maximumBores) || 64));
  const normalizedStock = normalizeStock(stock);
  const axialBores = [];
  const warnings = unresolvedCutWarnings(unresolvedOperations, visibleSourceLine);
  let attemptedCuts = warnings.length;
  let modeledCuts = 0;

  for (let segmentIndex = 0; segmentIndex < count; segmentIndex += 1) {
    const segment = source[segmentIndex];
    if (!isLiveCut(segment)) continue;
    attemptedCuts += 1;

    if (!normalizedStock) {
      warnings.push(warningFor(segment, segmentIndex, "live-stock-invalid", "Axial bore removal requires a finite cylindrical stock radius and ordered axial bounds."));
      continue;
    }

    const plunge = canonicalPlunge(segment, dimensionalTolerance);
    if (plunge.error) {
      warnings.push(warningFor(segment, segmentIndex, plunge.error[0], plunge.error[1]));
      continue;
    }
    const cutter = resolveCutter(segment, segmentIndex, cutterResolver);
    if (cutter.warning) {
      warnings.push(cutter.warning);
      continue;
    }

    const radialExtent = Math.hypot(plunge.centerX, plunge.centerY) + cutter.radius;
    if (radialExtent >= normalizedStock.radius - dimensionalTolerance) {
      warnings.push(warningFor(
        segment,
        segmentIndex,
        "live-stock-bore-breakout",
        "The cutter envelope reaches or crosses the cylindrical stock OD; this is not a fully contained axial bore and remains PATH ONLY.",
      ));
      continue;
    }

    const probe = {
      centerX: plunge.centerX,
      centerY: plunge.centerY,
      radius: cutter.radius,
      frontZ: normalizedStock.materialEndZ,
      bottomZ: plunge.end.z,
    };
    const coaxialIndex = axialBores.findIndex((bore) => sameBoreAxisAndDiameter(bore, probe, dimensionalTolerance));
    const coaxial = coaxialIndex >= 0 ? axialBores[coaxialIndex] : null;
    const crossesFront = plunge.start.z >= normalizedStock.materialEndZ - dimensionalTolerance
      && plunge.end.z < normalizedStock.materialEndZ - dimensionalTolerance;
    const continuesExisting = coaxial
      && plunge.start.z >= coaxial.bottomZ - dimensionalTolerance
      && plunge.start.z <= coaxial.frontZ + dimensionalTolerance
      && plunge.end.z < coaxial.frontZ - dimensionalTolerance;
    if (!crossesFront && !continuesExisting) {
      warnings.push(warningFor(
        segment,
        segmentIndex,
        "live-stock-face-entry-unresolved",
        "The plunge neither crosses the current free face nor continues a matching modeled bore from already removed material.",
      ));
      continue;
    }

    const bottomZ = coaxial ? Math.min(coaxial.bottomZ, plunge.end.z) : plunge.end.z;
    if (bottomZ <= normalizedStock.startZ + dimensionalTolerance) {
      warnings.push(warningFor(
        segment,
        segmentIndex,
        "live-stock-through-hole-unsupported",
        "The bounded model accepts blind axial bores only; a cutter reaching the stock back boundary remains PATH ONLY.",
      ));
      continue;
    }
    const depth = normalizedStock.materialEndZ - bottomZ;
    if (depth > cutter.lengthOfCut + dimensionalTolerance) {
      warnings.push(warningFor(
        segment,
        segmentIndex,
        "live-stock-length-of-cut-exceeded",
        `The ${depth.toFixed(6)} mm bore depth exceeds the cutter's ${cutter.lengthOfCut.toFixed(6)} mm length of cut.`,
      ));
      continue;
    }

    const candidate = boreFeature({
      plunge,
      cutter,
      stock: normalizedStock,
      segment,
      segmentIndex,
      bottomZ,
    });
    if (coaxial) {
      if (coaxial.toolKey !== candidate.toolKey) {
        warnings.push(warningFor(
          segment,
          segmentIndex,
          "live-stock-coaxial-tool-change-unsupported",
          "A coaxial step-down made with a different assigned cutter is not merged into the bounded bore model.",
        ));
        continue;
      }
      axialBores[coaxialIndex] = mergeBore(coaxial, candidate, segment, segmentIndex);
      modeledCuts += 1;
      continue;
    }
    if (axialBores.some((bore) => overlappingBore(bore, candidate, dimensionalTolerance))) {
      warnings.push(warningFor(
        segment,
        segmentIndex,
        "live-stock-overlapping-bores-unsupported",
        "Intersecting axial bores require a general solid-union model and remain PATH ONLY.",
      ));
      continue;
    }
    if (axialBores.length >= boreLimit) {
      warnings.push(warningFor(
        segment,
        segmentIndex,
        "live-stock-bore-capacity-exceeded",
        `The bounded axial-bore model is limited to ${boreLimit} non-overlapping bores.`,
      ));
      continue;
    }
    axialBores.push(candidate);
    modeledCuts += 1;
  }

  const removedVolume = axialBores.reduce((sum, bore) => sum + bore.removedVolume, 0);
  const status = attemptedCuts === 0
    ? LIVE_STOCK_STATUS.NONE
    : (modeledCuts === attemptedCuts ? LIVE_STOCK_STATUS.MODELED : LIVE_STOCK_STATUS.PATH_ONLY);
  return {
    status,
    axialBores,
    warnings,
    attemptedCuts,
    modeledCuts,
    removedVolume,
    visibleCount: count,
  };
}

export function summarizeAxialFlatBoreStock(result) {
  const axialBores = Array.isArray(result?.axialBores) ? result.axialBores : [];
  const attemptedCuts = Math.max(0, Math.trunc(Number(result?.attemptedCuts) || 0));
  const modeledCuts = Math.max(0, Math.trunc(Number(result?.modeledCuts) || 0));
  const unsupportedCuts = Math.max(0, attemptedCuts - modeledCuts);
  const removedVolume = positive(Number(result?.removedVolume)) ? Number(result.removedVolume) : 0;
  const status = Object.values(LIVE_STOCK_STATUS).includes(result?.status)
    ? result.status
    : (attemptedCuts ? LIVE_STOCK_STATUS.PATH_ONLY : LIVE_STOCK_STATUS.NONE);
  let label = "NO LIVE CUTS";
  if (status === LIVE_STOCK_STATUS.MODELED) {
    label = `${axialBores.length} AXIAL BORE${axialBores.length === 1 ? "" : "S"} MODELED`;
  } else if (status === LIVE_STOCK_STATUS.PATH_ONLY) {
    label = axialBores.length
      ? `${axialBores.length} BORE${axialBores.length === 1 ? "" : "S"} MODELED · ${unsupportedCuts} PATH ONLY`
      : "PATH ONLY";
  }
  return {
    status,
    label,
    complete: status !== LIVE_STOCK_STATUS.PATH_ONLY,
    axialBoreCount: axialBores.length,
    attemptedCuts,
    modeledCuts,
    unsupportedCuts,
    removedVolume,
  };
}
