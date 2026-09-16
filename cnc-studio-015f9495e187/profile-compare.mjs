/**
 * Analytic 2D program-to-nominal profile comparison.
 *
 * This is an initial directed overlay/deviation calculation in canonical
 * millimetres. It compares programmed centerline geometry with nominal LINE,
 * ARC, CIRCLE, and polyline curves that a caller has already mapped into the
 * same lathe {z, x} frame. It does not model cutter compensation, tool shape,
 * material removal, finished stock, controller behavior, setup offsets,
 * collision, or machine accuracy.
 */

const EPSILON = 1e-12;
const TAU = Math.PI * 2;
const MAX_NUMERIC_COORDINATE = Math.sqrt(Number.MAX_VALUE) / 8;
const NUMERIC_RESOLUTION_ULPS = 8;

export const DEFAULT_PROFILE_TOLERANCE_MM = 0.0127;
export const DEFAULT_PROFILE_NUMERICAL_BUDGET_MM = 0.00127;
export const MAX_PROFILE_NUMERICAL_BUDGET_MM = 0.00127;
export const MAX_PROFILE_COMPARISON_OPERATIONS = 1000000;
export const MAX_PROFILE_EVALUATIONS_PER_CURVE = 25001;
export const MAX_PROFILE_NOMINAL_ENTITIES = 100000;
export const MAX_PROFILE_NOMINAL_PIECES = 100000;
export const MAX_PROFILE_NOMINAL_SOURCE_POINTS = 100001;
export const MAX_PROFILE_PROGRAM_SEGMENTS = 100000;
export const MAX_PROFILE_PROGRAM_CURVES = 100000;
export const MAX_PROFILE_PROGRAM_SOURCE_POINTS = 100001;
export const MAX_PROFILE_PENETRATION_FRAGMENTS = 4096;
export const PROFILE_COMPARISON_WORKLOAD_EXHAUSTED = "profile-comparison-workload-exhausted";
export const PROFILE_COMPARISON_SCOPE = Object.freeze({
  direction: "program-to-nominal",
  coordinates: "canonical-mm-lathe-zx",
  claim: "Nominal overlay/deviation only; not finished-stock, collision, controller, setup, or machine-accuracy verification.",
});
export const PROFILE_MATERIAL_ENTRY_SCOPE = Object.freeze({
  direction: "program-reference-point-to-qualified-material-region",
  coordinates: "canonical-mm-lathe-zx",
  claim: "Signed program-reference-point penetration risk only; not cutter-compensated gouge, finished-stock, collision, setup, or machine-accuracy verification.",
});
export const PROFILE_CUTTER_ENTRY_SCOPE = Object.freeze({
  direction: 'nominal-active-cutting-edge-to-qualified-material-region',
  coordinates: 'canonical-mm-lathe-zx',
  claim: 'Nominal active-edge sweep with explicit setup; point-only and unresolved portions are separately retained. Not complete insert/holder collision, physical cutter accuracy or finished-part verification.',
});

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function finitePoint(point) {
  return finite(point?.z) && finite(point?.x);
}

function numericallySafePoint(point) {
  return finitePoint(point)
    && Math.abs(point.z) <= MAX_NUMERIC_COORDINATE
    && Math.abs(point.x) <= MAX_NUMERIC_COORDINATE;
}

function numericallySafeScalar(value) {
  return finite(value) && Math.abs(value) <= MAX_NUMERIC_COORDINATE;
}

function numericResolutionMm(value) {
  return Number.EPSILON * NUMERIC_RESOLUTION_ULPS * Math.max(1, Math.abs(value));
}

function pointResolutionUncertaintyMm(point) {
  return Math.max(numericResolutionMm(point.z), numericResolutionMm(point.x));
}

function declaredGeometryUncertaintyMm(entity, context) {
  if (entity?.geometryUncertaintyMm === undefined) return 0;
  const uncertainty = Number(entity.geometryUncertaintyMm);
  if (!finite(uncertainty) || uncertainty < 0) {
    throw new TypeError(`${context} geometryUncertaintyMm must be a finite nonnegative canonical-millimetre value.`);
  }
  return uncertainty;
}

function lineResolutionUncertaintyMm(start, end) {
  return Math.max(pointResolutionUncertaintyMm(start), pointResolutionUncertaintyMm(end));
}

function arcResolutionUncertaintyMm(center, radius, angles, points = []) {
  const angularUncertaintyMm = radius * Number.EPSILON * NUMERIC_RESOLUTION_ULPS
    * Math.max(1, ...angles.map((angle) => Math.abs(angle)));
  return Math.max(
    pointResolutionUncertaintyMm(center),
    numericResolutionMm(radius),
    angularUncertaintyMm,
    ...points.map(pointResolutionUncertaintyMm),
  );
}

function numericallyPreciseScalar(value, numericalBudgetMm) {
  return finite(value) && numericResolutionMm(value) <= numericalBudgetMm;
}

function numericallyPrecisePoint(point, numericalBudgetMm) {
  return finitePoint(point)
    && numericallyPreciseScalar(point.z, numericalBudgetMm)
    && numericallyPreciseScalar(point.x, numericalBudgetMm);
}

function numericallyPreciseArc(center, radius, angles, numericalBudgetMm) {
  const maximumAngleMagnitude = Math.max(1, ...angles.map((angle) => Math.abs(angle)));
  const angularResolutionMm = radius * Number.EPSILON * NUMERIC_RESOLUTION_ULPS * maximumAngleMagnitude;
  return numericallyPrecisePoint(center, numericalBudgetMm)
    && numericallyPreciseScalar(radius, numericalBudgetMm)
    && finite(angularResolutionMm)
    && angularResolutionMm <= numericalBudgetMm
    && [center.z - radius, center.z + radius, center.x - radius, center.x + radius]
      .every((extent) => numericallyPreciseScalar(extent, numericalBudgetMm));
}

function numericRangeError(context) {
  return new RangeError(`Profile comparison blocked: ${context} exceeds the safe finite numeric range.`);
}

function numericResolutionError(context, numericalBudgetMm) {
  return new RangeError(
    `Profile comparison blocked: ${context} cannot be represented within the ${numericalBudgetMm} mm numerical budget.`,
  );
}

function clonePoint(point) {
  return {z: Number(point.z), x: Number(point.x)};
}

function distance(first, second) {
  return Math.hypot(second.z - first.z, second.x - first.x);
}

function normalizedAngle(angle) {
  let value = angle % TAU;
  if (value < 0) value += TAU;
  return value;
}

function pointAtAngle(center, radius, angle) {
  return {
    z: center.z + Math.cos(angle) * radius,
    x: center.x + Math.sin(angle) * radius,
  };
}

function arcEndpointConsistencyAllowanceMm(center, radius, angle, expectedPoint) {
  const normalized = normalizedAngle(angle);
  const angularResolutionMm = radius
    * Number.EPSILON
    * NUMERIC_RESOLUTION_ULPS
    * Math.max(1, Math.abs(normalized));
  return Math.max(
    numericResolutionMm(center.z),
    numericResolutionMm(center.x),
    numericResolutionMm(radius),
    numericResolutionMm(expectedPoint.z),
    numericResolutionMm(expectedPoint.x),
    angularResolutionMm,
  );
}

function angleOnSweep(angle, startAngle, sweep) {
  if (Math.abs(sweep) >= TAU) return true;
  if (sweep >= 0) return normalizedAngle(angle - startAngle) <= sweep;
  return normalizedAngle(startAngle - angle) <= -sweep;
}

function arcAngularInterval(arc) {
  const end = arc.startAngle + arc.sweep;
  return arc.sweep >= 0
    ? {minimum: arc.startAngle, maximum: end}
    : {minimum: end, maximum: arc.startAngle};
}

function arcContainsArc(container, candidate) {
  if (Math.abs(container.sweep) >= TAU) return true;
  if (Math.abs(candidate.sweep) > Math.abs(container.sweep)) return false;
  const outer = arcAngularInterval(container);
  const inner = arcAngularInterval(candidate);
  for (let revolution = -2; revolution <= 2; revolution += 1) {
    const shift = revolution * TAU;
    if (inner.minimum >= outer.minimum + shift
      && inner.maximum <= outer.maximum + shift) return true;
  }
  return false;
}

function entityType(entity) {
  return String(entity?.type || entity?.kind || "").trim().toLowerCase().replaceAll("_", "-");
}

function nominalInputArray(input) {
  if (Array.isArray(input)) return input;
  const unresolvedDiagnostics = Array.isArray(input?.diagnostics)
    && input.diagnostics.some((diagnostic) => (
      diagnostic?.severity === "error" && diagnostic?.resolved !== true
    ));
  if (input?.authorized === false || unresolvedDiagnostics) {
    throw new RangeError("Nominal geometry is not authorized for dimensional comparison; resolve every import/transform error first.");
  }
  // Prefer mapped/flattened analytic output over an importer's raw entity list.
  // A DXF model, for example, can retain source polylines in `entities` while
  // exposing comparison-ready LINE/ARC pieces in `primitives`.
  for (const key of ["primitives", "geometry", "entities"]) {
    if (Array.isArray(input?.[key])) return input[key];
  }
  throw new TypeError("Nominal geometry must be an array, or an object with an entities, primitives, or geometry array.");
}

function normalizedLine(entity, entityIndex, numericalBudgetMm, pieceIndex = 0) {
  if (!finitePoint(entity?.start) || !finitePoint(entity?.end)) {
    throw new TypeError(`Nominal line ${entityIndex} requires finite canonical {z, x} start and end points.`);
  }
  const start = clonePoint(entity.start);
  const end = clonePoint(entity.end);
  if (!numericallySafePoint(start) || !numericallySafePoint(end)) throw numericRangeError(`nominal line ${entityIndex}`);
  if (!numericallyPrecisePoint(start, numericalBudgetMm) || !numericallyPrecisePoint(end, numericalBudgetMm)) {
    throw numericResolutionError(`nominal line ${entityIndex} coordinates`, numericalBudgetMm);
  }
  const length = distance(start, end);
  if (!finite(length)) throw numericRangeError(`nominal line ${entityIndex} extent`);
  if (length === 0) throw new RangeError(`Nominal line ${entityIndex} has zero length.`);
  const metadataUncertaintyMm = Math.max(
    declaredGeometryUncertaintyMm(entity, `Nominal line ${entityIndex}`),
    lineResolutionUncertaintyMm(start, end),
  );
  if (metadataUncertaintyMm > numericalBudgetMm) {
    throw numericResolutionError(`nominal line ${entityIndex} geometry uncertainty`, numericalBudgetMm);
  }
  return {
    type: "line",
    start,
    end,
    entityIndex,
    pieceIndex,
    id: entity.id ?? null,
    metadataUncertaintyMm,
  };
}

