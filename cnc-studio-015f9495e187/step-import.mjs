const TAU = Math.PI * 2;
const AXES = Object.freeze(["x", "y", "z"]);
const BLOCKING_DIAGNOSTIC_SEVERITIES = new Set(["error", "warning"]);
const ROUNDING_ULPS = 512;
const TRIG_ROUNDING_ULPS = 128;
const MATERIAL_REGION_QUALIFICATION = "step-single-solid-single-contour-positive-radius-v1";
const MAX_MATERIAL_REGION_INTERSECTION_TESTS = 250000;

/** One tenth of the default 0.0005 in profile-comparison threshold. */
export const STEP_NUMERICAL_BUDGET_MM = 0.00127;

/** Hard ceilings. Callers may lower, but never raise, these limits. */
export const STEP_IMPORT_LIMITS = Object.freeze({
  maxSourceBytes: 25 * 1024 * 1024,
  maxContours: 1024,
  maxEdgesPerContour: 50000,
  maxTotalEdges: 100000,
  maxDiagnostics: 1000,
  maxStringLength: 512,
});

const UNIT_FACTORS_MM = new Map([
  ["millimeter", 1], ["millimeters", 1], ["millimetre", 1], ["millimetres", 1], ["mm", 1],
  ["centimeter", 10], ["centimeters", 10], ["centimetre", 10], ["centimetres", 10], ["cm", 10],
  ["meter", 1000], ["meters", 1000], ["metre", 1000], ["metres", 1000], ["m", 1000],
  ["micrometer", 0.001], ["micrometers", 0.001], ["micrometre", 0.001], ["micrometres", 0.001], ["um", 0.001],
  ["inch", 25.4], ["inches", 25.4], ["in", 25.4],
  ["foot", 304.8], ["feet", 304.8], ["ft", 304.8],
]);

function boundedLimits(overrides = {}) {
  return Object.fromEntries(Object.entries(STEP_IMPORT_LIMITS).map(([name, ceiling]) => {
    const requested = Number(overrides?.[name]);
    return [name, Number.isInteger(requested) && requested > 0 ? Math.min(requested, ceiling) : ceiling];
  }));
}

function diagnosticCollector(maxDiagnostics) {
  const diagnostics = [];
  let suppressed = 0;
  let limitReported = false;
  return {
    diagnostics,
    get suppressed() { return suppressed; },
    add(severity, code, message, details = {}) {
      const normalizedSeverity = ["error", "warning", "info"].includes(severity) ? severity : "error";
      if (diagnostics.length < maxDiagnostics - 1) {
        diagnostics.push({severity: normalizedSeverity, code, message, ...details});
        return;
      }
      suppressed += 1;
      if (!limitReported) {
        diagnostics.push({
          severity: "error",
          code: "diagnostic-limit-exceeded",
          message: `STEP section analysis exceeded the ${maxDiagnostics}-diagnostic safety limit.`,
        });
        limitReported = true;
      }
    },
  };
}

function diagnosticSummary(diagnostics, suppressed = 0) {
  return {
    errors: diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
    warnings: diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length,
    info: diagnostics.filter((diagnostic) => diagnostic.severity === "info").length,
    suppressed,
  };
}

function finite(value) {
  return Number.isFinite(value);
}

function finitePoint3(point) {
  return point && AXES.every((axis) => finite(point[axis]));
}

function finitePoint2(point) {
  return point && finite(point.z) && finite(point.x);
}

function vector(a, b) {
  return {x: b.x - a.x, y: b.y - a.y, z: b.z - a.z};
}

function addVector(point, candidate) {
  return {x: point.x + candidate.x, y: point.y + candidate.y, z: point.z + candidate.z};
}

