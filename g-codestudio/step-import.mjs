const TAU = Math.PI * 2;
const AXES = Object.freeze(["x", "y", "z"]);
const BLOCKING_DIAGNOSTIC_SEVERITIES = new Set(["error", "warning"]);
const ROUNDING_ULPS = 512;
const TRIG_ROUNDING_ULPS = 128;

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

function normalizeAngle(angle) {
  const result = angle % TAU;
  return result < 0 ? result + TAU : result;
}

function angleOnSweep(angle, startAngle, sweep) {
  if (sweep >= 0) return normalizeAngle(angle - startAngle) <= sweep;
  return normalizeAngle(startAngle - angle) <= -sweep;
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

  const primitives = selected?.primitives ?? [];
  const maximumUncertaintyMm = primitives.reduce(
    (maximum, primitive) => Math.max(maximum, primitive.geometryUncertaintyMm),
    Number.NEGATIVE_INFINITY,
  );
  if (primitives.some((primitive) => !finite(primitive.geometryUncertaintyMm) || primitive.geometryUncertaintyMm < 0)
    || !finite(maximumUncertaintyMm)
    || maximumUncertaintyMm > STEP_NUMERICAL_BUDGET_MM) {
    state.add(
      "error",
      "step-precision-budget-exceeded",
      `STEP section geometry cannot preserve the ${STEP_NUMERICAL_BUDGET_MM} mm numerical/tolerance budget.`,
    );
  }
  const blocking = state.diagnostics.some((diagnostic) => BLOCKING_DIAGNOSTIC_SEVERITIES.has(diagnostic.severity));
  if (blocking || !selected || !primitives.length) {
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
  };
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
    diagnostics: state.diagnostics,
    diagnosticSummary: diagnosticSummary(state.diagnostics, state.suppressed),
    complexity,
    authorized: true,
  };
}

export const analyzeStepSection = mapStepSectionToLatheGeometry;