function normalizedArc(entity, entityIndex, numericalBudgetMm) {
  const center = entity?.center;
  const radius = Number(entity?.radius);
  const startAngle = Number(entity?.startAngle);
  const sweep = Number(entity?.sweep);
  const endpointUncertaintyMm = entity?.endpointUncertaintyMm === undefined
    ? 0
    : Number(entity.endpointUncertaintyMm);
  const declaredUncertaintyMm = declaredGeometryUncertaintyMm(entity, `Nominal arc ${entityIndex}`);
  const geometryUncertaintyMm = Math.max(endpointUncertaintyMm, declaredUncertaintyMm);
  if (!finitePoint(center) || !finite(radius) || radius <= 0 || !finite(startAngle) || !finite(sweep) || Math.abs(sweep) <= EPSILON) {
    throw new TypeError(`Nominal arc ${entityIndex} requires a finite center, positive radius, startAngle, and nonzero sweep in radians.`);
  }
  if (!finite(endpointUncertaintyMm) || endpointUncertaintyMm < 0) {
    throw new TypeError(`Nominal arc ${entityIndex} endpointUncertaintyMm must be a finite nonnegative canonical-millimetre value.`);
  }
  if (entity?.geometryUncertaintyMm !== undefined && declaredUncertaintyMm < endpointUncertaintyMm) {
    throw new TypeError(`Nominal arc ${entityIndex} geometryUncertaintyMm must be no smaller than its endpoint uncertainty.`);
  }
  if (Math.abs(sweep) > TAU) throw new RangeError(`Nominal arc ${entityIndex} sweep exceeds one revolution.`);
  if (!numericallySafePoint(center) || !numericallySafeScalar(radius)) throw numericRangeError(`nominal arc ${entityIndex}`);
  if (!numericallyPreciseArc(center, radius, [startAngle, sweep], numericalBudgetMm)) {
    throw numericResolutionError(`nominal arc ${entityIndex}`, numericalBudgetMm);
  }
  if (!finite(radius * Math.abs(sweep))) throw numericRangeError(`nominal arc ${entityIndex} length`);
  const start = pointAtAngle(center, radius, startAngle);
  const end = pointAtAngle(center, radius, startAngle + sweep);
  if (!finitePoint(start) || !finitePoint(end)) throw numericRangeError(`nominal arc ${entityIndex} endpoints`);
  if (!numericallyPrecisePoint(start, numericalBudgetMm) || !numericallyPrecisePoint(end, numericalBudgetMm)) {
    throw numericResolutionError(`nominal arc ${entityIndex} endpoints`, numericalBudgetMm);
  }
  const metadataUncertaintyMm = Math.max(
    geometryUncertaintyMm,
    arcResolutionUncertaintyMm(center, radius, [startAngle, sweep], [start, end]),
  );
  if (metadataUncertaintyMm > numericalBudgetMm) {
    throw numericResolutionError(`nominal arc ${entityIndex} geometry uncertainty`, numericalBudgetMm);
  }
  return {
    type: "arc",
    center: clonePoint(center),
    radius,
    startAngle,
    sweep,
    start,
    end,
    entityIndex,
    pieceIndex: 0,
    id: entity.id ?? null,
    metadataUncertaintyMm,
  };
}

function normalizedCircle(entity, entityIndex, numericalBudgetMm) {
  const center = entity?.center;
  const radius = Number(entity?.radius);
  if (!finitePoint(center) || !finite(radius) || radius <= 0) {
    throw new TypeError(`Nominal circle ${entityIndex} requires a finite center and positive radius.`);
  }
  if (!numericallySafePoint(center) || !numericallySafeScalar(radius) || !finite(radius * 2)) {
    throw numericRangeError(`nominal circle ${entityIndex}`);
  }
  if (!numericallyPreciseArc(center, radius, [TAU], numericalBudgetMm)) {
    throw numericResolutionError(`nominal circle ${entityIndex}`, numericalBudgetMm);
  }
  const metadataUncertaintyMm = Math.max(
    declaredGeometryUncertaintyMm(entity, `Nominal circle ${entityIndex}`),
    arcResolutionUncertaintyMm(center, radius, [TAU]),
  );
  if (metadataUncertaintyMm > numericalBudgetMm) {
    throw numericResolutionError(`nominal circle ${entityIndex} geometry uncertainty`, numericalBudgetMm);
  }
  return {
    type: "circle",
    center: clonePoint(center),
    radius,
    entityIndex,
    pieceIndex: 0,
    id: entity.id ?? null,
    metadataUncertaintyMm,
  };
}

function normalizedPolyline(entity, entityIndex, numericalBudgetMm) {
  if (!Array.isArray(entity?.points) || entity.points.length < 2 || entity.points.some((point) => !finitePoint(point))) {
    throw new TypeError(`Nominal polyline ${entityIndex} requires at least two finite canonical {z, x} points.`);
  }
  const points = entity.points.map(clonePoint);
  if (points.some((point) => !numericallySafePoint(point))) throw numericRangeError(`nominal polyline ${entityIndex}`);
  if (points.some((point) => !numericallyPrecisePoint(point, numericalBudgetMm))) {
    throw numericResolutionError(`nominal polyline ${entityIndex} coordinates`, numericalBudgetMm);
  }
  if (entity.closed === true && distance(points[0], points.at(-1)) > EPSILON) points.push({...points[0]});
  const pieces = [];
  for (let index = 1; index < points.length; index += 1) {
    if (distance(points[index - 1], points[index]) <= EPSILON) continue;
    pieces.push(normalizedLine(
      {
        id: entity.id,
        start: points[index - 1],
        end: points[index],
        geometryUncertaintyMm: entity.geometryUncertaintyMm,
      },
      entityIndex,
      numericalBudgetMm,
      index - 1,
    ));
  }
  if (!pieces.length) throw new RangeError(`Nominal polyline ${entityIndex} has no nonzero line segments.`);
  return pieces;
}

function normalizeNominalGeometry(input, numericalBudgetMm) {
  const entities = nominalInputArray(input);
  if (!entities.length) throw new RangeError("Nominal geometry must contain at least one supported entity.");
  if (entities.length > MAX_PROFILE_NOMINAL_ENTITIES) {
    throw new RangeError(`Profile comparison blocked: nominal geometry exceeds the ${MAX_PROFILE_NOMINAL_ENTITIES}-entity limit.`);
  }
  for (let entityIndex = 0; entityIndex < entities.length; entityIndex += 1) {
    if (!Object.hasOwn(entities, entityIndex)) {
      throw new TypeError(`Nominal geometry is sparse; entity ${entityIndex} is missing.`);
    }
  }
  const pieces = [];
  let sourcePointCount = 0;
  entities.forEach((entity, entityIndex) => {
    const type = entityType(entity);
    let additions;
    if (type === "line") additions = [normalizedLine(entity, entityIndex, numericalBudgetMm)];
    else if (type === "arc") additions = [normalizedArc(entity, entityIndex, numericalBudgetMm)];
    else if (type === "circle") additions = [normalizedCircle(entity, entityIndex, numericalBudgetMm)];
    else if (["polyline", "lwpolyline", "lightweight-polyline"].includes(type)) {
      const pointCount = Array.isArray(entity?.points) ? entity.points.length : 0;
      if (pointCount > MAX_PROFILE_NOMINAL_SOURCE_POINTS - sourcePointCount) {
        throw new RangeError(
          `Profile comparison blocked: nominal polylines exceed the ${MAX_PROFILE_NOMINAL_SOURCE_POINTS}-source-point limit.`,
        );
      }
      sourcePointCount += pointCount;
      if (entity.points?.length > MAX_PROFILE_NOMINAL_PIECES + 1) {
        throw new RangeError(`Profile comparison blocked: nominal polyline ${entityIndex} exceeds the ${MAX_PROFILE_NOMINAL_PIECES}-piece limit.`);
      }
      additions = normalizedPolyline(entity, entityIndex, numericalBudgetMm);
    }
    else throw new TypeError(`Nominal entity ${entityIndex} has unsupported type ${entity?.type || entity?.kind || "(missing)"}.`);
    if (pieces.length + additions.length > MAX_PROFILE_NOMINAL_PIECES) {
      throw new RangeError(`Profile comparison blocked: normalized geometry exceeds the ${MAX_PROFILE_NOMINAL_PIECES}-piece limit.`);
    }
    for (const addition of additions) pieces.push(addition);
  });
  const metadataUncertaintyMm = pieces.reduce(
    (maximum, piece) => Math.max(maximum, piece.metadataUncertaintyMm || 0),
    0,
  );
  return {entities, pieces, metadataUncertaintyMm};
}

function distancePointToLine(point, line) {
  const dz = line.end.z - line.start.z;
  const dx = line.end.x - line.start.x;
  const denominator = dz * dz + dx * dx;
  const fraction = denominator === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.z - line.start.z) * dz + (point.x - line.start.x) * dx) / denominator));
  const nearestPoint = {
    z: line.start.z + dz * fraction,
    x: line.start.x + dx * fraction,
  };
  return {distance: distance(point, nearestPoint), nearestPoint};
}

function distancePointToArc(point, arc) {
  const dz = point.z - arc.center.z;
  const dx = point.x - arc.center.x;
  const radial = Math.hypot(dz, dx);
  const angle = radial > EPSILON ? Math.atan2(dx, dz) : arc.startAngle;
  if (angleOnSweep(angle, arc.startAngle, arc.sweep)) {
    const nearestPoint = pointAtAngle(arc.center, arc.radius, angle);
    return {distance: Math.abs(radial - arc.radius), nearestPoint};
  }
  const start = arc.start || pointAtAngle(arc.center, arc.radius, arc.startAngle);
  const end = arc.end || pointAtAngle(arc.center, arc.radius, arc.startAngle + arc.sweep);
  return distance(point, start) <= distance(point, end)
    ? {distance: distance(point, start), nearestPoint: {...start}}
    : {distance: distance(point, end), nearestPoint: {...end}};
}

function distancePointToCircle(point, circle) {
  const dz = point.z - circle.center.z;
  const dx = point.x - circle.center.x;
  const radial = Math.hypot(dz, dx);
  const angle = radial > EPSILON ? Math.atan2(dx, dz) : 0;
  const nearestPoint = pointAtAngle(circle.center, circle.radius, angle);
  return {distance: Math.abs(radial - circle.radius), nearestPoint};
}

function comparisonBudgetError(operationBudget, requested, context) {
  const error = new RangeError(
    `Profile comparison blocked: ${context} would exceed the safe ${operationBudget.limit.toLocaleString()}-operation budget `
    + `(${operationBudget.used.toLocaleString()} used, ${requested.toLocaleString()} requested). Reduce nominal geometry or program scope.`,
  );
  error.code = PROFILE_COMPARISON_WORKLOAD_EXHAUSTED;
  error.operationLimit = operationBudget.limit;
  error.operationsUsed = operationBudget.used;
  error.operationsRequested = requested;
  error.operationContext = context;
  return error;
}

function minimumComparisonBudgetError(message, operationLimit, operationsRequested, operationContext) {
  const error = new RangeError(message);
  error.code = PROFILE_COMPARISON_WORKLOAD_EXHAUSTED;
  error.operationLimit = operationLimit;
  error.operationsUsed = 0;
  error.operationsRequested = operationsRequested;
  error.operationContext = operationContext;
  return error;
}

export function isProfileComparisonWorkloadError(error) {
  return error?.code === PROFILE_COMPARISON_WORKLOAD_EXHAUSTED;
}