function scaleVector(candidate, scale) {
  return {x: candidate.x * scale, y: candidate.y * scale, z: candidate.z * scale};
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function magnitude(candidate) {
  return Math.hypot(candidate.x, candidate.y, candidate.z);
}

function distance3(a, b) {
  return magnitude(vector(a, b));
}

function distance2(a, b) {
  return Math.hypot(b.z - a.z, b.x - a.x);
}

function unitAxis(axis, direction = 1) {
  return {
    x: axis === "x" ? direction : 0,
    y: axis === "y" ? direction : 0,
    z: axis === "z" ? direction : 0,
  };
}

function normalizedVector(candidate) {
  if (!finitePoint3(candidate)) return null;
  const length = magnitude(candidate);
  if (!finite(length) || length === 0) return null;
  return {vector: scaleVector(candidate, 1 / length), length};
}

function roundingBound(values, ulps = ROUNDING_ULPS) {
  const magnitudeValue = Math.max(1, ...values.filter(finite).map(Math.abs));
  const result = magnitudeValue * Number.EPSILON * ulps;
  return finite(result) ? result : Number.POSITIVE_INFINITY;
}

function pointValues(point) {
  return finitePoint3(point) ? [point.x, point.y, point.z] : [];
}

function printableString(value, maximumLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function axisRemaining(first, second) {
  return AXES.find((axis) => axis !== first && axis !== second) ?? null;
}

function contourKey(value) {
  return `${typeof value}:${String(value)}`;
}

function validContourId(value, maximumLength) {
  return (typeof value === "string" && printableString(value, maximumLength))
    || (Number.isSafeInteger(value) && value >= 0);
}

function validateSource(dto, limits, state) {
  const source = dto?.source;
  if (!source || typeof source !== "object") {
    state.add("error", "source-metadata-required", "STEP worker output must include source metadata.");
    return null;
  }
  if (!printableString(source.name, limits.maxStringLength)) {
    state.add("error", "source-name-invalid", "STEP source name is missing, contains control characters, or exceeds the safety limit.");
  }
  const sourceHash = source.sha256 ?? source.hash;
  if (typeof sourceHash !== "string" || !/^[0-9a-f]{64}$/i.test(sourceHash)) {
    state.add("error", "source-hash-invalid", "STEP source metadata must contain an exact SHA-256 hash.");
  }
  const byteLength = source.byteLength ?? source.sizeBytes;
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
    state.add("error", "source-byte-length-invalid", "STEP source byte length must be a positive safe integer.");
  } else if (byteLength > limits.maxSourceBytes) {
    state.add("error", "source-byte-limit-exceeded", `STEP source exceeds the ${limits.maxSourceBytes}-byte safety limit.`);
  }
  return {
    name: source.name ?? null,
    sha256: sourceHash ?? null,
    byteLength: Number.isSafeInteger(byteLength) ? byteLength : null,
  };
}

function unitFactorFrom(value, state, codePrefix) {
  if (typeof value === "string") {
    const name = value.trim().toLowerCase();
    const factor = UNIT_FACTORS_MM.get(name);
    if (!factor) state.add("error", `${codePrefix}-unsupported`, `Unsupported ${codePrefix.replaceAll("-", " ")} '${value}'.`);
    return factor ? {name, millimetersPerUnit: factor} : null;
  }
  if (!value || typeof value !== "object") {
    state.add("error", `${codePrefix}-required`, `${codePrefix.replaceAll("-", " ")} are required and must be resolved explicitly.`);
    return null;
  }
  if (value.conflict === true || value.conflicting === true || value.hasConflict === true) {
    state.add("error", `${codePrefix}-conflict`, `${codePrefix.replaceAll("-", " ")} contain conflicting declarations.`);
    return null;
  }
  if (value.resolved === false || ["missing", "unknown", "invalid", "conflict", "unitless"].includes(String(value.status ?? "").toLowerCase())) {
    state.add("error", `${codePrefix}-unresolved`, `${codePrefix.replaceAll("-", " ")} are not resolved to a physical unit.`);
    return null;
  }
  const name = String(value.name ?? value.symbol ?? "").trim().toLowerCase();
  const declaredFactor = Number(value.millimetersPerUnit);
  const knownFactor = UNIT_FACTORS_MM.get(name);
  if (!knownFactor || !finite(declaredFactor) || declaredFactor <= 0) {
    state.add("error", `${codePrefix}-unsupported`, `${codePrefix.replaceAll("-", " ")} must name a supported unit and its millimetre scale.`);
    return null;
  }
  const factorDifference = Math.abs(declaredFactor - knownFactor);
  const factorRoundoff = roundingBound([declaredFactor, knownFactor], 8);
  if (factorDifference > factorRoundoff) {
    state.add("error", `${codePrefix}-conflict`, `${codePrefix.replaceAll("-", " ")} name and millimetre scale conflict.`);
    return null;
  }
  if (Array.isArray(value.declarations)) {
    if (value.declarations.length > 32) {
      state.add("error", `${codePrefix}-declaration-limit-exceeded`, `${codePrefix.replaceAll("-", " ")} contain too many declarations to reconcile safely.`);
      return null;
    }
    for (const declaration of value.declarations) {
      const candidate = Number(declaration?.millimetersPerUnit);
      if (!finite(candidate) || candidate <= 0 || Math.abs(candidate - declaredFactor) > roundingBound([candidate, declaredFactor], 8)) {
        state.add("error", `${codePrefix}-conflict`, `${codePrefix.replaceAll("-", " ")} contain conflicting declarations.`);
        return null;
      }
    }
  }
  return {name, millimetersPerUnit: knownFactor, status: value.status ?? "resolved"};
}

function validateUnits(dto, state) {
  const sourceUnits = unitFactorFrom(dto?.sourceUnits, state, "source-units");
  const coordinateUnitsValue = dto?.coordinateUnits ?? dto?.coordinates?.units ?? dto?.lengthUnit;
  const coordinateUnits = unitFactorFrom(coordinateUnitsValue, state, "coordinate-units");
  if (coordinateUnits && coordinateUnits.millimetersPerUnit !== 1) {
    state.add(
      "error",
      "coordinate-units-not-millimeters",
      "STEP worker section coordinates and all reported tolerances must be normalized to millimetres.",
    );
  }
  return {sourceUnits, coordinateUnits};
}

function validateKernel(kernel, limits, state) {
  if (!kernel || typeof kernel !== "object") {
    state.add("error", "kernel-metadata-required", "STEP worker output must identify the geometry kernel and exact build.");
    return null;
  }
  for (const field of ["name", "version", "buildHash"]) {
    if (!printableString(kernel[field], limits.maxStringLength)) {
      state.add("error", `kernel-${field.toLowerCase()}-invalid`, `STEP kernel ${field} is missing or invalid.`);
    }
  }
  return {name: kernel.name ?? null, version: kernel.version ?? null, buildHash: kernel.buildHash ?? null};
}

function toleranceMaximum(container, label, state, {required = true} = {}) {
  if (!container || typeof container !== "object") {
    if (required) state.add("error", `${label}-required`, `${label.replaceAll("-", " ")} metadata are required.`);
    return 0;
  }
  const values = [];
  if (Object.hasOwn(container, "maxToleranceMm")) values.push(container.maxToleranceMm);
  if (container.toleranceMaximaMm && typeof container.toleranceMaximaMm === "object") {
    const componentValues = Object.values(container.toleranceMaximaMm);
    if (componentValues.length > 32) {
      state.add("error", `${label}-tolerance-limit-exceeded`, `${label.replaceAll("-", " ")} reports too many tolerance components.`);
      return Number.POSITIVE_INFINITY;
    }
    values.push(...componentValues);
  }
  if (!values.length) {
    if (required) state.add("error", `${label}-tolerance-required`, `${label.replaceAll("-", " ")} must report a maximum tolerance in millimetres.`);
    return 0;
  }
  if (values.some((value) => !finite(value) || value < 0)) {
    state.add("error", `${label}-tolerance-invalid`, `${label.replaceAll("-", " ")} tolerance maxima must be finite nonnegative millimetre values.`);
    return Number.POSITIVE_INFINITY;
  }
  const reportedMaximum = Object.hasOwn(container, "maxToleranceMm") ? container.maxToleranceMm : null;
  const actualMaximum = Math.max(...values);
  if (reportedMaximum !== null && actualMaximum > reportedMaximum) {
    state.add("error", `${label}-tolerance-conflict`, `${label.replaceAll("-", " ")} maxToleranceMm understates a reported component tolerance.`);
  }
  return actualMaximum;
}

function ingestDiagnostics(container, label, limits, state, {required = false} = {}) {
  if (!container || typeof container !== "object") return;
  if (required && !Array.isArray(container.diagnostics)) {
    state.add("error", `${label}-diagnostics-required`, `${label.replaceAll("-", " ")} diagnostics must be present as an array, even when empty.`);
  }
  const diagnostics = Array.isArray(container.diagnostics) ? container.diagnostics : [];
  if (diagnostics.length > limits.maxDiagnostics) {
    state.add("error", `${label}-diagnostic-limit-exceeded`, `${label.replaceAll("-", " ")} diagnostics exceed the ${limits.maxDiagnostics}-item safety limit.`);
  }
  for (const diagnostic of diagnostics.slice(0, limits.maxDiagnostics)) {
    if (!diagnostic || typeof diagnostic !== "object") {
      state.add("error", `${label}-diagnostic-invalid`, `${label.replaceAll("-", " ")} contains a malformed diagnostic.`);
      continue;
    }
    const severity = String(diagnostic.severity ?? "").toLowerCase();
    if (!["error", "warning", "info"].includes(severity)) {
      state.add("error", `${label}-diagnostic-severity-invalid`, `${label.replaceAll("-", " ")} contains a diagnostic with an unknown severity.`);
      continue;
    }
    state.add(
      severity,
      printableString(diagnostic.code, limits.maxStringLength) ? diagnostic.code : `${label}-diagnostic`,
      printableString(diagnostic.message, limits.maxStringLength) ? diagnostic.message : `${label.replaceAll("-", " ")} reported a diagnostic.`,
      {source: label},
    );
  }
  for (const severity of ["error", "warning"]) {
    const plural = `${severity}s`;
    if (container[plural] !== undefined && !Array.isArray(container[plural])) {
      state.add("error", `${label}-${plural}-invalid`, `${label.replaceAll("-", " ")} ${plural} must be an array.`);
      continue;
    }
    for (const message of (container[plural] ?? []).slice(0, limits.maxDiagnostics)) {
      state.add(severity, `${label}-${severity}`, String(message || `${label.replaceAll("-", " ")} reported a ${severity}.`), {source: label});
    }
  }
}

function validateMapping(mapping, limits, state) {
  if (!mapping || typeof mapping !== "object") {
    state.add("error", "mapping-required", "An explicit STEP-to-lathe axis and origin mapping is required.");
    return null;
  }
  const axialAxis = String(mapping.axialAxis ?? "").toLowerCase();
  const radialAxis = String(mapping.radialAxis ?? "").toLowerCase();
  if (!AXES.includes(axialAxis) || !AXES.includes(radialAxis) || axialAxis === radialAxis) {
    state.add("error", "mapping-axes-invalid", "Axial and radial axes must be distinct explicit x, y, or z axes.");
  }
  const planeAxis = axisRemaining(axialAxis, radialAxis);
  for (const field of ["planeOffsetMm", "axialOriginMm", "radialOriginMm"]) {
    if (!finite(mapping[field])) state.add("error", `mapping-${field.toLowerCase()}-invalid`, `${field} must be a finite millimetre value.`);
  }
  for (const field of ["axialDirection", "radialDirection"]) {
    if (mapping[field] !== 1 && mapping[field] !== -1) state.add("error", `mapping-${field.toLowerCase()}-invalid`, `${field} must be exactly 1 or -1.`);
  }
  if (!validContourId(mapping.selectedContourId, limits.maxStringLength)) {
    state.add("error", "selected-contour-required", "An explicit selectedContourId is required, even when the section contains one contour.");
  }
  const profileSide = mapping.profileSide === undefined ? null : mapping.profileSide;
  if (profileSide !== null && profileSide !== "positive") {
    state.add("error", "mapping-profile-side-invalid", "STEP lathe-profile extraction supports only the explicitly mapped physical positive-radius side.");
  }
  return {
    axialAxis,
    radialAxis,
    planeAxis,
    planeOffsetMm: mapping.planeOffsetMm,
    axialOriginMm: mapping.axialOriginMm,
    radialOriginMm: mapping.radialOriginMm,
    axialDirection: mapping.axialDirection,
    radialDirection: mapping.radialDirection,
    selectedContourId: mapping.selectedContourId,
    profileSide,
  };
}

function failedResult(dto, source, kernel, units, mapping, diagnostics, suppressed, complexity = null) {
  return {
    schemaVersion: 1,
    format: "step-section",
    coordinateSystem: "lathe-xz",
    source,
    sourceModel: dto && typeof dto === "object" ? dto : null,
    kernel,
    units: {
      source: units?.sourceUnits ?? null,
      coordinates: units?.coordinateUnits ?? null,
      target: {name: "millimeter", symbol: "mm", millimetersPerUnit: 1},
    },
    transform: mapping,
    selectedContourId: mapping?.selectedContourId ?? null,
    entities: [],
    primitives: [],
    geometry: [],
    bounds: null,
    geometryUncertaintyMm: null,
    diagnostics,
    diagnosticSummary: diagnosticSummary(diagnostics, suppressed),
    complexity,
    authorized: false,
  };
}

function mapPoint(point, mapping) {
  return {
    z: (point[mapping.axialAxis] - mapping.axialOriginMm) * mapping.axialDirection,
    x: (point[mapping.radialAxis] - mapping.radialOriginMm) * mapping.radialDirection,
  };
}

function rodrigues(candidate, normal, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return addVector(
    addVector(scaleVector(candidate, cosine), scaleVector(cross(normal, candidate), sine)),
    scaleVector(normal, dot(normal, candidate) * (1 - cosine)),
  );
}

function edgeTolerance(edge, state, context) {
  if (edge?.maxToleranceMm === undefined && edge?.toleranceMm === undefined && edge?.toleranceMaximaMm === undefined) return 0;
  const normalized = {
    ...edge,
    ...(edge.maxToleranceMm === undefined && edge.toleranceMm !== undefined ? {maxToleranceMm: edge.toleranceMm} : {}),
  };
  return toleranceMaximum(normalized, `${context}-edge`, state, {required: false});
}

function definingPointRoundoff(points, mapping, radius = 0, sweep = 0) {
  const values = points.flatMap(pointValues);
  values.push(
    mapping.planeOffsetMm,
    mapping.axialOriginMm,
    mapping.radialOriginMm,
    radius,
    Math.abs(sweep) * radius,
  );
  return roundingBound(values);
}

function planarityResidual(points, mapping) {
  return Math.max(0, ...points.map((point) => Math.abs(point[mapping.planeAxis] - mapping.planeOffsetMm)));
}

function edgeSource(edge, contourId, edgeIndex) {
  return {
    format: "step",
    contourId,
    edgeId: edge.id ?? edgeIndex,
    edgeIndex,
    curveType: edge.curveType,
  };
}

function processLine(edge, edgeIndex, contourId, mapping, baseToleranceMm, state) {
  const context = `contour-${String(contourId)}-edge-${edgeIndex}`;
  if (!finitePoint3(edge.start) || !finitePoint3(edge.end)) {
    state.add("error", "line-points-invalid", `STEP ${context} line requires finite 3D start and end points.`);
    return null;
  }
  const toleranceMm = edgeTolerance(edge, state, context);
  const roundoffMm = definingPointRoundoff([edge.start, edge.end], mapping);
  const planarityMm = planarityResidual([edge.start, edge.end], mapping);
  const allowedMm = baseToleranceMm + toleranceMm + roundoffMm;
  if (planarityMm > allowedMm) {
    state.add("error", "section-edge-nonplanar", `STEP ${context} line is not on the requested section plane.`);
  }
  const lengthMm = distance3(edge.start, edge.end);
  if (!finite(lengthMm) || lengthMm <= allowedMm) {
    state.add("error", "section-line-degenerate", `STEP ${context} line is degenerate within the reported tolerance envelope.`);
  }
  const start = mapPoint(edge.start, mapping);
  const end = mapPoint(edge.end, mapping);
  if (!finitePoint2(start) || !finitePoint2(end)) {
    state.add("error", "mapped-geometry-non-finite", `STEP ${context} line cannot be represented as finite lathe geometry.`);
  }
  return {
    primitive: {
      id: edge.id ?? `${String(contourId)}:${edgeIndex}`,
      type: "line",
      start,
      end,
      source: edgeSource(edge, contourId, edgeIndex),
      geometryUncertaintyMm: baseToleranceMm + toleranceMm + roundoffMm + planarityMm,
    },
    nativeStart: edge.start,
    nativeEnd: edge.end,
    toleranceMm,
    roundoffMm,
  };
}

function processCircle(edge, edgeIndex, contourId, mapping, baseToleranceMm, state) {
  const context = `contour-${String(contourId)}-edge-${edgeIndex}`;
  const fullCircle = edge.fullCircle === true;
  const points = [edge.center, ...(fullCircle ? [] : [edge.start, edge.end])];
  if (!finitePoint3(edge.center)
    || (!fullCircle && (!finitePoint3(edge.start) || !finitePoint3(edge.end)))
    || !finite(edge.radiusMm)
    || edge.radiusMm <= 0
    || !finite(edge.sweepRadians)) {
    state.add("error", "circle-geometry-invalid", `STEP ${context} circle requires finite analytic center, radius, sweep, and arc endpoints.`);
    return null;
  }
  const normalizedNormal = normalizedVector(edge.normal);
  if (!normalizedNormal) {
    state.add("error", "circle-normal-invalid", `STEP ${context} circle requires a finite nonzero plane normal.`);
    return null;
  }
  const toleranceMm = edgeTolerance(edge, state, context);
  const roundoffMm = definingPointRoundoff(points, mapping, edge.radiusMm, edge.sweepRadians)
    + Math.abs(edge.radiusMm) * Number.EPSILON * TRIG_ROUNDING_ULPS;
  const allowedMm = baseToleranceMm + toleranceMm + roundoffMm;
  if (edge.radiusMm <= allowedMm) {
    state.add("error", "section-circle-degenerate", `STEP ${context} circle radius is not larger than its reported tolerance envelope.`);
  }
  const planeNormal = unitAxis(mapping.planeAxis);
  const normalAlignment = Math.abs(dot(normalizedNormal.vector, planeNormal));
  const normalResidualMm = edge.radiusMm * Math.sqrt(Math.max(0, 1 - Math.min(1, normalAlignment ** 2)));
  if (normalResidualMm > allowedMm) {
    state.add("error", "circle-plane-mismatch", `STEP ${context} circle plane is not parallel to the requested section plane.`);
  }
  const planarityMm = planarityResidual(points, mapping);
  if (planarityMm > allowedMm) {
    state.add("error", "section-edge-nonplanar", `STEP ${context} circle is not on the requested section plane.`);
  }

  const absoluteSweep = Math.abs(edge.sweepRadians);
  const angularAllowance = Math.min(Math.PI, allowedMm / edge.radiusMm + Number.EPSILON * TRIG_ROUNDING_ULPS);
  if (fullCircle) {
    if (Math.abs(absoluteSweep - TAU) > angularAllowance) {
      state.add("error", "full-circle-sweep-invalid", `STEP ${context} full circle must report one exact 2π traversal.`);
    }
  } else if (!(absoluteSweep > angularAllowance && absoluteSweep < TAU - angularAllowance)) {
    state.add("error", "arc-sweep-invalid", `STEP ${context} arc sweep must be nonzero and strictly less than one revolution.`);
  }

  let analyticResidualMm = 0;
  if (!fullCircle) {
    const startRadiusVector = vector(edge.center, edge.start);
    const endRadiusVector = vector(edge.center, edge.end);
    const startRadiusResidual = Math.abs(magnitude(startRadiusVector) - edge.radiusMm);
    const endRadiusResidual = Math.abs(magnitude(endRadiusVector) - edge.radiusMm);
    const startNormalResidual = Math.abs(dot(startRadiusVector, normalizedNormal.vector));
    const endNormalResidual = Math.abs(dot(endRadiusVector, normalizedNormal.vector));
    const predictedEnd = addVector(edge.center, rodrigues(startRadiusVector, normalizedNormal.vector, edge.sweepRadians));
    const endpointResidual = distance3(predictedEnd, edge.end);
    analyticResidualMm = Math.max(
      startRadiusResidual,
      endRadiusResidual,
      startNormalResidual,
      endNormalResidual,
      endpointResidual,
    );
    if (analyticResidualMm > allowedMm) {
      state.add("error", "circle-analytic-inconsistent", `STEP ${context} circle endpoints do not agree with its analytic radius, normal, and sweep.`);
    }
  }

  const center = mapPoint(edge.center, mapping);
  if (!finitePoint2(center)) {
    state.add("error", "mapped-geometry-non-finite", `STEP ${context} circle cannot be represented as finite lathe geometry.`);
    return null;
  }
  const source = edgeSource(edge, contourId, edgeIndex);
  const geometryUncertaintyMm = baseToleranceMm
    + toleranceMm
    + roundoffMm
    + planarityMm
    + normalResidualMm
    + analyticResidualMm;
  if (fullCircle) {
    return {
      primitive: {
        id: edge.id ?? `${String(contourId)}:${edgeIndex}`,
        type: "circle",
        center,
        radius: edge.radiusMm,
        source,
        geometryUncertaintyMm,
      },
      nativeStart: null,
      nativeEnd: null,
      toleranceMm,
      roundoffMm,
      fullCircle: true,
    };
  }

  const start = mapPoint(edge.start, mapping);
  const end = mapPoint(edge.end, mapping);
  const startAngle = Math.atan2(start.x - center.x, start.z - center.z);
  const mappedPlaneNormal = cross(
    unitAxis(mapping.axialAxis, mapping.axialDirection),
    unitAxis(mapping.radialAxis, mapping.radialDirection),
  );
  const orientation = dot(normalizedNormal.vector, mappedPlaneNormal) >= 0 ? 1 : -1;
  const sweep = edge.sweepRadians * orientation;
  const predictedMappedEnd = {
    z: center.z + Math.cos(startAngle + sweep) * edge.radiusMm,
    x: center.x + Math.sin(startAngle + sweep) * edge.radiusMm,
  };
  const mappedEndpointResidualMm = distance2(predictedMappedEnd, end);
  if (mappedEndpointResidualMm > allowedMm) {
    state.add("error", "mapped-circle-inconsistent", `STEP ${context} mapped arc endpoints do not agree with its analytic sweep.`);
  }
  return {
    primitive: {
      id: edge.id ?? `${String(contourId)}:${edgeIndex}`,
      type: "arc",
      center,
      radius: edge.radiusMm,
      start,
      end,
      startAngle,
      sweep,
      source,
      geometryUncertaintyMm: geometryUncertaintyMm + mappedEndpointResidualMm,
      endpointUncertaintyMm: analyticResidualMm + mappedEndpointResidualMm + roundoffMm,
    },
    nativeStart: edge.start,
    nativeEnd: edge.end,
    toleranceMm,
    roundoffMm,
  };
}

function processContour(contour, contourIndex, mapping, baseToleranceMm, limits, state) {
  if (!contour || typeof contour !== "object") {
    state.add("error", "contour-invalid", `STEP section contour ${contourIndex} is malformed.`);
    return null;
  }
  if (!validContourId(contour.id, limits.maxStringLength)) {
    state.add("error", "contour-id-invalid", `STEP section contour ${contourIndex} requires a stable string or nonnegative integer id.`);
  }
  if (contour.closed !== true || contour.ambiguous === true) {
    state.add("error", "contour-open-or-ambiguous", `STEP section contour ${String(contour.id ?? contourIndex)} is not an unambiguous closed contour.`);
  }
  if (!Array.isArray(contour.edges) || contour.edges.length === 0) {
    state.add("error", "contour-edges-required", `STEP section contour ${String(contour.id ?? contourIndex)} has no ordered analytic edges.`);
    return null;
  }
  if (contour.edges.length > limits.maxEdgesPerContour) {
    state.add("error", "contour-edge-limit-exceeded", `STEP section contour ${String(contour.id ?? contourIndex)} exceeds the ${limits.maxEdgesPerContour}-edge limit.`);
    return null;
  }
  const processedEdges = [];
  const edgeIds = new Set();
  for (let edgeIndex = 0; edgeIndex < contour.edges.length; edgeIndex += 1) {
    const edge = contour.edges[edgeIndex];
    if (!edge || typeof edge !== "object") {
      state.add("error", "section-edge-invalid", `STEP section contour ${String(contour.id)} edge ${edgeIndex} is malformed.`);
      continue;
    }
    if (edge.id !== undefined) {
      const key = contourKey(edge.id);
      if (edgeIds.has(key)) state.add("error", "duplicate-edge-id", `STEP contour ${String(contour.id)} repeats edge id '${String(edge.id)}'.`);
      edgeIds.add(key);
    }
    let processed = null;
    if (edge.curveType === "GeomAbs_Line") {
      processed = processLine(edge, edgeIndex, contour.id, mapping, baseToleranceMm, state);
    } else if (edge.curveType === "GeomAbs_Circle") {
      processed = processCircle(edge, edgeIndex, contour.id, mapping, baseToleranceMm, state);
    } else {
      state.add(
        "error",
        "unsupported-section-curve",
        `STEP contour ${String(contour.id)} edge ${edgeIndex} uses unsupported analytic type '${String(edge.curveType ?? "missing")}'. Only GeomAbs_Line and GeomAbs_Circle are authorized.`,
      );
    }
    if (processed) processedEdges.push(processed);
  }
  const fullCircles = processedEdges.filter((edge) => edge.fullCircle);
  if (fullCircles.length && (fullCircles.length !== 1 || processedEdges.length !== 1)) {
    state.add("error", "full-circle-contour-ambiguous", `STEP contour ${String(contour.id)} cannot mix a full-circle edge with other edges.`);
  }
  let connectivityResidualMm = 0;
  if (!fullCircles.length && processedEdges.length === contour.edges.length) {
    for (let index = 0; index < processedEdges.length; index += 1) {
      const current = processedEdges[index];
      const next = processedEdges[(index + 1) % processedEdges.length];
      const residualMm = distance3(current.nativeEnd, next.nativeStart);
      const allowedMm = baseToleranceMm
        + current.toleranceMm
        + next.toleranceMm
        + current.roundoffMm
        + next.roundoffMm;
      connectivityResidualMm = Math.max(connectivityResidualMm, residualMm);
      if (!finite(residualMm) || residualMm > allowedMm) {
        state.add("error", "contour-connectivity-invalid", `STEP contour ${String(contour.id)} ordered edges do not close within their reported tolerance envelope.`);
      }
    }
  }
  for (const edge of processedEdges) edge.primitive.geometryUncertaintyMm += connectivityResidualMm;
  return {
    id: contour.id,
    primitives: processedEdges.map((edge) => edge.primitive),
    connectivityResidualMm,
  };
}

function primitiveEndpointBound(primitive) {
  return Math.max(primitive.geometryUncertaintyMm ?? 0, primitive.endpointUncertaintyMm ?? 0);
}

function profileSource(primitive, start, end) {
  return {...primitive.source, profileSide: "positive-radius", sourceParameterRange: [start, end]};
}

function clipLineToPositiveRadius(primitive, state) {
  const {start, end} = primitive;
  const sideBoundMm = primitiveEndpointBound(primitive);
  if (start.x === 0 && end.x === 0) {
    state.add("error", "profile-centerline-edge-ambiguous", "The selected section contains an edge on the spindle centerline, so a unique machining-side profile cannot be extracted.");
    return null;
  }
  const classify = (value) => value === 0 ? 0 : value > sideBoundMm ? 1 : value < -sideBoundMm ? -1 : null;
  const startSide = classify(start.x), endSide = classify(end.x);
  if (startSide === null || endSide === null) {
    state.add("error", "profile-line-side-uncertain", "A section line endpoint is uncertainty-close to the spindle centerline, so its machining side is not provable.");
    return null;
  }
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  const arithmeticMm = roundingBound([start.x, start.z, end.x, end.z, dx, dz], 64);
  const radialSlope = Math.abs(dx) / length;
  let axisEndpointBoundMm = 0;
  if (startSide === 0 || endSide === 0) {
    axisEndpointBoundMm = (sideBoundMm + arithmeticMm) / radialSlope;
    if (!finite(axisEndpointBoundMm) || axisEndpointBoundMm > STEP_NUMERICAL_BUDGET_MM) {
      state.add("error", "profile-line-crossing-ill-conditioned", "A section edge meets the spindle centerline too shallowly to preserve the STEP numerical budget.");
      return null;
    }
  }
  if (startSide >= 0 && endSide >= 0) return [{
    ...primitive,
    source: profileSource(primitive, 0, 1),
    endpointUncertaintyMm: Math.max(primitive.endpointUncertaintyMm ?? 0, axisEndpointBoundMm),
    geometryUncertaintyMm: Math.max(primitive.geometryUncertaintyMm, axisEndpointBoundMm),
  }];
  if (startSide <= 0 && endSide <= 0) return [];
  const parameter = -start.x / dx;
  const crossingArithmeticMm = arithmeticMm + roundingBound([parameter], 64);
  const crossingUncertaintyMm = (primitiveEndpointBound(primitive) + crossingArithmeticMm) / radialSlope;
  if (!finite(parameter) || !(parameter > 0 && parameter < 1) || !finite(crossingUncertaintyMm)
    || crossingUncertaintyMm > STEP_NUMERICAL_BUDGET_MM) {
    state.add("error", "profile-line-crossing-ill-conditioned", "A section edge crosses the spindle centerline too shallowly to preserve the STEP numerical budget.");
    return null;
  }
  const crossing = {z: start.z + dz * parameter, x: 0};
  const keepStart = start.x > 0;
  const clipped = {
    ...primitive,
    id: `${String(primitive.id)}:profile`,
    start: keepStart ? start : crossing,
    end: keepStart ? crossing : end,
    source: profileSource(primitive, keepStart ? 0 : parameter, keepStart ? parameter : 1),
    endpointUncertaintyMm: Math.max(primitive.endpointUncertaintyMm ?? 0, crossingUncertaintyMm),
    geometryUncertaintyMm: Math.max(primitive.geometryUncertaintyMm, crossingUncertaintyMm),
  };
  if (distance2(clipped.start, clipped.end) <= clipped.geometryUncertaintyMm) {
    state.add("error", "profile-line-sliver", "Clipping produced a line fragment too small to distinguish from its uncertainty envelope.");
    return null;
  }
  return [clipped];
}

function arcPoint(primitive, angle, parameter) {
  if (primitive.type === "arc" && parameter === 0) return primitive.start;
  if (primitive.type === "arc" && parameter === 1) return primitive.end;
  return {z: primitive.center.z + Math.cos(angle) * primitive.radius, x: primitive.center.x + Math.sin(angle) * primitive.radius};
}

function clipRoundPrimitiveToPositiveRadius(primitive, state) {
  const startAngle = primitive.type === "circle" ? 0 : primitive.startAngle;
  const sweep = primitive.type === "circle" ? TAU : primitive.sweep;
  const ratio = -primitive.center.x / primitive.radius;
  const radialEnvelopeMm = primitiveEndpointBound(primitive)
    + roundingBound([primitive.center.z, primitive.center.x, primitive.radius, startAngle, sweep], 64);
  const tangentAngle = primitive.center.x >= 0 ? -Math.PI / 2 : Math.PI / 2;
  const tangentFallsOnPrimitive = primitive.type === "circle" || angleOnSweep(tangentAngle, startAngle, sweep);
  if (tangentFallsOnPrimitive && Math.abs(Math.abs(primitive.center.x) - primitive.radius) <= radialEnvelopeMm) {
    state.add("error", "profile-arc-tangent-ambiguous", "A circular section edge is tangent or uncertainty-close to the spindle centerline, so its machining side is ambiguous.");
    return null;
  }
  if (primitive.type === "arc" && [primitive.start, primitive.end]
    .some((endpoint) => endpoint.x !== 0 && Math.abs(endpoint.x) <= radialEnvelopeMm)) {
    state.add("error", "profile-arc-side-uncertain", "A circular section endpoint is uncertainty-close to the spindle centerline, so its machining side is not provable.");
    return null;
  }
  const rootBounds = new Map();
  if (primitive.type === "arc") {
    for (const [parameter, angle, endpoint] of [[0, startAngle, primitive.start], [1, startAngle + sweep, primitive.end]]) {
      if (endpoint.x !== 0) continue;
      const crossingUncertaintyMm = radialEnvelopeMm / Math.abs(Math.cos(angle));
      if (!finite(crossingUncertaintyMm) || crossingUncertaintyMm > STEP_NUMERICAL_BUDGET_MM) {
        state.add("error", "profile-arc-crossing-ill-conditioned", "A circular section edge meets the spindle centerline too close to tangency to preserve the STEP numerical budget.");
        return null;
      }
      rootBounds.set(parameter, crossingUncertaintyMm);
    }
  }
  const roots = [];
  if (Math.abs(ratio) < 1) {
    const base = Math.asin(ratio);
    const low = Math.min(startAngle, startAngle + sweep);
    const high = Math.max(startAngle, startAngle + sweep);
    for (const family of [base, Math.PI - base]) {
      const first = Math.floor((low - family) / TAU) - 1;
      const last = Math.ceil((high - family) / TAU) + 1;
      for (let turn = first; turn <= last; turn += 1) {
        const angle = family + turn * TAU;
        const parameter = (angle - startAngle) / sweep;
        if (!(parameter > 0 && parameter < 1)) continue;
        const slope = Math.abs(Math.cos(angle));
        const crossingUncertaintyMm = radialEnvelopeMm / slope;
        if (!finite(crossingUncertaintyMm) || crossingUncertaintyMm > STEP_NUMERICAL_BUDGET_MM) {
          state.add("error", "profile-arc-crossing-ill-conditioned", "A circular section edge crosses the spindle centerline too close to tangency to preserve the STEP numerical budget.");
          return null;
        }
        roots.push(parameter);
        rootBounds.set(parameter, crossingUncertaintyMm);
      }
    }
  }
  roots.sort((a, b) => a - b);
  if (roots.some((value, index) => index && value === roots[index - 1])) {
    state.add("error", "profile-arc-roots-ambiguous", "A circular section edge produced duplicate spindle-centerline intersections.");
    return null;
  }
  const parameters = [0, ...roots, 1];
  const fragments = [];
  for (let index = 0; index < parameters.length - 1; index += 1) {
    const from = parameters[index];
    const to = parameters[index + 1];
    const midpoint = (from + to) / 2;
    const midpointX = primitive.center.x + Math.sin(startAngle + sweep * midpoint) * primitive.radius;
    if (midpointX < 0) continue;
    if (!(midpointX > 0)) {
      state.add("error", "profile-arc-side-ambiguous", "A circular section fragment cannot be assigned uniquely to one side of the spindle centerline.");
      return null;
    }
    const fragmentSweep = sweep * (to - from);
    const fragmentLength = Math.abs(fragmentSweep) * primitive.radius;
    const fromAngle = startAngle + sweep * from;
    const toAngle = startAngle + sweep * to;
    const crossingBound = Math.max(rootBounds.get(from) ?? 0, rootBounds.get(to) ?? 0);
    const geometryUncertaintyMm = Math.max(primitive.geometryUncertaintyMm, crossingBound);
    const start = arcPoint(primitive, fromAngle, from);
    const end = arcPoint(primitive, toAngle, to);
    if (roots.includes(from)) start.x = 0;
    if (roots.includes(to)) end.x = 0;
    if ((start.x !== 0 && Math.abs(start.x) <= radialEnvelopeMm)
      || (end.x !== 0 && Math.abs(end.x) <= radialEnvelopeMm)) {
      state.add("error", "profile-arc-side-uncertain", "A circular section endpoint is uncertainty-close to the spindle centerline, so its machining side is not provable.");
      return null;
    }
    if (fragmentLength <= geometryUncertaintyMm) {
      state.add("error", "profile-arc-sliver", "Clipping produced an arc fragment too small to distinguish from its uncertainty envelope.");
      return null;
    }
    if (from === 0 && to === 1) {
      fragments.push({
        ...primitive,
        source: profileSource(primitive, 0, 1),
        endpointUncertaintyMm: Math.max(primitive.endpointUncertaintyMm ?? 0, crossingBound),
        geometryUncertaintyMm,
      });
      continue;
    }
    fragments.push({
      ...primitive,
      id: `${String(primitive.id)}:profile:${index}`,
      type: "arc",
      start,
      end,
      startAngle: fromAngle,
      sweep: fragmentSweep,
      source: profileSource(primitive, from, to),
      endpointUncertaintyMm: Math.max(primitive.endpointUncertaintyMm ?? 0, crossingBound),
      geometryUncertaintyMm,
    });
  }
  return fragments;
}

function endpointsConnect(first, second) {
  return distance2(first.end, second.start) <= primitiveEndpointBound(first.primitive) + primitiveEndpointBound(second.primitive);
}

function extractPositiveRadialProfile(primitives, limits, state) {
  const fragmentsByPrimitive = [];
  for (const primitive of primitives) {
    const fragments = primitive.type === "line"
      ? clipLineToPositiveRadius(primitive, state)
      : clipRoundPrimitiveToPositiveRadius(primitive, state);
    if (fragments === null) return null;
    fragmentsByPrimitive.push(fragments);
  }
  const entries = [];
  for (const fragments of fragmentsByPrimitive) {
    for (const primitive of fragments) entries.push({primitive, start: primitive.start, end: primitive.end});
    if (!fragments.length) entries.push(null);
  }
  const retained = fragmentsByPrimitive.flat();
  if (retained.length === 1 && retained[0].type === "circle") {
    return {primitives: retained, closed: true, endpoints: [], intersectionCount: 0};
  }
  const chains = [];
  let chain = [];
  for (const entry of entries) {
    if (entry === null) {
      if (chain.length) chains.push(chain);
      chain = [];
      continue;
    }
    if (chain.length && !endpointsConnect({primitive: chain.at(-1), end: chain.at(-1).end}, entry)) {
      chains.push(chain);
      chain = [];
    }
    chain.push(entry.primitive);
  }
  if (chain.length) chains.push(chain);
  if (chains.length > 1) {
    const last = chains.at(-1), first = chains[0];
    const lastEntry = {primitive: last.at(-1), start: last.at(-1).start, end: last.at(-1).end};
    const firstEntry = {primitive: first[0], start: first[0].start, end: first[0].end};
    if (endpointsConnect(lastEntry, firstEntry)) {
      chains[0] = [...last, ...first];
      chains.pop();
    }
  }
  if (chains.length !== 1 || !chains[0].length) {
    state.add("error", "profile-side-not-unique", "The selected contour does not produce one unambiguous connected machining-side profile.");
    return null;
  }
  const result = chains[0];
  if (result.length > limits.maxTotalEdges) {
    state.add("error", "profile-fragment-limit-exceeded", `The machining-side profile exceeds the ${limits.maxTotalEdges}-fragment safety limit.`);
    return null;
  }
  const first = result[0].start;
  const last = result.at(-1).end;
  const closed = distance2(first, last) <= primitiveEndpointBound(result[0]) + primitiveEndpointBound(result.at(-1));
  const vertices = [first, ...result.map((primitive) => primitive.end)];
  const axisContacts = (closed ? vertices.slice(0, -1) : vertices).filter((point) => point.x === 0);
  if (closed && axisContacts.length) {
    state.add("error", "profile-closed-axis-contact-ambiguous", "A closed machining-side profile must remain wholly on the positive-radius side without touching the spindle centerline.");
    return null;
  }
  if (!closed && (first.x !== 0 || last.x !== 0)) {
    state.add("error", "profile-axis-endpoints-required", "An open machining-side profile must terminate at two exact spindle-centerline intersections.");
    return null;
  }
  if (!closed && vertices.slice(1, -1).some((point) => point.x === 0)) {
    state.add("error", "profile-extra-axis-contact-ambiguous", "The machining-side profile touches the spindle centerline between its endpoints, so its topology is ambiguous.");
    return null;
  }
  return {primitives: result, closed, endpoints: closed ? [] : [first, last], intersectionCount: closed ? 0 : 2};
}

function normalizeAngle(angle) {
  const result = angle % TAU;
  return result < 0 ? result + TAU : result;
}

function angleOnSweep(angle, startAngle, sweep) {
  if (sweep >= 0) return normalizeAngle(angle - startAngle) <= sweep;
  return normalizeAngle(startAngle - angle) <= -sweep;
}

function cross2(left, right) {
  return left.z * right.x - left.x * right.z;
}

function subtract2(left, right) {
  return {z: left.z - right.z, x: left.x - right.x};
}

function dot2(left, right) {
  return left.z * right.z + left.x * right.x;
}

function arcContainsAngle(primitive, angle) {
  if (primitive.type === "circle") return true;
  const sweepMagnitude = Math.abs(primitive.sweep);
  const delta = primitive.sweep >= 0
    ? normalizeAngle(angle - primitive.startAngle)
    : normalizeAngle(primitive.startAngle - angle);
  const angularRoundoff = roundingBound([angle, primitive.startAngle, primitive.sweep], TRIG_ROUNDING_ULPS);
  return delta <= sweepMagnitude + angularRoundoff;
}

function arcContainsPoint(primitive, point) {
  if (primitive.type !== "circle") {
    const endpointRoundoff = roundingBound([
      point.z,
      point.x,
      primitive.start?.z,
      primitive.start?.x,
      primitive.end?.z,
      primitive.end?.x,
    ], ROUNDING_ULPS);
    if (distance2(point, primitive.start) <= endpointRoundoff
      || distance2(point, primitive.end) <= endpointRoundoff) return true;
  }
  const angle = Math.atan2(point.x - primitive.center.x, point.z - primitive.center.z);
  return finite(angle) && arcContainsAngle(primitive, angle);
}

function uniqueIntersectionPoints(points) {
  const unique = [];
  for (const point of points) {
    const allowance = roundingBound([point.z, point.x], 128);
    if (!unique.some((candidate) => distance2(candidate, point) <= allowance)) unique.push(point);
  }
  return unique;
}

function lineLineIntersections(first, second) {
  const directionA = subtract2(first.end, first.start);
  const directionB = subtract2(second.end, second.start);
  const offset = subtract2(second.start, first.start);
  const denominatorTerms = [directionA.z * directionB.x, directionA.x * directionB.z];
  const denominator = denominatorTerms[0] - denominatorTerms[1];
  const denominatorRoundoff = roundingBound(denominatorTerms, 64);
  if (Math.abs(denominator) <= denominatorRoundoff) {
    const collinearTerms = [offset.z * directionA.x, offset.x * directionA.z];
    if (Math.abs(collinearTerms[0] - collinearTerms[1]) > roundingBound(collinearTerms, 64)) {
      return {points: [], overlap: false};
    }
    const useZ = Math.abs(directionA.z) >= Math.abs(directionA.x);
    const component = useZ ? "z" : "x";
    const divisor = directionA[component];
    if (!finite(divisor) || divisor === 0) return {points: [], overlap: true};
    const firstParameter = (second.start[component] - first.start[component]) / divisor;
    const secondParameter = (second.end[component] - first.start[component]) / divisor;
    const overlapStart = Math.max(0, Math.min(firstParameter, secondParameter));
    const overlapEnd = Math.min(1, Math.max(firstParameter, secondParameter));
    const parameterRoundoff = roundingBound([firstParameter, secondParameter], 64);
    if (overlapStart > overlapEnd + parameterRoundoff) return {points: [], overlap: false};
    const point = {
      z: first.start.z + directionA.z * overlapStart,
      x: first.start.x + directionA.x * overlapStart,
    };
    return {points: [point], overlap: overlapEnd - overlapStart > parameterRoundoff};
  }
  const parameterA = cross2(offset, directionB) / denominator;
  const parameterB = cross2(offset, directionA) / denominator;
  const parameterRoundoff = roundingBound([parameterA, parameterB], 64);
  if (parameterA < -parameterRoundoff || parameterA > 1 + parameterRoundoff
    || parameterB < -parameterRoundoff || parameterB > 1 + parameterRoundoff) {
    return {points: [], overlap: false};
  }
  const boundedParameter = Math.max(0, Math.min(1, parameterA));
  return {
    points: [{
      z: first.start.z + directionA.z * boundedParameter,
      x: first.start.x + directionA.x * boundedParameter,
    }],
    overlap: false,
  };
}

function lineArcIntersections(linePrimitive, arcPrimitive) {
  const direction = subtract2(linePrimitive.end, linePrimitive.start);
  const offset = subtract2(linePrimitive.start, arcPrimitive.center);
  const quadratic = dot2(direction, direction);
  const linear = 2 * dot2(offset, direction);
  const constant = dot2(offset, offset) - arcPrimitive.radius ** 2;
  const discriminantTerms = [linear ** 2, 4 * quadratic * constant];
  const discriminant = discriminantTerms[0] - discriminantTerms[1];
  const discriminantRoundoff = roundingBound(discriminantTerms, 128);
  if (discriminant < -discriminantRoundoff) return {points: [], overlap: false};
  const root = Math.sqrt(Math.max(0, discriminant));
  const parameters = root <= roundingBound([root], 32)
    ? [-linear / (2 * quadratic)]
    : [(-linear - root) / (2 * quadratic), (-linear + root) / (2 * quadratic)];
  const points = [];
  for (const parameter of parameters) {
    const parameterRoundoff = roundingBound([parameter], 64);
    if (parameter < -parameterRoundoff || parameter > 1 + parameterRoundoff) continue;
    const boundedParameter = Math.max(0, Math.min(1, parameter));
    const point = {
      z: linePrimitive.start.z + direction.z * boundedParameter,
      x: linePrimitive.start.x + direction.x * boundedParameter,
    };
    if (arcContainsPoint(arcPrimitive, point)) points.push(point);
  }
  return {points: uniqueIntersectionPoints(points), overlap: false};
}

function arcStrictlyContainsAngle(primitive, angle) {
  if (primitive.type === "circle") return true;
  const sweepMagnitude = Math.abs(primitive.sweep);
  const delta = primitive.sweep >= 0
    ? normalizeAngle(angle - primitive.startAngle)
    : normalizeAngle(primitive.startAngle - angle);
  const angularRoundoff = roundingBound([angle, primitive.startAngle, primitive.sweep], TRIG_ROUNDING_ULPS);
  return delta > angularRoundoff && delta < sweepMagnitude - angularRoundoff;
}

function arcMidpoint(primitive) {
  const angle = primitive.startAngle + primitive.sweep / 2;
  return {
    point: {
      z: primitive.center.z + Math.cos(angle) * primitive.radius,
      x: primitive.center.x + Math.sin(angle) * primitive.radius,
    },
    angle,
  };
}

function circularPrimitivesIntersections(first, second) {
  const centerOffset = subtract2(second.center, first.center);
  const centerDistance = Math.hypot(centerOffset.z, centerOffset.x);
  const linearRoundoff = roundingBound([
    first.center.z, first.center.x, second.center.z, second.center.x, first.radius, second.radius, centerDistance,
  ], 128);
  if (centerDistance <= linearRoundoff) {
    if (Math.abs(first.radius - second.radius) > linearRoundoff) return {points: [], overlap: false};
    if (centerDistance !== 0 || first.radius !== second.radius) return {points: [], overlap: true};
    if (first.type === "circle" || second.type === "circle") return {points: [], overlap: true};
    const sharedEndpoints = [
      ...[first.start, first.end].filter((point) => arcContainsPoint(second, point)),
      ...[second.start, second.end].filter((point) => arcContainsPoint(first, point)),
    ];
    const firstMiddle = arcMidpoint(first);
    const secondMiddle = arcMidpoint(second);
    const overlap = [first.start, first.end].some((point) => (
      arcStrictlyContainsAngle(second, Math.atan2(point.x - second.center.x, point.z - second.center.z))
    )) || [second.start, second.end].some((point) => (
      arcStrictlyContainsAngle(first, Math.atan2(point.x - first.center.x, point.z - first.center.z))
    )) || arcStrictlyContainsAngle(second, firstMiddle.angle)
      || arcStrictlyContainsAngle(first, secondMiddle.angle);
    return {points: uniqueIntersectionPoints(sharedEndpoints), overlap};
  }
  const radiusSum = first.radius + second.radius;
  const radiusDifference = Math.abs(first.radius - second.radius);
  if (centerDistance > radiusSum + linearRoundoff || centerDistance < radiusDifference - linearRoundoff) {
    return {points: [], overlap: false};
  }
  const along = (first.radius ** 2 - second.radius ** 2 + centerDistance ** 2) / (2 * centerDistance);
  const heightSquared = first.radius ** 2 - along ** 2;
  const squaredRoundoff = roundingBound([first.radius ** 2, along ** 2], 128);
  if (heightSquared < -squaredRoundoff) return {points: [], overlap: false};
  if (heightSquared < 0) return {points: [], overlap: true};
  const height = Math.sqrt(Math.max(0, heightSquared));
  const base = {
    z: first.center.z + centerOffset.z * along / centerDistance,
    x: first.center.x + centerOffset.x * along / centerDistance,
  };
  const perpendicular = {z: -centerOffset.x / centerDistance, x: centerOffset.z / centerDistance};
  const points = height <= linearRoundoff
    ? [base]
    : [
      {z: base.z + perpendicular.z * height, x: base.x + perpendicular.x * height},
      {z: base.z - perpendicular.z * height, x: base.x - perpendicular.x * height},
    ];
  return {
    points: points.filter((point) => arcContainsPoint(first, point) && arcContainsPoint(second, point)),
    overlap: false,
  };
}

function analyticPrimitiveIntersections(first, second) {
  if (first.type === "line" && second.type === "line") return lineLineIntersections(first, second);
  if (first.type === "line") return lineArcIntersections(first, second);
  if (second.type === "line") return lineArcIntersections(second, first);
  return circularPrimitivesIntersections(first, second);
}

function pointToLineDistance(point, primitive) {
  const direction = subtract2(primitive.end, primitive.start);
  const denominator = dot2(direction, direction);
  const parameter = Math.max(0, Math.min(1, dot2(subtract2(point, primitive.start), direction) / denominator));
  return distance2(point, {
    z: primitive.start.z + direction.z * parameter,
    x: primitive.start.x + direction.x * parameter,
  });
}

function pointToArcDistance(point, primitive) {
  const centerOffset = subtract2(point, primitive.center);
  const radiusToPoint = Math.hypot(centerOffset.z, centerOffset.x);
  if (radiusToPoint > 0) {
    const angle = Math.atan2(centerOffset.x, centerOffset.z);
    if (arcContainsAngle(primitive, angle)) return Math.abs(radiusToPoint - primitive.radius);
  }
  if (primitive.type === "circle") return primitive.radius;
  return Math.min(distance2(point, primitive.start), distance2(point, primitive.end));
}

function minimumLineArcDistance(linePrimitive, arcPrimitive) {
  let minimum = Math.min(
    pointToArcDistance(linePrimitive.start, arcPrimitive),
    pointToArcDistance(linePrimitive.end, arcPrimitive),
    ...(arcPrimitive.type === "circle" ? [] : [
      pointToLineDistance(arcPrimitive.start, linePrimitive),
      pointToLineDistance(arcPrimitive.end, linePrimitive),
    ]),
  );
  const direction = subtract2(linePrimitive.end, linePrimitive.start);
  const denominator = dot2(direction, direction);
  const centerParameter = dot2(subtract2(arcPrimitive.center, linePrimitive.start), direction) / denominator;
  if (centerParameter >= 0 && centerParameter <= 1) {
    const projection = {
      z: linePrimitive.start.z + direction.z * centerParameter,
      x: linePrimitive.start.x + direction.x * centerParameter,
    };
    const radial = subtract2(projection, arcPrimitive.center);
    const radialLength = Math.hypot(radial.z, radial.x);
    if (radialLength > 0) {
      for (const sign of [-1, 1]) {
        const point = {
          z: arcPrimitive.center.z + sign * radial.z * arcPrimitive.radius / radialLength,
          x: arcPrimitive.center.x + sign * radial.x * arcPrimitive.radius / radialLength,
        };
        if (arcContainsPoint(arcPrimitive, point)) minimum = Math.min(minimum, pointToLineDistance(point, linePrimitive));
      }
    }
  }
  return minimum;
}

function circularEndpoints(primitive) {
  return primitive.type === "circle" ? [] : [primitive.start, primitive.end];
}

function minimumCircularDistance(first, second) {
  let minimum = Number.POSITIVE_INFINITY;
  for (const point of circularEndpoints(first)) minimum = Math.min(minimum, pointToArcDistance(point, second));
  for (const point of circularEndpoints(second)) minimum = Math.min(minimum, pointToArcDistance(point, first));
  const centerOffset = subtract2(second.center, first.center);
  const centerDistance = Math.hypot(centerOffset.z, centerOffset.x);
  if (centerDistance === 0) {
    const firstCandidates = first.type === "circle" ? [] : [first.start, first.end];
    const overlappingAngle = first.type === "circle" || second.type === "circle"
      || firstCandidates.some((point) => arcContainsPoint(second, point))
      || circularEndpoints(second).some((point) => arcContainsPoint(first, point));
    if (overlappingAngle) minimum = Math.min(minimum, Math.abs(first.radius - second.radius));
    return minimum;
  }
  const unit = {z: centerOffset.z / centerDistance, x: centerOffset.x / centerDistance};
  for (const firstSign of [-1, 1]) {
    const firstPoint = {
      z: first.center.z + firstSign * unit.z * first.radius,
      x: first.center.x + firstSign * unit.x * first.radius,
    };
    if (!arcContainsPoint(first, firstPoint)) continue;
    for (const secondSign of [-1, 1]) {
      const secondPoint = {
        z: second.center.z + secondSign * unit.z * second.radius,
        x: second.center.x + secondSign * unit.x * second.radius,
      };
      if (arcContainsPoint(second, secondPoint)) minimum = Math.min(minimum, distance2(firstPoint, secondPoint));
    }
  }
  return minimum;
}

function minimumPrimitiveDistance(first, second) {
  if (first.type === "line" && second.type === "line") {
    return Math.min(
      pointToLineDistance(first.start, second),
      pointToLineDistance(first.end, second),
      pointToLineDistance(second.start, first),
      pointToLineDistance(second.end, first),
    );
  }
  if (first.type === "line") return minimumLineArcDistance(first, second);
  if (second.type === "line") return minimumLineArcDistance(second, first);
  return minimumCircularDistance(first, second);
}

function analyticPrimitiveEndpoint(primitive, atStart) {
  if (primitive.type === "line") return atStart ? primitive.start : primitive.end;
  if (primitive.type !== "arc") return null;
  const angle = atStart ? primitive.startAngle : primitive.startAngle + primitive.sweep;
  return {
    z: primitive.center.z + Math.cos(angle) * primitive.radius,
    x: primitive.center.x + Math.sin(angle) * primitive.radius,
  };
}

function adjacentBoundaryJoints(primitives, firstIndex, secondIndex) {
  const joints = [];
  if (secondIndex === firstIndex + 1) {
    joints.push([
      analyticPrimitiveEndpoint(primitives[firstIndex], false),
      analyticPrimitiveEndpoint(primitives[secondIndex], true),
    ]);
  }
  if (firstIndex === 0 && secondIndex === primitives.length - 1) {
    joints.push([
      analyticPrimitiveEndpoint(primitives[firstIndex], true),
      analyticPrimitiveEndpoint(primitives[secondIndex], false),
    ]);
  }
  return joints;
}

function expectedJointIntersection(point, joints) {
  return joints.some(([firstPoint, secondPoint]) => {
    const roundoff = roundingBound([
      point.z, point.x, firstPoint?.z, firstPoint?.x, secondPoint?.z, secondPoint?.x,
    ], ROUNDING_ULPS);
    return finitePoint2(firstPoint) && finitePoint2(secondPoint)
      && distance2(point, firstPoint) <= roundoff
      && distance2(point, secondPoint) <= roundoff;
  });
}

function expectedJointCoincides([firstPoint, secondPoint]) {
  if (!finitePoint2(firstPoint) || !finitePoint2(secondPoint)) return false;
  const roundoff = roundingBound([
    firstPoint.z, firstPoint.x, secondPoint.z, secondPoint.x,
  ], ROUNDING_ULPS);
  return distance2(firstPoint, secondPoint) <= roundoff;
}

function calculationClosedMaterialBoundary(primitives) {
  if (primitives.length === 1 && primitives[0].type === "circle") return [...primitives];
  const boundary = primitives.map((primitive) => ({
    ...primitive,
    ...(primitive.start ? {start: {...primitive.start}} : {}),
    ...(primitive.end ? {end: {...primitive.end}} : {}),
    ...(primitive.center ? {center: {...primitive.center}} : {}),
    ...(primitive.source ? {source: {...primitive.source}} : {}),
  }));
  const connectors = new Map();
  const closeLineEndpoint = (primitive, key, point, closureLengthMm) => {
    primitive[key] = {...point};
    primitive.geometryUncertaintyMm = (Number(primitive.geometryUncertaintyMm) || 0) + closureLengthMm;
    primitive.source = {...primitive.source, numericalClosure: true};
  };
  for (let index = 0; index < boundary.length; index += 1) {
    const primitive = boundary[index];
    const next = boundary[(index + 1) % boundary.length];
    const end = analyticPrimitiveEndpoint(primitive, false);
    const nextStart = analyticPrimitiveEndpoint(next, true);
    if (!finitePoint2(end) || !finitePoint2(nextStart)) continue;
    const closureLengthMm = distance2(end, nextStart);
    if (closureLengthMm === 0) continue;
    if (primitive.type === "line") {
      closeLineEndpoint(primitive, "end", nextStart, closureLengthMm);
      continue;
    }
    if (next.type === "line") {
      closeLineEndpoint(next, "start", end, closureLengthMm);
      continue;
    }
    connectors.set(index, {
      id: `calculation-closure-${index}`,
      type: "line",
      start: {...end},
      end: {...nextStart},
      geometryUncertaintyMm: Math.max(
        Number(primitive.geometryUncertaintyMm) || 0,
        Number(next.geometryUncertaintyMm) || 0,
      ) + closureLengthMm,
      source: {
        format: "step",
        numericalClosure: true,
        precedingEdgeId: primitive.id ?? index,
        followingEdgeId: next.id ?? ((index + 1) % primitives.length),
      },
    });
  }
  return boundary.flatMap((primitive, index) => (
    connectors.has(index) ? [primitive, connectors.get(index)] : [primitive]
  ));
}

function qualifySimpleMaterialBoundary(primitives) {
  let intersectionTests = 0;
  for (let firstIndex = 0; firstIndex < primitives.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < primitives.length; secondIndex += 1) {
      const adjacent = secondIndex === firstIndex + 1
        || (firstIndex === 0 && secondIndex === primitives.length - 1);
      intersectionTests += 1;
      if (intersectionTests > MAX_MATERIAL_REGION_INTERSECTION_TESTS) {
        return {qualified: false, reason: "workload"};
      }
      const first = primitives[firstIndex];
      const second = primitives[secondIndex];
      const joints = adjacent ? adjacentBoundaryJoints(primitives, firstIndex, secondIndex) : [];
      if (joints.some((joint) => !expectedJointCoincides(joint))) {
        return {qualified: false, reason: "gap", firstIndex, secondIndex};
      }
      const intersections = analyticPrimitiveIntersections(first, second);
      if (intersections.overlap
        || intersections.points.some((point) => !expectedJointIntersection(point, joints))) {
        return {qualified: false, reason: "intersection", firstIndex, secondIndex};
      }
      if (!adjacent) {
        const minimumDistanceMm = intersections.points.length ? 0 : minimumPrimitiveDistance(first, second);
        const combinedUncertaintyMm = Math.max(0, Number(first.geometryUncertaintyMm) || 0)
          + Math.max(0, Number(second.geometryUncertaintyMm) || 0);
        const clearanceRoundoffMm = roundingBound([
          minimumDistanceMm,
          first.start?.z, first.start?.x, first.end?.z, first.end?.x, first.center?.z, first.center?.x, first.radius,
          second.start?.z, second.start?.x, second.end?.z, second.end?.x, second.center?.z, second.center?.x, second.radius,
        ], 256);
        if (!finite(minimumDistanceMm) || minimumDistanceMm <= combinedUncertaintyMm + clearanceRoundoffMm) {
          return {qualified: false, reason: "clearance", firstIndex, secondIndex};
        }
      }
    }
  }
  return {qualified: true, reason: null, boundary: calculationClosedMaterialBoundary(primitives)};
}

