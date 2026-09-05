import {geometrySamplePointCount} from "./geometry-inspector.mjs";

/**
 * Local 2D reference-overlay workload limits.
 *
 * The overlay is resampled during phone pan/zoom redraws. Keeping it below
 * 512 canvas strokes and 12,288 sampled points per pass bounds both path setup
 * and trigonometric/point-allocation work. Pointer interaction can perform a
 * hit-test pass plus a redraw pass, so the paired ceiling stays below 24,576
 * points while leaving ample room for profile-only manufacturing DXFs. These
 * are hard UI ceilings, not dimensional or parser limits; the analytic import
 * remains available when display blocks.
 */
export const MAX_REFERENCE_DISPLAY_STROKES = 512;
export const MAX_REFERENCE_DISPLAY_SAMPLED_POINTS = 12288;
export const REFERENCE_DISPLAY_ARC_MAXIMUM_SEGMENTS = 192;
export const MAX_REFERENCE_UI_COMPARISON_OPERATIONS = 100000;
export const REFERENCE_DISPLAY_WORKLOAD_DIAGNOSTIC = "reference-display-workload-exceeded";

function sampledPointsForArcSweep(sweep) {
  if (!Number.isFinite(sweep) || sweep === 0) return null;
  return geometrySamplePointCount(
    {type: "arc", sweep},
    REFERENCE_DISPLAY_ARC_MAXIMUM_SEGMENTS,
  );
}

function blockedWorkload(primitiveCount, inspectorEntityCount, sampledPointCount, detail) {
  return {
    allowed: false,
    primitiveCount,
    inspectorEntityCount,
    strokeCount: inspectorEntityCount,
    sampledPointCount,
    limits: {
      strokes: MAX_REFERENCE_DISPLAY_STROKES,
      sampledPoints: MAX_REFERENCE_DISPLAY_SAMPLED_POINTS,
    },
    diagnostic: {
      severity: "error",
      code: REFERENCE_DISPLAY_WORKLOAD_DIAGNOSTIC,
      message: `Reference display blocked: ${detail} The analytic reference and its provenance remain in memory. Use a profile-only DXF or select a simpler STEP section contour for overlay.`,
    },
  };
}

/** Estimate the inspector-entity and per-redraw sampling fan-out without expanding it. */
export function referenceDisplayWorkload(primitives) {
  if (!Array.isArray(primitives)) throw new TypeError("Reference display workload requires an analytic primitive array.");
  let inspectorEntityCount = 0;
  let sampledPointCount = 0;
  for (let index = 0; index < primitives.length; index += 1) {
    const primitive = primitives[index];
    if (primitive?.type === "line") {
      inspectorEntityCount += 1;
      sampledPointCount += 2;
    } else if (primitive?.type === "arc") {
      const points = sampledPointsForArcSweep(primitive.sweep);
      if (points === null) {
        return blockedWorkload(primitives.length, inspectorEntityCount, sampledPointCount, `analytic primitive ${index + 1} has an invalid arc sweep.`);
      }
      inspectorEntityCount += 1;
      sampledPointCount += points;
    } else if (primitive?.type === "circle") {
      // referenceInspectorEntities represents a circle as two half-arc strokes.
      inspectorEntityCount += 2;
      sampledPointCount += sampledPointsForArcSweep(Math.PI) * 2;
    } else {
      return blockedWorkload(primitives.length, inspectorEntityCount, sampledPointCount, `analytic primitive ${index + 1} has unsupported type '${primitive?.type || "missing"}'.`);
    }
  }
  const allowed = inspectorEntityCount <= MAX_REFERENCE_DISPLAY_STROKES
    && sampledPointCount <= MAX_REFERENCE_DISPLAY_SAMPLED_POINTS;
  if (!allowed) {
    return blockedWorkload(
      primitives.length,
      inspectorEntityCount,
      sampledPointCount,
      `the mapped geometry requires ${inspectorEntityCount.toLocaleString()} strokes and ${sampledPointCount.toLocaleString()} sampled points per redraw, exceeding the safe ceilings of ${MAX_REFERENCE_DISPLAY_STROKES.toLocaleString()} and ${MAX_REFERENCE_DISPLAY_SAMPLED_POINTS.toLocaleString()}.`,
    );
  }
  return {
    allowed: true,
    primitiveCount: primitives.length,
    inspectorEntityCount,
    strokeCount: inspectorEntityCount,
    sampledPointCount,
    limits: {
      strokes: MAX_REFERENCE_DISPLAY_STROKES,
      sampledPoints: MAX_REFERENCE_DISPLAY_SAMPLED_POINTS,
    },
    diagnostic: null,
  };
}

/** Select once after comparison so redraw does not filter/sort every result. */
export function worstReferenceWitness(segmentResults) {
  if (!Array.isArray(segmentResults)) return null;
  let worst = null;
  for (const result of segmentResults) {
    if (!result?.comparable || !result.worstPoint || !result.nearestNominal?.point) continue;
    if (!worst || result.deviation.lowerBoundMm > worst.deviation.lowerBoundMm) worst = result;
  }
  return worst;
}