function consumeComparisonOperations(operationBudget, requested, context) {
  if (operationBudget.used + requested > operationBudget.limit) {
    throw comparisonBudgetError(operationBudget, requested, context);
  }
  operationBudget.used += requested;
}

function distancePointToNominal(point, nominalPieces, operationBudget) {
  consumeComparisonOperations(operationBudget, nominalPieces.length, "nearest-geometry evaluation");
  let best = null;
  for (const piece of nominalPieces) {
    const result = piece.type === "line"
      ? distancePointToLine(point, piece)
      : piece.type === "arc"
        ? distancePointToArc(point, piece)
        : distancePointToCircle(point, piece);
    if (!best || result.distance < best.distance) best = {...result, piece};
  }
  return best;
}

function programPoint(point, xScale, numericalBudgetMm) {
  const mapped = {z: Number(point.z), x: Number(point.x) * xScale};
  if (!numericallySafePoint(mapped)) throw numericRangeError("scaled program coordinates");
  if (!numericallyPrecisePoint(mapped, numericalBudgetMm)) {
    throw numericResolutionError("scaled program coordinates", numericalBudgetMm);
  }
  return mapped;
}

function programMotionKind(segment) {
  const type = String(segment?.type || "").trim().toLowerCase();
  const sourceMotion = String(segment?.sourceMotion || "").trim().toLowerCase();
  const arcMotions = ["arc-cw", "arc-ccw"];
  const linearMotions = ["linear", "line", "polyline"];
  const wrappedLinearMotions = ["rough", "finish", "cycle-profile"];
  const allowedTypes = [...arcMotions, ...linearMotions, ...wrappedLinearMotions, "rapid"];
  if (!allowedTypes.includes(type)) return null;
  if (sourceMotion) {
    if (['g32', 'g76'].includes(sourceMotion) && segment?.threading?.synchronized === true
      && ['linear', 'finish', 'rough'].includes(type)) return {kind: 'linear'};
    if (arcMotions.includes(sourceMotion)
      && [...arcMotions, ...linearMotions, "finish", "cycle-profile"].includes(type)) {
      return {kind: "arc", direction: sourceMotion};
    }
    if (linearMotions.includes(sourceMotion)) return {kind: "linear"};
    if (sourceMotion === "rapid" && type === "rapid") return {kind: "linear"};
    return null;
  }
  if (arcMotions.includes(type)) return {kind: "arc", direction: type};
  return {kind: "linear"};
}

function segmentIsPlanarTurning(segment) {
  if (segment?.liveTool === true || segment?.machiningMode === "live-tool" || segment?.cAxisMotion) return false;
  if (segment?.coordinateMode && segment.coordinateMode !== "turning-xz") return false;
  const hasNonplanarCoordinate = (point) => point != null
    && (Object.hasOwn(point, "y") || Object.hasOwn(point, "c"));
  return !hasNonplanarCoordinate(segment?.start)
    && !hasNonplanarCoordinate(segment?.end)
    && !(Array.isArray(segment?.points) && segment.points.some(hasNonplanarCoordinate));
}

function normalizedProgramCurves(segment, programXScale, motion, numericalBudgetMm) {
  const effectiveXScale = segment?.xCoordinateMode === "radius" ? 1 : programXScale;
  if (motion.kind === "arc") {
    if (!finitePoint(segment?.center) || !finite(segment?.radius) || segment.radius <= 0
      || !finite(segment?.sweep) || Math.abs(segment.sweep) <= EPSILON
      || Math.abs(segment.sweep) > TAU
      || motion.direction === "arc-cw" && segment.sweep >= 0
      || motion.direction === "arc-ccw" && segment.sweep <= 0
      || !finitePoint(segment?.start) || !finitePoint(segment?.end)) return [];
    const start = programPoint(segment.start, effectiveXScale, numericalBudgetMm);
    const end = programPoint(segment.end, effectiveXScale, numericalBudgetMm);
    const center = clonePoint(segment.center);
    if (!numericallySafePoint(center) || !numericallySafeScalar(segment.radius)) {
      throw numericRangeError("program arc");
    }
    const startAngle = Math.atan2(start.x - center.x, start.z - center.z);
    const arcLength = Number(segment.radius) * Math.abs(Number(segment.sweep));
    if (!finite(startAngle) || !finite(arcLength)) throw numericRangeError("program arc extent");
    if (!numericallyPreciseArc(
      center,
      Number(segment.radius),
      [startAngle, Number(segment.sweep)],
      numericalBudgetMm,
    )) {
      throw numericResolutionError("program arc", numericalBudgetMm);
    }
    const expectedStart = pointAtAngle(center, Number(segment.radius), startAngle);
    const expectedEnd = pointAtAngle(center, Number(segment.radius), startAngle + Number(segment.sweep));
    if (!numericallyPrecisePoint(expectedStart, numericalBudgetMm)
      || !numericallyPrecisePoint(expectedEnd, numericalBudgetMm)) {
      throw numericResolutionError("program arc endpoints", numericalBudgetMm);
    }
    const startInconsistencyMm = distance(start, expectedStart);
    const endInconsistencyMm = distance(end, expectedEnd);
    const startAllowanceMm = arcEndpointConsistencyAllowanceMm(
      center,
      Number(segment.radius),
      startAngle,
      expectedStart,
    );
    const endAllowanceMm = arcEndpointConsistencyAllowanceMm(
      center,
      Number(segment.radius),
      startAngle + Number(segment.sweep),
      expectedEnd,
    );
    if (startInconsistencyMm > startAllowanceMm + EPSILON
      || endInconsistencyMm > endAllowanceMm + EPSILON) return [];
    const metadataUncertaintyMm = Math.max(
      declaredGeometryUncertaintyMm(segment, "Program arc"),
      arcResolutionUncertaintyMm(
        center,
        Number(segment.radius),
        [startAngle, Number(segment.sweep)],
        [start, end, expectedStart, expectedEnd],
      ) + Math.max(startInconsistencyMm, endInconsistencyMm),
    );
    return [{
      type: "arc",
      center,
      radius: Number(segment.radius),
      startAngle,
      sweep: Number(segment.sweep),
      start,
      end,
      metadataUncertaintyMm,
    }];
  }

  const rawPoints = Array.isArray(segment?.points) && segment.points.length >= 2
    ? segment.points
    : [segment?.start, segment?.end].filter(Boolean);
  if (rawPoints.length > MAX_PROFILE_PROGRAM_CURVES + 1) {
    throw new RangeError(
      `Profile comparison blocked: one program segment exceeds the ${MAX_PROFILE_PROGRAM_CURVES}-curve limit.`,
    );
  }
  if (rawPoints.length < 2 || rawPoints.some((point) => !finitePoint(point))) return [];
  const points = rawPoints.map((point) => programPoint(point, effectiveXScale, numericalBudgetMm));
  const declaredUncertaintyMm = declaredGeometryUncertaintyMm(segment, "Program line or polyline");
  const curves = [];
  for (let index = 1; index < points.length; index += 1) {
    const length = distance(points[index - 1], points[index]);
    if (!finite(length)) throw numericRangeError("program line extent");
    if (length <= EPSILON) continue;
    curves.push({
      type: "line",
      start: points[index - 1],
      end: points[index],
      metadataUncertaintyMm: Math.max(
        declaredUncertaintyMm,
        lineResolutionUncertaintyMm(points[index - 1], points[index]),
      ),
    });
  }
  return curves;
}

function curveLength(curve) {
  return curve.type === "arc"
    ? curve.radius * Math.abs(curve.sweep)
    : distance(curve.start, curve.end);
}

function curvePointAt(curve, fraction) {
  if (curve.type === "arc") {
    if (fraction === 0) return {...curve.start};
    if (fraction === 1) return {...curve.end};
    return pointAtAngle(curve.center, curve.radius, curve.startAngle + curve.sweep * fraction);
  }
  return {
    z: curve.start.z + (curve.end.z - curve.start.z) * fraction,
    x: curve.start.x + (curve.end.x - curve.start.x) * fraction,
  };
}

function curveSlice(curve, startFraction, endFraction) {
  if (curve.type === "arc") {
    const startAngle = curve.startAngle + curve.sweep * startFraction;
    const sweep = curve.sweep * (endFraction - startFraction);
    return {
      type: "arc",
      center: curve.center,
      radius: curve.radius,
      startAngle,
      sweep,
      start: pointAtAngle(curve.center, curve.radius, startAngle),
      end: pointAtAngle(curve.center, curve.radius, startAngle + sweep),
    };
  }
  return {
    type: "line",
    start: curvePointAt(curve, startFraction),
    end: curvePointAt(curve, endFraction),
  };
}

function radialDistanceRangeOnArc(arc, center) {
  const offsetAngle = Math.atan2(center.x - arc.center.x, center.z - arc.center.z);
  const candidates = [arc.startAngle, arc.startAngle + arc.sweep];
  for (const angle of [offsetAngle, offsetAngle + Math.PI]) {
    if (angleOnSweep(angle, arc.startAngle, arc.sweep)) candidates.push(angle);
  }
  const values = candidates.map((angle) => distance(pointAtAngle(arc.center, arc.radius, angle), center));
  return {minimum: Math.min(...values), maximum: Math.max(...values)};
}

function exactPairMaximum(programCurve, nominalPiece) {
  if (programCurve.type === "line" && nominalPiece.type === "line") {
    return Math.max(
      distancePointToLine(programCurve.start, nominalPiece).distance,
      distancePointToLine(programCurve.end, nominalPiece).distance,
    );
  }
  if (programCurve.type === "line" && nominalPiece.type === "circle") {
    const minimumRadius = distancePointToLine(nominalPiece.center, programCurve).distance;
    const maximumRadius = Math.max(distance(programCurve.start, nominalPiece.center), distance(programCurve.end, nominalPiece.center));
    return Math.max(Math.abs(minimumRadius - nominalPiece.radius), Math.abs(maximumRadius - nominalPiece.radius));
  }
  if (programCurve.type === "arc" && nominalPiece.type === "circle") {
    const range = radialDistanceRangeOnArc(programCurve, nominalPiece.center);
    return Math.max(Math.abs(range.minimum - nominalPiece.radius), Math.abs(range.maximum - nominalPiece.radius));
  }
  if (programCurve.type === "arc" && nominalPiece.type === "arc"
    && programCurve.center.z === nominalPiece.center.z
    && programCurve.center.x === nominalPiece.center.x
    && arcContainsArc(nominalPiece, programCurve)) {
    return Math.abs(programCurve.radius - nominalPiece.radius);
  }
  return Infinity;
}

function analyticUnionUpperBound(programCurve, nominalPieces, operationBudget) {
  consumeComparisonOperations(operationBudget, nominalPieces.length, "analytic deviation bound");
  let upper = Infinity;
  for (const nominalPiece of nominalPieces) upper = Math.min(upper, exactPairMaximum(programCurve, nominalPiece));
  return upper;
}