function unqualifiedMaterialRegion(code, message, {selectedContourId = null, profileSide = null} = {}) {
  return {
    schemaVersion: 1,
    qualification: MATERIAL_REGION_QUALIFICATION,
    qualified: false,
    coordinateSystem: "lathe-xz",
    sourceContourId: selectedContourId,
    profileSide,
    boundary: null,
    boundaryClosed: false,
    axisEndpoints: [],
    geometryUncertaintyMm: null,
    unqualifiedReason: {code, message},
  };
}

function primitiveAxisContacts(primitive) {
  if (primitive.type === "line") {
    const contacts = [];
    if (primitive.start.x === 0) contacts.push({...primitive.start});
    if (primitive.end.x === 0) contacts.push({...primitive.end});
    if (primitive.start.x * primitive.end.x < 0) {
      const parameter = -primitive.start.x / (primitive.end.x - primitive.start.x);
      contacts.push({
        z: primitive.start.z + (primitive.end.z - primitive.start.z) * parameter,
        x: 0,
      });
    }
    return contacts;
  }
  if (primitive.type !== "arc" && primitive.type !== "circle") return null;
  const startAngle = primitive.type === "circle" ? 0 : primitive.startAngle;
  const sweep = primitive.type === "circle" ? TAU : primitive.sweep;
  const ratio = -primitive.center.x / primitive.radius;
  if (Math.abs(ratio) > 1) return [];
  const base = Math.asin(Math.max(-1, Math.min(1, ratio)));
  const low = Math.min(startAngle, startAngle + sweep);
  const high = Math.max(startAngle, startAngle + sweep);
  const contacts = [];
  for (const family of [base, Math.PI - base]) {
    const first = Math.floor((low - family) / TAU) - 1;
    const last = Math.ceil((high - family) / TAU) + 1;
    for (let turn = first; turn <= last; turn += 1) {
      const angle = family + turn * TAU;
      const parameter = (angle - startAngle) / sweep;
      if (parameter < 0 || parameter > 1) continue;
      contacts.push({z: primitive.center.z + Math.cos(angle) * primitive.radius, x: 0});
    }
  }
  return contacts;
}