function adaptiveCurveDeviation(
  curve,
  nominalPieces,
  numericalBudgetMm,
  maximumEvaluations,
  operationBudget,
  nominalMetadataUncertaintyMm,
) {
  const cache = new Map();
  let evaluations = 0;
  let worstSample = null;
  const evaluate = (fraction) => {
    if (cache.has(fraction)) return cache.get(fraction);
    if (evaluations >= maximumEvaluations) return null;
    const point = curvePointAt(curve, fraction);
    const nearest = distancePointToNominal(point, nominalPieces, operationBudget);
    const sample = {fraction, point, ...nearest};
    cache.set(fraction, sample);
    evaluations += 1;
    if (!worstSample || sample.distance > worstSample.distance) worstSample = sample;
    return sample;
  };

  const intervals = [{start: 0, end: 1}];
  let finishedLowerBoundMm = 0;
  let finishedUpperBoundMm = 0;
  const finishInterval = (lower, upper) => {
    finishedLowerBoundMm = Math.max(finishedLowerBoundMm, lower);
    finishedUpperBoundMm = Math.max(finishedUpperBoundMm, upper);
  };
  let exhausted = false;
  while (intervals.length) {
    const interval = intervals.pop();
    const midpoint = (interval.start + interval.end) / 2;
    const first = evaluate(interval.start);
    const middle = evaluate(midpoint);
    const last = evaluate(interval.end);
    if (!first || !middle || !last) {
      exhausted = true;
      intervals.push(interval);
      break;
    }
    const spanLength = curveLength(curve) * (interval.end - interval.start);
    const sampledLower = Math.max(first.distance, middle.distance, last.distance);
    const firstHalfUpper = (first.distance + middle.distance + spanLength / 2) / 2;
    const secondHalfUpper = (middle.distance + last.distance + spanLength / 2) / 2;
    const lipschitzUpper = Math.max(firstHalfUpper, secondHalfUpper);
    const analyticUpper = analyticUnionUpperBound(curveSlice(curve, interval.start, interval.end), nominalPieces, operationBudget);
    const upper = Math.max(sampledLower, Math.min(lipschitzUpper, analyticUpper));
    if (upper - sampledLower <= numericalBudgetMm + EPSILON) {
      finishInterval(sampledLower, upper);
      continue;
    }
    intervals.push({start: midpoint, end: interval.end}, {start: interval.start, end: midpoint});
  }

  if (exhausted) {
    for (const interval of intervals) {
      const first = cache.get(interval.start);
      const last = cache.get(interval.end);
      const lower = Math.max(first?.distance || 0, last?.distance || 0);
      finishInterval(lower, lower + curveLength(curve) * (interval.end - interval.start));
    }
  }
  const programMetadataUncertaintyMm = finite(curve.metadataUncertaintyMm)
    ? Math.max(0, curve.metadataUncertaintyMm)
    : 0;
  const metadataUncertaintyMm = programMetadataUncertaintyMm + nominalMetadataUncertaintyMm;
  const endpointLowerBoundMm = curve.type === "arc"
    ? Math.max(
      0,
      Math.max(cache.get(0)?.distance || 0, cache.get(1)?.distance || 0) - nominalMetadataUncertaintyMm,
    )
    : 0;
  const sampledLowerBoundMm = Math.max(finishedLowerBoundMm, worstSample?.distance || 0);
  const lowerBoundMm = Math.max(endpointLowerBoundMm, sampledLowerBoundMm - metadataUncertaintyMm, 0);
  const boundedUpperBoundMm = Math.max(lowerBoundMm, finishedUpperBoundMm + metadataUncertaintyMm);
  // If the evaluation ceiling was reached, every as-yet unseen point is still
  // within one total curve length of an observed sample (distance to a fixed
  // set is 1-Lipschitz). Keep the result finite while failing conservatively.
  const exhaustionUpperBoundMm = (worstSample?.distance || 0) + curveLength(curve) + metadataUncertaintyMm;
  const upperBoundMm = exhausted
    ? Math.max(boundedUpperBoundMm, exhaustionUpperBoundMm)
    : boundedUpperBoundMm;
  return {
    lowerBoundMm,
    upperBoundMm,
    estimateMm: (lowerBoundMm + upperBoundMm) / 2,
    errorBoundMm: (upperBoundMm - lowerBoundMm) / 2,
    boundWidthMm: upperBoundMm - lowerBoundMm,
    method: upperBoundMm - lowerBoundMm <= EPSILON ? "analytic" : "adaptive-bounded",
    evaluations,
    exhausted,
    worstSample,
    metadataUncertaintyMm,
    programMetadataUncertaintyMm,
    nominalMetadataUncertaintyMm,
  };
}

function resultClassification(deviation, toleranceMm, numericalBudgetMm) {
  if (deviation.exhausted || deviation.boundWidthMm > numericalBudgetMm + EPSILON) return "numerical-limit";
  if (deviation.upperBoundMm <= toleranceMm) return "within-tolerance";
  if (deviation.lowerBoundMm > toleranceMm) return "outside-tolerance";
  return "tolerance-boundary";
}

function comparableSegmentResult(segment, segmentIndex, curves, nominalPieces, options) {
  let lowerBoundMm = 0;
  let upperBoundMm = 0;
  let worst = null;
  let allAnalytic = true;
  let evaluations = 0;
  let exhausted = false;
  let totalCurveLengthMm = 0;
  let metadataUncertaintyMm = 0;
  let programMetadataUncertaintyMm = 0;
  for (const curve of curves) {
    const result = adaptiveCurveDeviation(
      curve,
      nominalPieces,
      options.numericalBudgetMm,
      options.maximumEvaluations,
      options.operationBudget,
      options.nominalMetadataUncertaintyMm,
    );
    lowerBoundMm = Math.max(lowerBoundMm, result.lowerBoundMm);
    upperBoundMm = Math.max(upperBoundMm, result.upperBoundMm);
    if (!worst || result.lowerBoundMm > worst.lowerBoundMm) worst = result;
    allAnalytic = allAnalytic && result.method === "analytic";
    evaluations += result.evaluations;
    exhausted = exhausted || result.exhausted;
    totalCurveLengthMm += curveLength(curve);
    metadataUncertaintyMm = Math.max(metadataUncertaintyMm, result.metadataUncertaintyMm);
    programMetadataUncertaintyMm = Math.max(
      programMetadataUncertaintyMm,
      result.programMetadataUncertaintyMm,
    );
  }
  const deviation = {
    lowerBoundMm,
    upperBoundMm,
    estimateMm: (lowerBoundMm + upperBoundMm) / 2,
    errorBoundMm: (upperBoundMm - lowerBoundMm) / 2,
    boundWidthMm: upperBoundMm - lowerBoundMm,
    method: allAnalytic ? "analytic" : "adaptive-bounded",
    evaluations,
    exhausted,
    metadataUncertaintyMm,
    programMetadataUncertaintyMm,
    nominalMetadataUncertaintyMm: options.nominalMetadataUncertaintyMm,
  };
  return {
    segmentIndex,
    line: segment?.executionLine || segment?.line || null,
    sourceLine: segment?.sourceLine || segment?.line || null,
    executionLine: segment?.executionLine || segment?.line || segment?.sourceLine || null,
    globalBlockIndex: Number.isInteger(segment?.globalBlockIndex) ? segment.globalBlockIndex : segmentIndex,
    type: segment?.type || null,
    sourceMotion: segment?.sourceMotion || segment?.type || null,
    classification: resultClassification(deviation, options.toleranceMm, options.numericalBudgetMm),
    comparable: true,
    curveLengthMm: totalCurveLengthMm,
    deviation,
    worstPoint: worst?.worstSample ? {...worst.worstSample.point} : null,
    nearestNominal: worst?.worstSample ? {
      entityIndex: worst.worstSample.piece.entityIndex,
      pieceIndex: worst.worstSample.piece.pieceIndex,
      id: worst.worstSample.piece.id,
      type: worst.worstSample.piece.type,
      point: {...worst.worstSample.nearestPoint},
      sampledDistanceMm: worst.worstSample.distance,
    } : null,
  };
}

function excludedSegmentResult(segment, segmentIndex, classification, reason) {
  return {
    segmentIndex,
    line: segment?.executionLine || segment?.line || null,
    sourceLine: segment?.sourceLine || segment?.line || null,
    executionLine: segment?.executionLine || segment?.line || segment?.sourceLine || null,
    globalBlockIndex: Number.isInteger(segment?.globalBlockIndex) ? segment.globalBlockIndex : segmentIndex,
    type: segment?.type || null,
    sourceMotion: segment?.sourceMotion || segment?.type || null,
    classification,
    comparable: false,
    reason,
    curveLengthMm: 0,
    deviation: null,
    worstPoint: null,
    nearestNominal: null,
    violationFragments: [],
    fragmentLimitExceeded: false,
  };
}

function aggregateResults(segmentResults, toleranceMm) {
  const comparable = segmentResults.filter((result) => result.comparable);
  const counts = Object.fromEntries([
    "within-tolerance", "outside-tolerance", "tolerance-boundary", "numerical-limit", "excluded", "unsupported",
  ].map((classification) => [classification, segmentResults.filter((result) => result.classification === classification).length]));
  let lowerBoundMm = null;
  let upperBoundMm = null;
  for (const result of comparable) {
    lowerBoundMm = lowerBoundMm === null
      ? result.deviation.lowerBoundMm
      : Math.max(lowerBoundMm, result.deviation.lowerBoundMm);
    upperBoundMm = upperBoundMm === null
      ? result.deviation.upperBoundMm
      : Math.max(upperBoundMm, result.deviation.upperBoundMm);
  }
  let classification = "no-comparable-segments";
  if (counts.unsupported || counts["numerical-limit"]) classification = "unresolved";
  else if (counts["outside-tolerance"]) classification = "outside-tolerance";
  else if (counts["tolerance-boundary"]) classification = "tolerance-boundary";
  else if (comparable.length && upperBoundMm <= toleranceMm) classification = "within-tolerance";
  return {
    classification,
    complete: comparable.length > 0 && !counts.unsupported && !counts["numerical-limit"] && !counts["tolerance-boundary"],
    comparableSegments: comparable.length,
    totalSegments: segmentResults.length,
    counts,
    maximumDeviation: comparable.length ? {
      lowerBoundMm,
      upperBoundMm,
      estimateMm: (lowerBoundMm + upperBoundMm) / 2,
      errorBoundMm: (upperBoundMm - lowerBoundMm) / 2,
      boundWidthMm: upperBoundMm - lowerBoundMm,
    } : null,
  };
}

/**
 * Compare parsed G-code segments with already mapped nominal 2D geometry.
 *
 * `programXScale` is mandatory because parsed ordinary-lathe X endpoints retain
 * programmed diameter/radius values. Pass 0.5 for diameter mode or 1 for radius
 * mode. Parser segments marked `xCoordinateMode: "radius"` override it with 1.
 * Arc centers/radii follow the parser convention and are already physical.
 * Nominal geometry must already be in canonical millimetres and `{z, x}` axes.
 */