function uniqueAxisContacts(primitives, uncertaintyMm) {
  const contacts = [];
  for (const primitive of primitives) {
    const candidates = primitiveAxisContacts(primitive);
    if (!candidates) return null;
    for (const candidate of candidates) {
      if (!finitePoint2(candidate)) return null;
      if (!contacts.some((contact) => Math.abs(contact.z - candidate.z) <= uncertaintyMm)) contacts.push(candidate);
    }
  }
  return contacts;
}

function qualifyMaterialRegion({
  dto,
  section,
  contours,
  selected,
  selectedPrimitives,
  selectedMaximumUncertaintyMm,
  mapping,
  extractedProfile,
  maximumUncertaintyMm,
}) {
  const context = {
    selectedContourId: selected?.id ?? mapping.selectedContourId ?? null,
    profileSide: mapping.profileSide === "positive" ? "positive-radius" : null,
  };
  if (dto.topology?.valid !== true || dto.topology?.solidCount !== 1) {
    return unqualifiedMaterialRegion(
      "material-region-single-solid-required",
      "Signed nominal-material classification requires exactly one valid STEP solid.",
      context,
    );
  }
  if (contours.length !== 1 || !selected || selected.id !== contours[0]?.id) {
    return unqualifiedMaterialRegion(
      "material-region-single-contour-required",
      "Signed nominal-material classification requires the one explicitly selected closed contour to be the section's only contour.",
      context,
    );
  }
  if (section.approximationUsed !== false || section.fuzzyToleranceMm !== 0
    || selectedPrimitives.some((primitive) => !["line", "arc", "circle"].includes(primitive.type))) {
    return unqualifiedMaterialRegion(
      "material-region-exact-section-required",
      "Signed nominal-material classification requires exact analytic section primitives with approximation and fuzzy tolerance disabled.",
      context,
    );
  }
  if (mapping.profileSide !== "positive" || !extractedProfile) {
    return unqualifiedMaterialRegion(
      "material-region-positive-profile-required",
      "Signed nominal-material classification requires an explicitly extracted physical positive-radius profile.",
      context,
    );
  }
  if (extractedProfile.closed !== false || extractedProfile.intersectionCount !== 2
    || !Array.isArray(extractedProfile.endpoints) || extractedProfile.endpoints.length !== 2
    || extractedProfile.endpoints.some((point) => !finitePoint2(point) || point.x !== 0)) {
    return unqualifiedMaterialRegion(
      "material-region-axis-endpoints-required",
      "Signed nominal-material classification requires exactly two proven spindle-centerline endpoints on one open positive-radius profile.",
      context,
    );
  }
  const simpleBoundary = qualifySimpleMaterialBoundary(selectedPrimitives);
  if (!simpleBoundary.qualified) {
    return unqualifiedMaterialRegion(
      simpleBoundary.reason === "workload"
        ? "material-region-intersection-workload-exceeded"
        : (simpleBoundary.reason === "clearance"
          ? "material-region-self-intersection-clearance"
          : (simpleBoundary.reason === "gap"
            ? "material-region-boundary-gap"
            : "material-region-self-intersection")),
      simpleBoundary.reason === "workload"
        ? `The selected section exceeds the ${MAX_MATERIAL_REGION_INTERSECTION_TESTS.toLocaleString()}-pair analytic intersection limit, so a simple material boundary is not proven.`
        : (simpleBoundary.reason === "clearance"
          ? "Non-adjacent analytic edges are closer than their combined geometry-uncertainty envelope, so a simple material boundary is not proven."
          : (simpleBoundary.reason === "gap"
            ? `The selected section's adjacent edges ${simpleBoundary.firstIndex + 1} and ${simpleBoundary.secondIndex + 1} do not share one endpoint within calculation roundoff, so a closed material boundary is not proven.`
            : `The selected section has an unexpected analytic edge intersection between edges ${simpleBoundary.firstIndex + 1} and ${simpleBoundary.secondIndex + 1}, so it does not prove one simple material boundary.`)),
      context,
    );
  }
  const internalProfileContact = extractedProfile.primitives.some((primitive, index) => (
    (index > 0 && primitive.start?.x === 0)
    || (index < extractedProfile.primitives.length - 1 && primitive.end?.x === 0)
  ));
  const contactUncertaintyMm = Math.max(selectedMaximumUncertaintyMm, maximumUncertaintyMm);
  const boundaryAxisContacts = uniqueAxisContacts(selectedPrimitives, contactUncertaintyMm);
  if (internalProfileContact || !boundaryAxisContacts || boundaryAxisContacts.length !== 2) {
    return unqualifiedMaterialRegion(
      "material-region-internal-axis-contact",
      "The selected closed section must meet the spindle centerline at only the positive profile's two endpoints, with no internal or additional contact.",
      context,
    );
  }
  return {
    schemaVersion: 1,
    qualification: MATERIAL_REGION_QUALIFICATION,
    qualified: true,
    coordinateSystem: "lathe-xz",
    sourceContourId: selected.id,
    profileSide: "positive-radius",
    boundary: simpleBoundary.boundary,
    boundaryClosed: true,
    axisEndpoints: extractedProfile.endpoints.map((point) => ({...point})),
    geometryUncertaintyMm: contactUncertaintyMm,
    unqualifiedReason: null,
  };
}