export function compareProgramProfileToNominal(programSegments, nominalGeometry, {
  programXScale,
  toleranceMm = DEFAULT_PROFILE_TOLERANCE_MM,
  numericalBudgetMm = DEFAULT_PROFILE_NUMERICAL_BUDGET_MM,
  includeRapid = false,
  programVerificationBlocked = false,
  maximumEvaluations = MAX_PROFILE_EVALUATIONS_PER_CURVE,
  maximumComparisonOperations = MAX_PROFILE_COMPARISON_OPERATIONS,
} = {}) {
  if (!Array.isArray(programSegments)) throw new TypeError("Program segments must be an array.");
  if (programSegments.length > MAX_PROFILE_PROGRAM_SEGMENTS) {
    throw new RangeError(`Profile comparison blocked: program exceeds the ${MAX_PROFILE_PROGRAM_SEGMENTS}-segment limit.`);
  }
  if (programXScale !== 0.5 && programXScale !== 1) {
    throw new TypeError("programXScale is required and must be exactly 0.5 for diameter mode or 1 for radius mode.");
  }
  if (typeof includeRapid !== "boolean") throw new TypeError("includeRapid must be a boolean.");
  if (typeof programVerificationBlocked !== "boolean") {
    throw new TypeError("programVerificationBlocked must be a boolean.");
  }
  if (!finite(toleranceMm) || toleranceMm < 0) throw new RangeError("toleranceMm must be a finite nonnegative canonical-millimetre value.");
  if (!finite(numericalBudgetMm) || numericalBudgetMm <= 0 || numericalBudgetMm > MAX_PROFILE_NUMERICAL_BUDGET_MM) {
    throw new RangeError(`numericalBudgetMm must be positive and no greater than ${MAX_PROFILE_NUMERICAL_BUDGET_MM} mm.`);
  }
  if (!Number.isInteger(maximumEvaluations)
    || maximumEvaluations < 3
    || maximumEvaluations > MAX_PROFILE_EVALUATIONS_PER_CURVE) {
    throw new RangeError(
      `maximumEvaluations must be an integer from 3 through the hard per-curve safety limit of ${MAX_PROFILE_EVALUATIONS_PER_CURVE}.`,
    );
  }
  if (!Number.isInteger(maximumComparisonOperations)
    || maximumComparisonOperations < 1
    || maximumComparisonOperations > MAX_PROFILE_COMPARISON_OPERATIONS) {
    throw new RangeError(
      `maximumComparisonOperations must be an integer from 1 through the hard safety limit of ${MAX_PROFILE_COMPARISON_OPERATIONS}.`,
    );
  }
  const nominal = normalizeNominalGeometry(nominalGeometry, numericalBudgetMm);
  const operationBudget = {limit: maximumComparisonOperations, used: 0};
  const options = {
    toleranceMm,
    numericalBudgetMm,
    maximumEvaluations,
    operationBudget,
    nominalMetadataUncertaintyMm: nominal.metadataUncertaintyMm,
  };
  const preparedSegments = [];
  let comparableCurveCount = 0;
  let programSourcePointCount = 0;
  for (let segmentIndex = 0; segmentIndex < programSegments.length; segmentIndex += 1) {
    const segment = programSegments[segmentIndex];
    const sourcePointCount = Array.isArray(segment?.points) ? segment.points.length : 0;
    if (sourcePointCount > MAX_PROFILE_PROGRAM_SOURCE_POINTS - programSourcePointCount) {
      throw new RangeError(
        `Profile comparison blocked: program motion exceeds the ${MAX_PROFILE_PROGRAM_SOURCE_POINTS}-source-point limit.`,
      );
    }
    programSourcePointCount += sourcePointCount;
    if (segment?.verificationBlocked || segment?.liveToolBlocked) {
      preparedSegments.push({result: excludedSegmentResult(segment, segmentIndex, "unsupported", "Verification-blocked motion cannot support a nominal-deviation result.")});
      continue;
    }
    const rapid = segment?.type === "rapid" || segment?.type === "live-rapid";
    if (rapid && !includeRapid) {
      preparedSegments.push({result: excludedSegmentResult(segment, segmentIndex, "excluded", "Rapid motion is excluded from nominal profile comparison by default.")});
      continue;
    }
    if (Array.isArray(segment?.points) && segment.points.length > MAX_PROFILE_PROGRAM_CURVES + 1) {
      throw new RangeError(
        `Profile comparison blocked: one program segment exceeds the ${MAX_PROFILE_PROGRAM_CURVES}-curve input limit.`,
      );
    }
    if (!segmentIsPlanarTurning(segment)) {
      preparedSegments.push({result: excludedSegmentResult(segment, segmentIndex, "unsupported", "Only planar turning X/Z motion is supported by this 2D profile comparison.")});
      continue;
    }
    const motion = programMotionKind(segment);
    if (!motion) {
      preparedSegments.push({result: excludedSegmentResult(segment, segmentIndex, "unsupported", "The program motion type is not an explicitly supported linear, polyline, rapid, or analytic X/Z arc motion.")});
      continue;
    }
    const curves = normalizedProgramCurves(segment, programXScale, motion, numericalBudgetMm);
    if (!curves.length) {
      const reason = motion.kind === "arc"
        ? "The intended arc has missing, invalid, or endpoint-inconsistent analytic metadata."
        : "The segment has no finite nonzero analytic line or polyline pieces.";
      preparedSegments.push({result: excludedSegmentResult(segment, segmentIndex, "unsupported", reason)});
      continue;
    }
    comparableCurveCount += curves.length;
    if (comparableCurveCount > MAX_PROFILE_PROGRAM_CURVES) {
      throw new RangeError(`Profile comparison blocked: normalized program motion exceeds the ${MAX_PROFILE_PROGRAM_CURVES}-curve limit.`);
    }
    // Every adaptive curve begins with three nearest-geometry evaluations and
    // one analytic-bound pass. Preflight that irreducible Cartesian workload
    // for all prepared curves before starting any nominal-piece scan.
    const minimumOperations = comparableCurveCount * nominal.pieces.length * 4;
    if (minimumOperations > maximumComparisonOperations) {
      throw minimumComparisonBudgetError(
        `Profile comparison blocked: the minimum workload is ${minimumOperations.toLocaleString()} nominal-pair operations, `
        + `which exceeds the safe ${maximumComparisonOperations.toLocaleString()}-operation budget. Reduce nominal geometry or program scope.`,
        maximumComparisonOperations,
        minimumOperations,
        "minimum directed-deviation workload",
      );
    }
    preparedSegments.push({segment, segmentIndex, curves});
  }
  if (programVerificationBlocked) {
    preparedSegments.push({
      result: excludedSegmentResult(
        {type: "parser-diagnostic"},
        programSegments.length,
        "unsupported",
        "Verification-blocking parser diagnostics prevent a complete nominal-deviation result.",
      ),
    });
  }
  const segmentResults = preparedSegments.map((prepared) => prepared.result || comparableSegmentResult(
    prepared.segment,
    prepared.segmentIndex,
    prepared.curves,
    nominal.pieces,
    options,
  ));
  return {
    scope: PROFILE_COMPARISON_SCOPE,
    toleranceMm,
    numericalBudgetMm,
    programXScale,
    direction: PROFILE_COMPARISON_SCOPE.direction,
    nominalEntityCount: nominal.entities.length,
    nominalPieceCount: nominal.pieces.length,
    nominalMetadataUncertaintyMm: nominal.metadataUncertaintyMm,
    maximumComparisonOperations,
    comparisonOperations: operationBudget.used,
    segmentResults,
    aggregate: aggregateResults(segmentResults, toleranceMm),
  };
}

function qualifyMaterialRegion(input, numericalBudgetMm) {
  if (!input || Array.isArray(input) || input.authorized !== true
    || !["step-section", "dxf-profile"].includes(input.format)) {
    return {
      authorized: false,
      reason: "Signed profile-side checking requires an authorized STEP section or an explicitly selected and qualified DXF material contour.",
    };
  }
  const region = input.materialRegion;
  if (region?.qualified !== true || !Array.isArray(region.boundary) || !region.boundary.length) {
    return {
      authorized: false,
      reason: region?.unqualifiedReason?.message
        || region?.reason
        || "The reference does not provide one topology-qualified closed nominal-material boundary.",
    };
  }
  if (input.format === "dxf-profile") {
    const sourceHash = typeof input.source?.hash === "string" && input.source.hash
      ? input.source.hash
      : null;
    const provenance = region.provenance;
    const contour = Array.isArray(input.materialContours)
      ? input.materialContours.find((candidate) => candidate.contourId === region.sourceContourId)
      : null;
    const boundaryPrimitiveIds = new Set(region.boundary
      .filter((primitive) => !primitive.source?.numericalClosure)
      .map((primitive) => String(primitive.id)));
    const provenancePrimitiveIds = Array.isArray(provenance?.primitiveIds)
      ? provenance.primitiveIds.map(String)
      : [];
    const provenanceTransform = provenance?.transform;
    const currentTransform = input.transform;
    const transformMatches = provenanceTransform?.mapping === currentTransform?.mapping
      && provenanceTransform?.origin?.x === currentTransform?.origin?.x
      && provenanceTransform?.origin?.y === currentTransform?.origin?.y
      && provenanceTransform?.offset?.z === currentTransform?.offset?.z
      && provenanceTransform?.offset?.x === currentTransform?.offset?.x
      && provenanceTransform?.zDirection === currentTransform?.zDirection
      && provenanceTransform?.radialDirection === currentTransform?.radialDirection;
    if (region.qualification !== "dxf-explicit-closed-contour-inside-v1"
      || region.coordinateSystem !== "lathe-xz"
      || region.boundaryClosed !== true
      || region.materialSide !== "inside"
      || region.profileSide !== "explicit-inside"
      || !sourceHash
      || provenance?.sourceHash !== sourceHash
      || provenance?.contourId !== region.sourceContourId
      || provenance?.selectionAuthority !== "explicit-closed-contour-and-inside-material-confirmation"
      || provenance?.layerVisibilityAuthority !== "resolved-visible-modelspace-layer-record"
      || !transformMatches
      || !contour?.eligible
      || contour.contourId !== provenance.contourId
      || provenancePrimitiveIds.length !== boundaryPrimitiveIds.size
      || provenancePrimitiveIds.some((id) => !boundaryPrimitiveIds.has(id))) {
      return {
        authorized: false,
        reason: "The DXF material selection no longer matches its exact source, mapped contour, visible layer authority, and explicit inside-material confirmation.",
      };
    }
  }
  const nominal = normalizeNominalGeometry({authorized: true, primitives: region.boundary}, numericalBudgetMm);
  return {authorized: true, reason: null, nominal};
}

function directedArcMembership(arc, angle, numericalBudgetMm) {
  const magnitude = Math.abs(arc.sweep);
  const delta = arc.sweep >= 0
    ? normalizedAngle(angle - arc.startAngle)
    : normalizedAngle(arc.startAngle - angle);
  const arithmeticAngularAllowance = Number.EPSILON * NUMERIC_RESOLUTION_ULPS * Math.max(
    1,
    Math.abs(angle),
    Math.abs(arc.startAngle),
    magnitude,
    Math.abs(delta),
  );
  const dimensionalAngularCap = numericalBudgetMm / arc.radius;
  const endpointAllowance = Math.min(arithmeticAngularAllowance, dimensionalAngularCap);
  const distanceFromStart = Math.min(delta, TAU - delta);
  const distanceFromEnd = Math.abs(delta - magnitude);
  if (distanceFromStart <= endpointAllowance || distanceFromEnd <= endpointAllowance) {
    return {ambiguous: true};
  }
  if (delta < magnitude) return {ambiguous: false};
  return null;
}