function geometryBounds(primitives) {
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let pointCount = 0;
  const include = (point) => {
    if (!finitePoint2(point)) return false;
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    pointCount += 1;
    return true;
  };
  for (const primitive of primitives) {
    if (primitive.type === "line") {
      if (!include(primitive.start) || !include(primitive.end)) return null;
      continue;
    }
    if (primitive.type === "circle") {
      for (const point of [
        {z: primitive.center.z - primitive.radius, x: primitive.center.x},
        {z: primitive.center.z + primitive.radius, x: primitive.center.x},
        {z: primitive.center.z, x: primitive.center.x - primitive.radius},
        {z: primitive.center.z, x: primitive.center.x + primitive.radius},
      ]) {
        if (!include(point)) return null;
      }
      continue;
    }
    if (!include(primitive.start) || !include(primitive.end)) return null;
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      if (angleOnSweep(angle, primitive.startAngle, primitive.sweep)) {
        if (!include({
          z: primitive.center.z + Math.cos(angle) * primitive.radius,
          x: primitive.center.x + Math.sin(angle) * primitive.radius,
        })) return null;
      }
    }
  }
  if (!pointCount) return null;
  return {minZ, maxZ, minX, maxX, width: maxZ - minZ, height: maxX - minX};
}

/**
 * Authorize and map a kernel-produced STEP planar section into canonical
 * millimetre `{z, x}` lathe geometry. This function never accepts meshes or
 * tessellated polylines. The worker DTO contract is deliberately explicit:
 *
 * - `schemaVersion: 1`, `format: "step-section"`;
 * - exact `source`, resolved `sourceUnits`, millimetre `coordinateUnits`, and
 *   exact `kernel` name/version/buildHash;
 * - successful `import`, valid one-solid `topology`, and successful `section`,
 *   each with `maxToleranceMm` (section also has a diagnostics array);
 * - an echoed axis-aligned `section.plane` and ordered closed contours whose
 *   edges are only `GeomAbs_Line` or analytic `GeomAbs_Circle` records.
 */