function rayCrossingCount(point, nominalPieces, operationBudget, numericalBudgetMm) {
  consumeComparisonOperations(operationBudget, nominalPieces.length, "signed-profile ray classification");
  let crossings = 0;
  let ambiguous = false;
  for (const piece of nominalPieces) {
    if (piece.type === "line") {
      const startAbove = piece.start.z > point.z;
      const endAbove = piece.end.z > point.z;
      if (startAbove === endAbove) continue;
      const fraction = (point.z - piece.start.z) / (piece.end.z - piece.start.z);
      const crossingX = piece.start.x + (piece.end.x - piece.start.x) * fraction;
      if (!finite(crossingX)) throw numericRangeError("signed-profile line intersection");
      if (crossingX > point.x) crossings += 1;
      continue;
    }
    if (piece.type !== "arc" && piece.type !== "circle") {
      throw new TypeError("Signed material entry supports only a qualified profile's analytic lines and arcs.");
    }
    const ratio = (point.z - piece.center.z) / piece.radius;
    if (!finite(ratio)) throw numericRangeError("signed-profile arc intersection");
    if (ratio <= -1 || ratio >= 1) continue;
    const angle = Math.acos(ratio);
    for (const candidate of [angle, -angle]) {
      const membership = piece.type === "circle"
        ? {ambiguous: false}
        : directedArcMembership(piece, candidate, numericalBudgetMm);
      if (piece.type !== "circle" && membership === null) continue;
      if (membership.ambiguous) {
        ambiguous = true;
        continue;
      }
      const crossingX = piece.center.x + Math.sin(candidate) * piece.radius;
      if (crossingX <= point.x) continue;
      if (piece.type === "circle") {
        crossings += 1;
        continue;
      }
      crossings += 1;
    }
  }
  return {crossings, ambiguous};
}

function materialSideAtPoint(point, nearest, nominalPieces, operationBudget, numericalBudgetMm, nominalMetadataUncertaintyMm) {
  const boundaryAllowanceMm = nominalMetadataUncertaintyMm + numericalBudgetMm;
  if (nearest.distance <= boundaryAllowanceMm) return "boundary";
  const minimumShiftMm = Math.max(numericResolutionMm(point.z) * 16, numericalBudgetMm / 16);
  if (nearest.distance / 4 < minimumShiftMm) return "unresolved";
  const shiftMm = minimumShiftMm;
  if (!finite(shiftMm) || shiftMm <= 0 || shiftMm >= nearest.distance / 2) return "unresolved";
  const below = rayCrossingCount(
    {z: point.z - shiftMm, x: point.x},
    nominalPieces,
    operationBudget,
    numericalBudgetMm,
  );
  const above = rayCrossingCount(
    {z: point.z + shiftMm, x: point.x},
    nominalPieces,
    operationBudget,
    numericalBudgetMm,
  );
  if (below.ambiguous || above.ambiguous) return "unresolved";
  const belowParity = below.crossings % 2;
  const aboveParity = above.crossings % 2;
  if (belowParity !== aboveParity) return "unresolved";
  return belowParity ? "inside" : "outside";
}

function adaptiveCurveMaterialEntry(curve, nominalPieces, options) {
  const cache = new Map();
  const metadataUncertaintyMm = Math.max(0, Number(curve.metadataUncertaintyMm) || 0)
    + options.nominalMetadataUncertaintyMm;
  let evaluations = 0;
  let worstInsideSample = null;
  let sideUnresolved = false;
  const evaluate = (fraction) => {
    if (cache.has(fraction)) return cache.get(fraction);
    if (evaluations >= options.maximumEvaluations) return null;
    const point = curvePointAt(curve, fraction);
    const nearest = distancePointToNominal(point, nominalPieces, options.operationBudget);
    const side = materialSideAtPoint(
      point,
      nearest,
      nominalPieces,
      options.operationBudget,
      options.numericalBudgetMm,
      options.nominalMetadataUncertaintyMm,
    );
    const signedDistanceMm = side === "inside"
      ? nearest.distance
      : (side === "outside" ? -nearest.distance : (side === "boundary" ? 0 : null));
    const sample = {fraction, point, ...nearest, side, signedDistanceMm};
    cache.set(fraction, sample);
    evaluations += 1;
    if (side === "unresolved") sideUnresolved = true;
    if (side === "inside" && (!worstInsideSample || nearest.distance > worstInsideSample.distance)) {
      worstInsideSample = sample;
    }
    return sample;
  };

  const totalLengthMm = curveLength(curve);
  const intervals = [{start: 0, end: 1}];
  let finishedLowerBoundMm = Number.NEGATIVE_INFINITY;
  let finishedUpperBoundMm = Number.NEGATIVE_INFINITY;
  let exhausted = false;
  const finishedIntervals = [];
  const finishInterval = (lower, upper, interval, samples, spanLengthMm) => {
    finishedLowerBoundMm = Math.max(finishedLowerBoundMm, lower);
    finishedUpperBoundMm = Math.max(finishedUpperBoundMm, upper);
    finishedIntervals.push({interval, samples, spanLengthMm});
  };
  while (intervals.length) {
    const interval = intervals.pop();
    const midpoint = (interval.start + interval.end) / 2;
    const first = evaluate(interval.start);
    const middle = evaluate(midpoint);
    const last = evaluate(interval.end);
    if (!first || !middle || !last) {
      exhausted = true;
      break;
    }
    if ([first, middle, last].some((sample) => sample.signedDistanceMm === null)) {
      sideUnresolved = true;
      break;
    }
    const spanLengthMm = totalLengthMm * (interval.end - interval.start);
    const halfLengthMm = spanLengthMm / 2;
    const sampledLowerMm = Math.max(first.signedDistanceMm, middle.signedDistanceMm, last.signedDistanceMm);
    const firstHalfUpperMm = Math.max(
      first.signedDistanceMm,
      middle.signedDistanceMm,
      (first.signedDistanceMm + middle.signedDistanceMm + halfLengthMm) / 2,
    );
    const secondHalfUpperMm = Math.max(
      middle.signedDistanceMm,
      last.signedDistanceMm,
      (middle.signedDistanceMm + last.signedDistanceMm + halfLengthMm) / 2,
    );
    const analyticUpperMm = analyticUnionUpperBound(
      curveSlice(curve, interval.start, interval.end),
      nominalPieces,
      options.operationBudget,
    );
    const upperMm = Math.max(
      sampledLowerMm,
      Math.min(Math.max(firstHalfUpperMm, secondHalfUpperMm), analyticUpperMm),
    );
    const provenMinimumMm = Math.min(first.signedDistanceMm, middle.signedDistanceMm, last.signedDistanceMm)
      - spanLengthMm / 4
      - (Math.max(0, Number(curve.metadataUncertaintyMm) || 0) + options.nominalMetadataUncertaintyMm);
    const needsViolationFragmentRefinement = sampledLowerMm > options.toleranceMm
      && provenMinimumMm <= options.toleranceMm
      && spanLengthMm > options.numericalBudgetMm;
    const provesNoEntryBeyondTolerance = upperMm + metadataUncertaintyMm <= options.toleranceMm;
    if (provesNoEntryBeyondTolerance || (upperMm - sampledLowerMm <= options.numericalBudgetMm + EPSILON
      && !needsViolationFragmentRefinement)) {
      finishInterval(sampledLowerMm, upperMm, interval, [first, middle, last], spanLengthMm);
      continue;
    }
    intervals.push({start: midpoint, end: interval.end}, {start: interval.start, end: midpoint});
  }

  const observedSignedMm = [...cache.values()].reduce(
    (maximum, sample) => sample.signedDistanceMm === null ? maximum : Math.max(maximum, sample.signedDistanceMm),
    Number.NEGATIVE_INFINITY,
  );
  let lowerBoundMm = Math.max(0, (Number.isFinite(finishedLowerBoundMm) ? finishedLowerBoundMm : observedSignedMm) - metadataUncertaintyMm);
  let upperBoundMm = Math.max(lowerBoundMm, (Number.isFinite(finishedUpperBoundMm) ? finishedUpperBoundMm : observedSignedMm) + metadataUncertaintyMm);
  if (exhausted || sideUnresolved || intervals.length) {
    upperBoundMm = Math.max(
      upperBoundMm,
      Math.max(0, Number.isFinite(observedSignedMm) ? observedSignedMm : 0) + totalLengthMm + metadataUncertaintyMm,
    );
  }
  const definiteIntervals = finishedIntervals
    .filter(({samples, spanLengthMm}) => (
      Math.min(...samples.map((sample) => sample.signedDistanceMm))
      - spanLengthMm / 4
      - metadataUncertaintyMm
      > options.toleranceMm
    ))
    .map(({interval}) => interval)
    .sort((left, right) => left.start - right.start);
  const mergedIntervals = [];
  for (const interval of definiteIntervals) {
    const previous = mergedIntervals.at(-1);
    if (previous && interval.start <= previous.end + EPSILON) previous.end = Math.max(previous.end, interval.end);
    else mergedIntervals.push({...interval});
  }
  const fragmentLimitExceeded = mergedIntervals.length > MAX_PROFILE_PENETRATION_FRAGMENTS;
  const violationFragments = fragmentLimitExceeded
    ? []
    : mergedIntervals.map((interval) => curveSlice(curve, interval.start, interval.end));
  return {
    lowerBoundMm,
    upperBoundMm,
    estimateMm: (lowerBoundMm + upperBoundMm) / 2,
    errorBoundMm: (upperBoundMm - lowerBoundMm) / 2,
    boundWidthMm: upperBoundMm - lowerBoundMm,
    evaluations,
    exhausted,
    sideUnresolved,
    metadataUncertaintyMm,
    worstInsideSample,
    violationFragments,
    fragmentLimitExceeded,
  };
}

function translatedCurve(curve, offset) {
  const point = p => ({z: p.z + offset.z, x: p.x + offset.x});
  return {...curve, start: point(curve.start), end: point(curve.end),
    ...(curve.center ? {center: point(curve.center)} : {})};
}

function patchReach(curve, span) {
  return curve.type === 'arc'
    ? 2 * curve.radius * Math.sin(Math.min(Math.PI, Math.abs(curve.sweep) * span / 2) / 2)
    : curveLength(curve) * span / 2;
}

// A native path translated by a native cutting edge has two parameters. Bound
// the continuous sweep with the signed-distance 1-Lipschitz property, including
// both parameter spans. No screen points or chord sampling authorize a result.
function adaptiveCutterMaterialEntry(path, edges, nominalPieces, options) {
  const metadataUncertaintyMm = path.metadataUncertaintyMm + options.nominalMetadataUncertaintyMm
    + Math.max(...edges.map(edge => edge.metadataUncertaintyMm || 0));
  // Best-bound first prevents a long harmless edge from consuming the entire
  // budget before the edge most likely to enter material is even evaluated.
  const patches = [];
  const push = patch => {
    patches.push(patch);
    let i = patches.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (patches[parent].priority >= patch.priority) break;
      patches[i] = patches[parent]; i = parent;
    }
    patches[i] = patch;
  };
  const pop = () => {
    const first = patches[0], last = patches.pop();
    if (!patches.length) return first;
    let i = 0;
    while (i * 2 + 1 < patches.length) {
      let child = i * 2 + 1;
      if (child + 1 < patches.length && patches[child + 1].priority > patches[child].priority) child += 1;
      if (patches[child].priority <= last.priority) break;
      patches[i] = patches[child]; i = child;
    }
    patches[i] = last; return first;
  };
  edges.forEach(edge => push({edge, t0: 0, t1: 1, u0: 0, u1: 1, priority: Infinity}));
  let lower = -Infinity, upper = -Infinity, evaluations = 0;
  let exhausted = false, sideUnresolved = false, worstInsideSample = null;
  const fragments = [];
  while (patches.length) {
    const patch = pop();
    const t = (patch.t0 + patch.t1) / 2, u = (patch.u0 + patch.u1) / 2;
    const offset = curvePointAt(patch.edge, u);
    const reference = curvePointAt(path, t);
    const point = {z: reference.z + offset.z, x: reference.x + offset.x};
    if (!numericallyPrecisePoint(point, options.numericalBudgetMm)) throw numericResolutionError('Cutter sweep', options.numericalBudgetMm);
    const reachT = patchReach(path, patch.t1 - patch.t0);
    const reachU = patchReach(patch.edge, patch.u1 - patch.u0);
    // Preserve already proven entry if the remaining sweep cannot be resolved
    // within the budget. Never discard a red result because a later patch ran out.
    if (evaluations >= options.maximumEvaluations
      || options.operationBudget.limit - options.operationBudget.used < nominalPieces.length * 4) {
      push(patch); exhausted = true; break;
    }
    const nearest = distancePointToNominal(point, nominalPieces, options.operationBudget);
    const side = materialSideAtPoint(point, nearest, nominalPieces, options.operationBudget,
      options.numericalBudgetMm, options.nominalMetadataUncertaintyMm);
    evaluations += 1;
    const signed = side === 'inside' ? nearest.distance : side === 'outside' ? -nearest.distance : 0;
    if (side === 'unresolved') {
      sideUnresolved = true;
      upper = Math.max(upper, nearest.distance + reachT + reachU);
      continue;
    }
    lower = Math.max(lower, signed);
    const newWitness = side === 'inside' && (!worstInsideSample || nearest.distance > worstInsideSample.distance);
    if (newWitness) {
      worstInsideSample = {fraction: t, point, ...nearest, side, signedDistanceMm: signed, cutterOffset: offset};
    }
    const sliced = curveSlice(path, patch.t0, patch.t1);
    const unsignedPathBound = analyticUnionUpperBound(translatedCurve(sliced, offset), nominalPieces, options.operationBudget);
    const sideError = side === 'boundary' ? nearest.distance : 0;
    const patchUpper = Math.min(signed + sideError + reachT + reachU, unsignedPathBound + reachU);
    if (newWitness && signed - metadataUncertaintyMm > options.toleranceMm && fragments.length < MAX_PROFILE_PENETRATION_FRAGMENTS) {
      const halfSpan = Math.min((patch.t1 - patch.t0) / 2,
        (signed - metadataUncertaintyMm - options.toleranceMm) / (2 * curveLength(path)));
      if (halfSpan > 0) fragments.push(translatedCurve(curveSlice(path, t - halfSpan, t + halfSpan), offset));
    }
    if (patchUpper + metadataUncertaintyMm <= options.toleranceMm
      || patchUpper <= lower + options.numericalBudgetMm / 2) {
      upper = Math.max(upper, patchUpper); continue;
    }
    if (reachT >= reachU) {
      push({...patch, t0: t, priority: patchUpper}); push({...patch, t1: t, priority: patchUpper});
    } else {
      push({...patch, u0: u, priority: patchUpper}); push({...patch, u1: u, priority: patchUpper});
    }
  }
  if (patches.length) {
    // The exact unsigned distance to any one boundary point is a global upper
    // bound, so unresolved work cannot accidentally narrow the reported range.
    const anchor = nominalPieces[0].start || nominalPieces[0].center;
    for (const patch of patches) {
      const p = curvePointAt(path, (patch.t0 + patch.t1) / 2);
      const e = curvePointAt(patch.edge, (patch.u0 + patch.u1) / 2);
      upper = Math.max(upper, distance({z: p.z + e.z, x: p.x + e.x}, anchor)
        + (nominalPieces[0].type === 'circle' ? nominalPieces[0].radius : 0)
        + patchReach(path, patch.t1 - patch.t0) + patchReach(patch.edge, patch.u1 - patch.u0));
    }
  }
  const lowerBoundMm = Math.max(0, (finite(lower) ? lower : 0) - metadataUncertaintyMm);
  const upperBoundMm = Math.max(lowerBoundMm, (finite(upper) ? upper : 0) + metadataUncertaintyMm);
  return {lowerBoundMm, upperBoundMm, estimateMm: (lowerBoundMm + upperBoundMm) / 2,
    errorBoundMm: (upperBoundMm - lowerBoundMm) / 2, boundWidthMm: upperBoundMm - lowerBoundMm,
    evaluations, exhausted, sideUnresolved, metadataUncertaintyMm, worstInsideSample,
    violationFragments: fragments, fragmentLimitExceeded: fragments.length >= MAX_PROFILE_PENETRATION_FRAGMENTS};
}

function materialEntryClassification(penetration, toleranceMm, numericalBudgetMm) {
  if (penetration.lowerBoundMm > toleranceMm) return "penetration";
  if (!penetration.exhausted && !penetration.sideUnresolved && penetration.upperBoundMm <= toleranceMm) {
    return penetration.lowerBoundMm > numericalBudgetMm ? "within-tolerance-entry" : "clear";
  }
  if (penetration.exhausted || penetration.sideUnresolved
    || penetration.boundWidthMm > numericalBudgetMm + EPSILON) return "unresolved";
  if (penetration.upperBoundMm > toleranceMm) return "tolerance-boundary";
  if (penetration.lowerBoundMm > numericalBudgetMm) return "within-tolerance-entry";
  if (penetration.upperBoundMm <= numericalBudgetMm) return "clear";
  return "tolerance-boundary";
}

function comparableMaterialEntrySegmentResult(segment, segmentIndex, curves, nominalPieces, options) {
  let lowerBoundMm = 0;
  let upperBoundMm = 0;
  let evaluations = 0;
  let exhausted = false;
  let sideUnresolved = false;
  let metadataUncertaintyMm = 0;
  let worst = null;
  let totalCurveLengthMm = 0;
  const violationFragments = [];
  let fragmentLimitExceeded = false;
  for (const curve of curves) {
    const result = options.cutterEdges
      ? adaptiveCutterMaterialEntry(curve, options.cutterEdges, nominalPieces, options)
      : adaptiveCurveMaterialEntry(curve, nominalPieces, options);
    lowerBoundMm = Math.max(lowerBoundMm, result.lowerBoundMm);
    upperBoundMm = Math.max(upperBoundMm, result.upperBoundMm);
    evaluations += result.evaluations;
    exhausted = exhausted || result.exhausted;
    sideUnresolved = sideUnresolved || result.sideUnresolved;
    metadataUncertaintyMm = Math.max(metadataUncertaintyMm, result.metadataUncertaintyMm);
    totalCurveLengthMm += curveLength(curve);
    fragmentLimitExceeded = fragmentLimitExceeded || result.fragmentLimitExceeded;
    if (violationFragments.length + result.violationFragments.length > MAX_PROFILE_PENETRATION_FRAGMENTS) {
      fragmentLimitExceeded = true;
    } else {
      violationFragments.push(...result.violationFragments);
    }
    if (result.worstInsideSample
      && (!worst || result.worstInsideSample.distance > worst.worstInsideSample.distance)) worst = result;
  }
  const penetration = {
    lowerBoundMm,
    upperBoundMm,
    estimateMm: (lowerBoundMm + upperBoundMm) / 2,
    errorBoundMm: (upperBoundMm - lowerBoundMm) / 2,
    boundWidthMm: upperBoundMm - lowerBoundMm,
    evaluations,
    exhausted,
    sideUnresolved,
    metadataUncertaintyMm,
  };
  return {
    segmentIndex,
    line: segment?.executionLine || segment?.line || null,
    sourceLine: segment?.sourceLine || segment?.line || null,
    executionLine: segment?.executionLine || segment?.line || segment?.sourceLine || null,
    globalBlockIndex: Number.isInteger(segment?.globalBlockIndex) ? segment.globalBlockIndex : segmentIndex,
    type: segment?.type || null,
    sourceMotion: segment?.sourceMotion || segment?.type || null,
    classification: materialEntryClassification(penetration, options.toleranceMm, options.numericalBudgetMm),
    comparable: true,
    cuttingBasis: options.cutterEdges ? 'nominal-cutting-edge' : 'program-reference-point',
    curveLengthMm: totalCurveLengthMm,
    penetration,
    worstPoint: worst?.worstInsideSample ? {...worst.worstInsideSample.point} : null,
    nearestNominal: worst?.worstInsideSample ? {
      entityIndex: worst.worstInsideSample.piece.entityIndex,
      pieceIndex: worst.worstInsideSample.piece.pieceIndex,
      id: worst.worstInsideSample.piece.id,
      type: worst.worstInsideSample.piece.type,
      point: {...worst.worstInsideSample.nearestPoint},
      sampledDistanceMm: worst.worstInsideSample.distance,
    } : null,
    violationFragments: fragmentLimitExceeded ? [] : violationFragments,
    fragmentLimitExceeded,
  };
}

function aggregateMaterialEntryResults(segmentResults, toleranceMm) {
  const comparable = segmentResults.filter((result) => result.comparable && result.penetration);
  const classifications = ["clear", "within-tolerance-entry", "penetration", "tolerance-boundary", "unresolved", "excluded", "unsupported", "not-calculated"];
  const counts = Object.fromEntries(classifications.map((classification) => [
    classification,
    segmentResults.filter((result) => result.classification === classification).length,
  ]));
  let lowerBoundMm = null;
  let upperBoundMm = null;
  let worstSegmentIndex = null;
  let analyticRemainderUnresolved = false;
  let fragmentLimitExceeded = false;
  for (const result of comparable) {
    analyticRemainderUnresolved = analyticRemainderUnresolved
      || result.penetration.exhausted
      || result.penetration.sideUnresolved;
    fragmentLimitExceeded = fragmentLimitExceeded || result.fragmentLimitExceeded;
    if (lowerBoundMm === null || result.penetration.lowerBoundMm > lowerBoundMm) {
      lowerBoundMm = result.penetration.lowerBoundMm;
      worstSegmentIndex = result.segmentIndex;
    }
    upperBoundMm = upperBoundMm === null
      ? result.penetration.upperBoundMm
      : Math.max(upperBoundMm, result.penetration.upperBoundMm);
  }
  let classification = "no-comparable-segments";
  if (counts.penetration) classification = "penetration";
  else if (counts["not-calculated"]) classification = "calculation-incomplete";
  else if (counts.unsupported || counts.unresolved) classification = "unresolved";
  else if (counts["tolerance-boundary"]) classification = "tolerance-boundary";
  else if (counts["within-tolerance-entry"]) classification = "within-tolerance-entry";
  else if (comparable.length && upperBoundMm <= toleranceMm) classification = "clear";
  return {
    classification,
    complete: comparable.length > 0
      && !counts.unsupported
      && !counts.unresolved
      && !counts["not-calculated"]
      && !counts["tolerance-boundary"]
      && !analyticRemainderUnresolved,
    violationOverlayComplete: !fragmentLimitExceeded,
    comparableSegments: comparable.length,
    totalSegments: segmentResults.length,
    counts,
    worstSegmentIndex,
    maximumPenetration: comparable.length ? {
      lowerBoundMm,
      upperBoundMm,
      estimateMm: (lowerBoundMm + upperBoundMm) / 2,
      errorBoundMm: (upperBoundMm - lowerBoundMm) / 2,
      boundWidthMm: upperBoundMm - lowerBoundMm,
    } : null,
  };
}