export function mapStepSectionToLatheGeometry(dto, mapping, {limits: limitOverrides = {}} = {}) {
  const limits = boundedLimits(limitOverrides);
  const state = diagnosticCollector(limits.maxDiagnostics);
  if (!dto || typeof dto !== "object" || Array.isArray(dto)) {
    state.add("error", "step-dto-invalid", "STEP section worker output must be an object.");
    return failedResult(dto, null, null, null, null, state.diagnostics, state.suppressed);
  }
  if (dto.schemaVersion !== 1 || dto.format !== "step-section") {
    state.add("error", "step-schema-unsupported", "STEP section worker output must use schemaVersion 1 and format 'step-section'.");
  }
  const source = validateSource(dto, limits, state);
  const units = validateUnits(dto, state);
  const kernel = validateKernel(dto.kernel, limits, state);
  const normalizedMapping = validateMapping(mapping, limits, state);
  if (dto.authorized !== true) {
    state.add("error", "worker-authorization-required", "The STEP worker did not authorize this exact section result.");
  }

  if (!dto.import || typeof dto.import !== "object" || dto.import.succeeded !== true) {
    state.add("error", "step-import-failed", "The geometry kernel did not report a successful STEP transfer.");
  }
  const importToleranceMm = toleranceMaximum(dto.import, "import", state);
  ingestDiagnostics(dto.import, "import", limits, state, {required: true});

  if (!dto.topology || typeof dto.topology !== "object" || dto.topology.valid !== true) {
    state.add("error", "step-topology-invalid", "The imported STEP topology is not valid.");
  }
  if (dto.topology?.solidCount !== 1) {
    state.add("error", "step-solid-count-invalid", "STEP profile comparison requires exactly one valid solid.");
  }
  if (dto.topology?.ambiguous === true || dto.topology?.transformsResolved === false) {
    state.add("error", "step-topology-ambiguous", "STEP topology or assembly transforms remain ambiguous.");
  }
  const topologyToleranceMm = toleranceMaximum(dto.topology, "topology", state);
  ingestDiagnostics(dto.topology, "topology", limits, state, {required: true});

  const section = dto.section;
  if (!section || typeof section !== "object" || section.succeeded !== true) {
    state.add("error", "step-section-failed", "The geometry kernel did not report a successful planar section.");
  }
  if (section?.approximationUsed !== false) {
    state.add("error", "step-section-approximation", "STEP dimensional authorization requires approximationUsed to be explicitly false.");
  }
  if (section?.fuzzyToleranceMm !== undefined && section.fuzzyToleranceMm !== 0) {
    state.add("error", "step-section-fuzzy", "A nonzero fuzzy section tolerance is not authorized for dimensional comparison.");
  }
  const sectionToleranceMm = toleranceMaximum(section, "section", state);
  ingestDiagnostics(section, "section", limits, state, {required: true});
  ingestDiagnostics(dto, "worker", limits, state, {required: true});

  const plane = section?.plane;
  if (!plane || typeof plane !== "object" || !AXES.includes(plane.axis) || !finite(plane.offsetMm)) {
    state.add("error", "section-plane-invalid", "STEP section must echo a finite axis-aligned plane in millimetres.");
  } else if (normalizedMapping
    && (plane.axis !== normalizedMapping.planeAxis || plane.offsetMm !== normalizedMapping.planeOffsetMm)) {
    state.add("error", "section-plane-mapping-conflict", "The returned STEP section plane does not exactly match the requested mapping plane.");
  }

  const contours = section?.contours;
  if (!Array.isArray(contours) || contours.length === 0) {
    state.add("error", "section-contours-required", "STEP section contains no closed contours.");
  } else if (contours.length > limits.maxContours) {
    state.add("error", "section-contour-limit-exceeded", `STEP section exceeds the ${limits.maxContours}-contour safety limit.`);
  }
  let totalEdges = 0;
  if (Array.isArray(contours) && contours.length <= limits.maxContours) {
    for (const contour of contours) {
      if (Array.isArray(contour?.edges)) totalEdges += contour.edges.length;
      if (!Number.isSafeInteger(totalEdges) || totalEdges > limits.maxTotalEdges) break;
    }
    if (totalEdges > limits.maxTotalEdges) {
      state.add("error", "section-edge-limit-exceeded", `STEP section exceeds the ${limits.maxTotalEdges}-edge safety limit.`);
    }
  }
  const complexity = {
    contours: Array.isArray(contours) ? contours.length : 0,
    edges: totalEdges,
    limits,
  };

  if (!normalizedMapping || !Array.isArray(contours) || contours.length > limits.maxContours || totalEdges > limits.maxTotalEdges) {
    return failedResult(dto, source, kernel, units, normalizedMapping, state.diagnostics, state.suppressed, complexity);
  }
  const baseToleranceMm = importToleranceMm + topologyToleranceMm + sectionToleranceMm;
  if (!finite(baseToleranceMm)) {
    state.add("error", "step-tolerance-invalid", "STEP tolerance envelope is not finite.");
  }

  const processedContours = [];
  const contourIds = new Set();
  for (let index = 0; index < contours.length; index += 1) {
    const key = contourKey(contours[index]?.id);
    if (contourIds.has(key)) state.add("error", "duplicate-contour-id", `STEP section repeats contour id '${String(contours[index]?.id)}'.`);
    contourIds.add(key);
    const processed = processContour(contours[index], index, normalizedMapping, baseToleranceMm, limits, state);
    if (processed) processedContours.push(processed);
  }
  const selected = processedContours.find((contour) => contourKey(contour.id) === contourKey(normalizedMapping.selectedContourId));
  if (!selected) {
    state.add("error", "selected-contour-not-found", "The explicitly selected STEP contour is not present in the section result.");
  }

  const selectedPrimitives = selected?.primitives ?? [];
  const selectedMaximumUncertaintyMm = selectedPrimitives.reduce(
    (maximum, primitive) => Math.max(maximum, primitive.geometryUncertaintyMm),
    Number.NEGATIVE_INFINITY,
  );
  if (selectedPrimitives.some((primitive) => !finite(primitive.geometryUncertaintyMm) || primitive.geometryUncertaintyMm < 0)
    || !finite(selectedMaximumUncertaintyMm)
    || selectedMaximumUncertaintyMm > STEP_NUMERICAL_BUDGET_MM) {
    state.add(
      "error",
      "step-precision-budget-exceeded",
      `STEP section geometry cannot preserve the ${STEP_NUMERICAL_BUDGET_MM} mm numerical/tolerance budget.`,
    );
  }
  const blocking = state.diagnostics.some((diagnostic) => BLOCKING_DIAGNOSTIC_SEVERITIES.has(diagnostic.severity));
  if (blocking || !selected || !selectedPrimitives.length) {
    return failedResult(dto, source, kernel, units, normalizedMapping, state.diagnostics, state.suppressed, complexity);
  }

  const extractedProfile = normalizedMapping.profileSide === "positive"
    ? extractPositiveRadialProfile(selectedPrimitives, limits, state)
    : null;
  const primitives = normalizedMapping.profileSide === "positive" ? (extractedProfile?.primitives ?? []) : selectedPrimitives;
  const maximumUncertaintyMm = primitives.reduce(
    (maximum, primitive) => Math.max(maximum, primitive.geometryUncertaintyMm),
    Number.NEGATIVE_INFINITY,
  );
  if (state.diagnostics.some((diagnostic) => BLOCKING_DIAGNOSTIC_SEVERITIES.has(diagnostic.severity))
    || !primitives.length || !finite(maximumUncertaintyMm) || maximumUncertaintyMm > STEP_NUMERICAL_BUDGET_MM) {
    if (maximumUncertaintyMm > STEP_NUMERICAL_BUDGET_MM) {
      state.add("error", "profile-precision-budget-exceeded", `STEP machining-side extraction cannot preserve the ${STEP_NUMERICAL_BUDGET_MM} mm numerical/tolerance budget.`);
    }
    return failedResult(dto, source, kernel, units, normalizedMapping, state.diagnostics, state.suppressed, complexity);
  }

  const bounds = geometryBounds(primitives);
  if (!bounds || Object.values(bounds).some((value) => !finite(value))) {
    state.add("error", "step-bounds-invalid", "Mapped STEP section bounds cannot be represented as finite canonical geometry.");
    return failedResult(dto, source, kernel, units, normalizedMapping, state.diagnostics, state.suppressed, complexity);
  }
  const transform = {
    mapping: "explicit-step-principal-axes-to-lathe-z/radial-x",
    axialAxis: normalizedMapping.axialAxis,
    radialAxis: normalizedMapping.radialAxis,
    planeAxis: normalizedMapping.planeAxis,
    planeOffsetMm: normalizedMapping.planeOffsetMm,
    axialOriginMm: normalizedMapping.axialOriginMm,
    radialOriginMm: normalizedMapping.radialOriginMm,
    axialDirection: normalizedMapping.axialDirection,
    radialDirection: normalizedMapping.radialDirection,
    profileSide: normalizedMapping.profileSide,
  };
  const materialRegion = qualifyMaterialRegion({
    dto,
    section,
    contours,
    selected,
    selectedPrimitives,
    selectedMaximumUncertaintyMm,
    mapping: normalizedMapping,
    extractedProfile,
    maximumUncertaintyMm,
  });
  return {
    schemaVersion: 1,
    format: "step-section",
    coordinateSystem: "lathe-xz",
    source,
    sourceModel: dto,
    kernel,
    units: {
      source: units.sourceUnits,
      coordinates: units.coordinateUnits,
      target: {name: "millimeter", symbol: "mm", millimetersPerUnit: 1},
    },
    transform,
    selectedContourId: selected.id,
    entities: primitives,
    primitives,
    geometry: primitives,
    bounds,
    geometryUncertaintyMm: maximumUncertaintyMm,
    profile: extractedProfile ? {
      sourceContourId: selected.id,
      modelRadialSide: normalizedMapping.radialDirection,
      closed: extractedProfile.closed,
      endpoints: extractedProfile.endpoints,
      intersectionCount: extractedProfile.intersectionCount,
    } : null,
    materialRegion,
    diagnostics: state.diagnostics,
    diagnosticSummary: diagnosticSummary(state.diagnostics, state.suppressed),
    complexity,
    authorized: true,
  };
}

export const analyzeStepSection = mapStepSectionToLatheGeometry;