/**
 * Bound signed program-reference-point entry into one explicitly qualified
 * material region. This deliberately does not apply a cutter envelope or tool
 * compensation and therefore reports overcut risk, not a certified gouge.
 */
export function compareProgramProfileMaterialEntry(programSegments, nominalGeometry, {
  programXScale,
  toleranceMm = DEFAULT_PROFILE_TOLERANCE_MM,
  numericalBudgetMm = DEFAULT_PROFILE_NUMERICAL_BUDGET_MM,
  includeRapid = false,
  programVerificationBlocked = false,
  maximumEvaluations = MAX_PROFILE_EVALUATIONS_PER_CURVE,
  maximumComparisonOperations = MAX_PROFILE_COMPARISON_OPERATIONS,
  cutterResolver = null,
} = {}) {
  if (!Array.isArray(programSegments)) throw new TypeError("Program segments must be an array.");
  if (programSegments.length > MAX_PROFILE_PROGRAM_SEGMENTS) {
    throw new RangeError(`Signed profile check blocked: program exceeds the ${MAX_PROFILE_PROGRAM_SEGMENTS}-segment limit.`);
  }
  if (programXScale !== 0.5 && programXScale !== 1) {
    throw new TypeError("programXScale is required and must be exactly 0.5 for diameter mode or 1 for radius mode.");
  }
  if (typeof includeRapid !== "boolean" || typeof programVerificationBlocked !== "boolean") {
    throw new TypeError("includeRapid and programVerificationBlocked must be booleans.");
  }
  if (!finite(toleranceMm) || toleranceMm < 0) throw new RangeError("toleranceMm must be a finite nonnegative canonical-millimetre value.");
  if (!finite(numericalBudgetMm) || numericalBudgetMm <= 0 || numericalBudgetMm > MAX_PROFILE_NUMERICAL_BUDGET_MM) {
    throw new RangeError(`numericalBudgetMm must be positive and no greater than ${MAX_PROFILE_NUMERICAL_BUDGET_MM} mm.`);
  }
  if (!Number.isInteger(maximumEvaluations) || maximumEvaluations < 3 || maximumEvaluations > MAX_PROFILE_EVALUATIONS_PER_CURVE) {
    throw new RangeError(`maximumEvaluations must be an integer from 3 through ${MAX_PROFILE_EVALUATIONS_PER_CURVE}.`);
  }
  if (!Number.isInteger(maximumComparisonOperations)
    || maximumComparisonOperations < 1
    || maximumComparisonOperations > MAX_PROFILE_COMPARISON_OPERATIONS) {
    throw new RangeError(`maximumComparisonOperations must be an integer from 1 through ${MAX_PROFILE_COMPARISON_OPERATIONS}.`);
  }
  const qualification = qualifyMaterialRegion(nominalGeometry, numericalBudgetMm);
  if (!qualification.authorized) {
    return {
      scope: PROFILE_MATERIAL_ENTRY_SCOPE,
      available: false,
      reason: qualification.reason,
      toleranceMm,
      numericalBudgetMm,
      programXScale,
      maximumComparisonOperations,
      comparisonOperations: 0,
      segmentResults: [],
      aggregate: {
        classification: "not-qualified",
        complete: false,
        comparableSegments: 0,
        totalSegments: programSegments.length,
        counts: {},
        worstSegmentIndex: null,
        maximumPenetration: null,
      },
    };
  }
  const nominal = qualification.nominal;

  const operationBudget = {limit: maximumComparisonOperations, used: 0};
  const options = {
    toleranceMm,
    numericalBudgetMm,
    maximumEvaluations,
    operationBudget,
    nominalMetadataUncertaintyMm: nominal.metadataUncertaintyMm,
  };
  const preparedSegments = [];
  let comparableCurveCount = 0;
  let programSourcePointCount = 0;
  for (let segmentIndex = 0; segmentIndex < programSegments.length; segmentIndex += 1) {
    const segment = programSegments[segmentIndex];
    const sourcePointCount = Array.isArray(segment?.points) ? segment.points.length : 0;
    if (sourcePointCount > MAX_PROFILE_PROGRAM_SOURCE_POINTS - programSourcePointCount) {
      throw new RangeError(`Signed profile check blocked: program motion exceeds the ${MAX_PROFILE_PROGRAM_SOURCE_POINTS}-source-point limit.`);
    }
    programSourcePointCount += sourcePointCount;
    if (segment?.verificationBlocked || segment?.liveToolBlocked) {
      preparedSegments.push({result: excludedSegmentResult(segment, segmentIndex, "unsupported", "Verification-blocked motion cannot support signed material-entry classification.")});
      continue;
    }
    const rapid = segment?.type === "rapid" || segment?.type === "live-rapid";
    if (rapid && !includeRapid) {
      preparedSegments.push({result: excludedSegmentResult(segment, segmentIndex, "excluded", "Rapid motion is excluded from signed material-entry classification.")});
      continue;
    }
    if (!segmentIsPlanarTurning(segment)) {
      preparedSegments.push({result: excludedSegmentResult(segment, segmentIndex, "unsupported", "Only planar turning X/Z motion can use this signed material-region check.")});
      continue;
    }
    const motion = programMotionKind(segment);
    const curves = motion ? normalizedProgramCurves(segment, programXScale, motion, numericalBudgetMm) : [];
    if (!motion || !curves.length) {
      preparedSegments.push({result: excludedSegmentResult(segment, segmentIndex, "unsupported", "The motion lacks supported exact line/arc geometry for signed material-entry classification.")});
      continue;
    }
    comparableCurveCount += curves.length;
    if (comparableCurveCount > MAX_PROFILE_PROGRAM_CURVES) {
      throw new RangeError(`Signed profile check blocked: normalized motion exceeds the ${MAX_PROFILE_PROGRAM_CURVES}-curve limit.`);
    }
    // The irreducible first interval needs three new samples. Each sample
    // performs one nearest-boundary pass plus two shifted parity rays (9N),
    // followed by one analytic upper-bound pass (N).
    const minimumOperations = comparableCurveCount * nominal.pieces.length * 10;
    if (minimumOperations > maximumComparisonOperations) {
      throw minimumComparisonBudgetError(
        `Signed profile check blocked: the minimum workload is ${minimumOperations.toLocaleString()} analytic operations, `
        + `which exceeds the remaining ${maximumComparisonOperations.toLocaleString()}-operation budget.`,
        maximumComparisonOperations,
        minimumOperations,
        "minimum signed-material workload",
      );
    }
    const cutter = cutterResolver ? cutterResolver(segment) : null;
    if (cutter?.blocked) {
      preparedSegments.push({result: excludedSegmentResult(segment, segmentIndex, 'unsupported', cutter.reason)});
      continue;
    }
    let cutterEdges = null;
    if (cutter?.edges) {
      if (!Array.isArray(cutter.edges) || !cutter.edges.length || cutter.edges.length > 16) {
        throw new TypeError('A nominal cutting edge requires 1–16 native line/arc curves.');
      }
      cutterEdges = normalizeNominalGeometry({authorized: true, primitives: cutter.edges}, numericalBudgetMm).pieces;
      if (cutterEdges.some(edge => !['line', 'arc'].includes(edge.type))) throw new TypeError('Unsupported nominal cutting-edge geometry.');
    }
    preparedSegments.push({segment, segmentIndex, curves, cutterEdges});
  }
  if (programVerificationBlocked) {
    preparedSegments.push({
      result: excludedSegmentResult(
        {type: "parser-diagnostic"},
        programSegments.length,
        "unsupported",
        "Verification-blocking parser diagnostics prevent signed material-entry classification.",
      ),
    });
  }
  const segmentResults = [];
  let calculationIncomplete = null;
  for (let preparedIndex = 0; preparedIndex < preparedSegments.length; preparedIndex += 1) {
    const prepared = preparedSegments[preparedIndex];
    if (prepared.result) {
      segmentResults.push(prepared.result);
      continue;
    }
    try {
      segmentResults.push(comparableMaterialEntrySegmentResult(prepared.segment, prepared.segmentIndex,
        prepared.curves, nominal.pieces, {...options, cutterEdges: prepared.cutterEdges}));
    } catch (error) {
      if (!isProfileComparisonWorkloadError(error)) throw error;
      calculationIncomplete = {
        code: PROFILE_COMPARISON_WORKLOAD_EXHAUSTED,
        operationLimit: error.operationLimit,
        operationsUsed: error.operationsUsed,
        operationsRequested: error.operationsRequested,
        operationContext: error.operationContext,
      };
      for (let remainingIndex = preparedIndex; remainingIndex < preparedSegments.length; remainingIndex += 1) {
        const remaining = preparedSegments[remainingIndex];
        segmentResults.push(remaining.result || excludedSegmentResult(
          remaining.segment,
          remaining.segmentIndex,
          "not-calculated",
          "Not calculated because the local comparison workload limit was reached.",
        ));
      }
      break;
    }
  }
  return {
    scope: segmentResults.some(result => result.cuttingBasis === 'nominal-cutting-edge')
      ? PROFILE_CUTTER_ENTRY_SCOPE : PROFILE_MATERIAL_ENTRY_SCOPE,
    available: true,
    reason: null,
    toleranceMm,
    numericalBudgetMm,
    programXScale,
    nominalEntityCount: nominal.entities.length,
    nominalPieceCount: nominal.pieces.length,
    nominalMetadataUncertaintyMm: nominal.metadataUncertaintyMm,
    maximumComparisonOperations,
    comparisonOperations: operationBudget.used,
    calculationIncomplete,
    cutterAware: segmentResults.some(result => result.cuttingBasis === 'nominal-cutting-edge'),
    cutterCoverageComplete: segmentResults.filter(result => result.classification !== 'excluded')
      .every(result => result.cuttingBasis === 'nominal-cutting-edge'),
    segmentResults,
    aggregate: aggregateMaterialEntryResults(segmentResults, toleranceMm),
  };
}

export const compareProfileGeometry = compareProgramProfileToNominal;
