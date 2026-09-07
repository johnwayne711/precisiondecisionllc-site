/**
 * Analytic, bounded Haas lathe G18 tool-nose compensation. Coordinates use the
 * engine convention: segment X is programmed X; native arc center X is radial.
 * The output reference is the NOSE CENTER, never a programmed contact point.
 *
 * Primary controller sources (no machine offsets inferred):
 * https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG42.html
 * https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG40.html
 * Haas NGC Lathe Operator's Manual 2017, printed pp. 134-136, 147-153.
 * Source PDF SHA-256: 98124284d1c94fa0b8ac811fadd98c0181339ab472fbc9ac5c23d78c2de6e035.
 * https://www.haascnc.com/content/dam/haascnc/en/service/manual/operator/english---lathe-ngc---operator%27s-manual---2017.pdf
 *
 * Supported bounded subset: linear entry/cancel, <=90-degree line-line joins,
 * tangent native line/arc and arc/arc joins. Non-tangent circular joins, loops,
 * collapsed inside arcs, I/K cancellation vectors and non-G18/cycle motion
 * remain blocked. This is nominal nose geometry, not a holder-clearance claim.
 */
export const LATHE_COMPENSATION_CONTRACT = "haas-lathe-ngc-nose-v1";
const PENDING = "tool-nose-compensation-pending";
const EPS = 1e-8;
const ANGLE_EPS = 1e-8;
const NUMERICAL_BUDGET_MM = 0.000001;
const vectorValues = new Set([-1, 0, 1]);
const finite = value => typeof value === "number" && Number.isFinite(value);
const add = (a, b) => ({z: a.z + b.z, x: a.x + b.x});
const sub = (a, b) => ({z: a.z - b.z, x: a.x - b.x});
const mul = (a, k) => ({z: a.z * k, x: a.x * k});
const dot = (a, b) => a.z * b.z + a.x * b.x;
const cross = (a, b) => a.z * b.x - a.x * b.z;
const norm = a => Math.hypot(a.z, a.x);
const distance = (a, b) => norm(sub(a, b));
const unit = a => mul(a, 1 / norm(a));
const point = (p, scale) => ({z: p.z, x: p.x * scale});
const programmed = (p, scale) => ({z: p.z, x: p.x / scale});
const validPoint = p => p && finite(p.z) && finite(p.x);
const samePoint = (a, b) => distance(a, b) <= EPS;
const clonePoint = p => p ? {...p} : p;

function noseRadiusArithmetic(config) {
  if (!finite(config?.noseRadiusMm) || !finite(config?.radiusWearMm)) return {radiusMm: NaN, radiusUncertaintyMm: Infinity};
  const radiusMm = config.noseRadiusMm + config.radiusWearMm;
  // Preserve representability and conversion error in BOTH original inputs.
  // Looking only at the small effective sum hides catastrophic cancellation.
  // Four ulps per operand/result conservatively covers declared numeric input,
  // one unit conversion and the final addition; physical wear is not measured.
  const radiusUncertaintyMm = [config.noseRadiusMm, config.radiusWearMm, radiusMm]
    .reduce((sum, value) => sum + Math.abs(value) * Number.EPSILON * 4, 0);
  return {radiusMm, radiusUncertaintyMm};
}

/** Validate explicit setup before confirmation; does not grant confirmation. */
export function noseCompensationSetupIssues(config) {
  const issues = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) return ["Explicit tool-nose compensation setup is required."];
  if (config.accepted !== true) issues.push("Accept the nominal tool-nose compensation contract explicitly.");
  if (config.contract !== LATHE_COMPENSATION_CONTRACT) issues.push("Select the supported Haas lathe nose-compensation contract.");
  if (typeof config.offsetRegister !== "string" || !/^\d{2}$/.test(config.offsetRegister) || config.offsetRegister === "00") issues.push("Specify the exact nonzero two-digit T offset register.");
  if (!finite(config.noseRadiusMm) || config.noseRadiusMm <= 0) issues.push("Enter a positive nose geometry radius in millimeters.");
  if (!finite(config.radiusWearMm)) issues.push("Enter radius wear explicitly, including zero when none is intended.");
  const {radiusMm: effective, radiusUncertaintyMm} = noseRadiusArithmetic(config);
  if (!finite(effective) || effective <= EPS) issues.push("The geometry radius plus radius wear must be positive.");
  if (!finite(radiusUncertaintyMm) || radiusUncertaintyMm > NUMERICAL_BUDGET_MM
    || effective - radiusUncertaintyMm <= EPS) issues.push("Original radius and wear magnitudes cannot retain the compensation numerical budget; their effective sum is not sufficiently resolved.");
  if (!vectorValues.has(config.tipDirection?.z) || !vectorValues.has(config.tipDirection?.x)
    || (!config.tipDirection.z && !config.tipDirection.x)) issues.push("Select the center-to-imaginary-tip direction explicitly.");
  if (!["od", "id"].includes(config.materialSide)) issues.push("Select OD or ID material explicitly.");
  if (!["positive-x", "negative-x"].includes(config.wallSide)) issues.push("Select the positive-X or negative-X cutting wall explicitly.");
  return issues;
}

/** Exact setup resolver used by the path transformer; parent confirmation is mandatory. */
export function resolveNoseCompensationSetup(assignment, segment = null) {
  const config = assignment?.noseCompensation;
  const messages = noseCompensationSetupIssues(config);
  if (assignment?.confirmed !== true) messages.push("Confirm this exact program-tool assignment before compensation.");
  const model = assignment?.cuttingModel;
  const odPoint = model?.mode === "point" && model.referenceSemantics === "programmed-contact-point";
  const idPoint = model?.mode === "nominal-lathe" && model.operation === "id-bore"
    && model.referenceSemantics === "nominal-cutter-datum";
  if (!odPoint && !idPoint) messages.push("Nose compensation requires an OD turning point or nominal ID-boring contact-point model.");
  if (model?.simulationReady !== true) messages.push("The selected tool's mounted cutting setup is not ready.");
  if (odPoint && config?.materialSide !== "od") messages.push("An OD turning tool cannot be confirmed as an ID nose model.");
  if (odPoint && config?.wallSide !== "positive-x") messages.push("The current OD turning models require the positive-X cutting wall.");
  if (idPoint && (config?.materialSide !== "id" || config.wallSide !== model.wallSide)) messages.push("The compensated ID wall must match the confirmed boring wall.");
  if (segment && (segment.compensation?.offsetRegister !== config?.offsetRegister)) messages.push("The active T offset register does not match this exact nose setup.");
  return {ready: messages.length === 0, messages, setup: messages.length ? null : {
    ...config, tipDirection: {...config.tipDirection}, ...noseRadiusArithmetic(config),
  }};
}

function geometrySnapshot(segment) {
  const geometry = segment.programmedGeometry || segment;
  return {
    type: geometry.type, start: clonePoint(geometry.start), end: clonePoint(geometry.end),
    ...(geometry.center ? {center: clonePoint(geometry.center)} : {}),
    ...(geometry.radius !== undefined ? {radius: geometry.radius} : {}),
    ...(geometry.sweep !== undefined ? {sweep: geometry.sweep} : {}),
    geometryUncertaintyMm: geometry.geometryUncertaintyMm ?? 0,
    points: geometry.points?.map(clonePoint),
  };
}

function fail(code, message) { throw Object.assign(new Error(message), {code}); }
function isArc(segment) { return segment.type === "arc-cw" || segment.type === "arc-ccw"; }
function tangent(curve, atEnd = false) {
  if (!curve.arc) return unit(sub(curve.end, curve.start));
  const radial = unit(sub(atEnd ? curve.end : curve.start, curve.center));
  return mul({z: -radial.x, x: radial.z}, Math.sign(curve.sweep));
}

function nativeCurve(segment, scale) {
  if (!validPoint(segment.start) || !validPoint(segment.end)) fail("tool-nose-geometry-missing", "Nose compensation requires resolved native endpoints.");
  const curve = {start: point(segment.start, scale), end: point(segment.end, scale), arc: isArc(segment)};
  if (!curve.arc) {
    if (!["linear", "rapid"].includes(segment.type)) fail("tool-nose-motion-unsupported", "Only explicit G18 linear and circular motion can receive nose compensation; cycles are not inferred.");
    if (distance(curve.start, curve.end) <= EPS) fail("tool-nose-zero-motion", "A zero-length compensation block cannot define a tangent.");
    return curve;
  }
  if (!validPoint(segment.center) || !finite(segment.radius) || segment.radius <= EPS
    || !finite(segment.sweep) || Math.abs(segment.sweep) <= ANGLE_EPS || Math.abs(segment.sweep) > Math.PI + ANGLE_EPS) {
    fail("tool-nose-arc-unsupported", "Compensation requires a resolved native circular arc of at most 180 degrees.");
  }
  curve.center = {...segment.center}; curve.radius = segment.radius; curve.sweep = segment.sweep;
  if (Math.abs(distance(curve.start, curve.center) - curve.radius) > NUMERICAL_BUDGET_MM
    || Math.abs(distance(curve.end, curve.center) - curve.radius) > NUMERICAL_BUDGET_MM) fail("tool-nose-arc-inconsistent", "Native arc endpoints do not match the analytic circle.");
  const angle = Math.atan2(curve.start.x - curve.center.x, curve.start.z - curve.center.z) + curve.sweep;
  const expected = add(curve.center, {z: curve.radius * Math.cos(angle), x: curve.radius * Math.sin(angle)});
  if (distance(expected, curve.end) > NUMERICAL_BUDGET_MM) fail("tool-nose-arc-inconsistent", "Native arc sweep does not reach its endpoint.");
  return curve;
}

function offsetCurve(curve, side, radius) {
  if (!curve.arc) {
    const direction = tangent(curve);
    const offset = mul({z: -direction.x, x: direction.z}, side * radius);
    return {...curve, start: add(curve.start, offset), end: add(curve.end, offset)};
  }
  const offsetRadius = curve.radius - side * Math.sign(curve.sweep) * radius;
  if (offsetRadius <= NUMERICAL_BUDGET_MM) fail("tool-nose-arc-collapsed", "The selected nose radius collapses or reverses the inside arc.");
  return {...curve, radius: offsetRadius,
    start: add(curve.center, mul(sub(curve.start, curve.center), offsetRadius / curve.radius)),
    end: add(curve.center, mul(sub(curve.end, curve.center), offsetRadius / curve.radius)),
  };
}

function joinCurves(previous, next, radius) {
  const a = tangent(previous, true), b = tangent(next);
  const cosine = dot(a, b), sine = cross(a, b);
  if (cosine < -ANGLE_EPS) fail("tool-nose-corner-unsupported", "Compensation turns over 90 degrees or reversals require controller-specific corner handling.");
  if (previous.arc || next.arc) {
    if (Math.abs(sine) > ANGLE_EPS || cosine < 1 - ANGLE_EPS || !samePoint(previous.end, next.start)) {
      fail("tool-nose-circular-join-unsupported", "Only tangent line/arc and arc/arc compensation joins are modeled.");
    }
    next.start = {...previous.end};
    return;
  }
  if (Math.abs(sine) <= ANGLE_EPS) {
    if (!samePoint(previous.end, next.start)) fail("tool-nose-join-gap", "Parallel compensated lines do not share an endpoint.");
    next.start = {...previous.end}; return;
  }
  const delta = sub(next.start, previous.end);
  const travel = cross(delta, b) / sine;
  const intersection = add(previous.end, mul(a, travel));
  if (distance(intersection, previous.end) > radius * 1.000001
    || distance(intersection, next.start) > radius * 1.000001
    || dot(sub(intersection, previous.start), a) <= EPS
    || dot(sub(next.end, intersection), b) <= EPS) {
    fail("tool-nose-corner-interference", "The nose compensation corner consumes or reverses an adjacent block.");
  }
  previous.end = intersection; next.start = {...intersection};
}

function sampleForDisplay(curve, scale) {
  if (!curve.arc) return [programmed(curve.start, scale), programmed(curve.end, scale)];
  // These points are display only; every downstream dimensional operation must
  // use center/radius/sweep. The analytic source is never rebuilt from pixels.
  const count = Math.max(2, Math.min(2048, Math.ceil(Math.abs(curve.sweep) * Math.sqrt(curve.radius / 0.001))));
  const startAngle = Math.atan2(curve.start.x - curve.center.x, curve.start.z - curve.center.z);
  return Array.from({length: count + 1}, (_, i) => programmed(i === 0 ? curve.start : i === count ? curve.end : add(curve.center, {
    z: curve.radius * Math.cos(startAngle + curve.sweep * i / count),
    x: curve.radius * Math.sin(startAngle + curve.sweep * i / count),
  }), scale));
}

function setupIdentity(setup) {
  return JSON.stringify([setup.contract, setup.offsetRegister, setup.noseRadiusMm, setup.radiusWearMm,
    setup.tipDirection.z, setup.tipDirection.x, setup.materialSide, setup.wallSide]);
}

function numericalErrorBound(segments, curves, setup, includeJoins = true) {
  const radius = setup.radiusMm;
  let magnitude = radius, condition = 1;
  for (const c of curves) {
    magnitude = Math.max(magnitude, Math.abs(c.start.z), Math.abs(c.start.x), Math.abs(c.end.z), Math.abs(c.end.x), c.radius || 0);
    condition = Math.max(condition, 1 + radius / (c.arc ? c.radius : Math.max(distance(c.start, c.end), EPS)));
  }
  if (includeJoins) for (let i = 2; i < curves.length - 1; i += 1) {
    if (curves[i - 1].arc || curves[i].arc) continue;
    const sine = Math.abs(cross(tangent(curves[i - 1], true), tangent(curves[i])));
    if (sine > ANGLE_EPS) condition = Math.max(condition, 1 / sine);
  }
  let sourceError = 0;
  for (const segment of segments) {
    const source = segment.programmedGeometry || segment;
    if (source.geometryUncertaintyMm !== undefined && (!finite(source.geometryUncertaintyMm) || source.geometryUncertaintyMm < 0)) fail("tool-nose-source-uncertainty", "The native source uncertainty is unresolved.");
    sourceError = Math.max(sourceError, source.geometryUncertaintyMm || 0);
  }
  // Propagate input error through normal/radius construction and miter division;
  // 128 ulps covers the bounded scalar/vector arithmetic chain. This is the
  // scale-specific error bound, not the maximum permitted acceptance budget.
  const error = condition * (sourceError * 4 + setup.radiusUncertaintyMm * 4 + (magnitude + radius) * Number.EPSILON * 128);
  if (!finite(error) || error > NUMERICAL_BUDGET_MM) fail("tool-nose-numerical-conditioning", "Source uncertainty or coordinate conditioning exceeds the compensation numerical budget.");
  return error;
}

function circleEnvelope(setup) {
  return {
    kind: "nose-circle", radiusMm: setup.radiusMm, centerIsProgramReference: true,
    referenceSemantics: "nose-center", materialSide: setup.materialSide, wallSide: setup.wallSide,
    contract: LATHE_COMPENSATION_CONTRACT, verified: true,
    noseRadiusMm: setup.noseRadiusMm, radiusWearMm: setup.radiusWearMm,
    radiusUncertaintyMm: setup.radiusUncertaintyMm,
    tipDirection: {...setup.tipDirection}, offsetRegister: setup.offsetRegister,
    physicalAccuracyQualified: false, holderClearanceVerified: false,
  };
}

function nonTurning(segment) {
  return segment.machiningMode === "live-tool" || segment.liveTool === true || segment.cAxisMotion
    || (segment.plane && !["G18", "xz", "XZ"].includes(segment.plane))
    || [segment.start, segment.end, ...(segment.points || [])].some(p => finite(p?.y) || finite(p?.c));
}

function transformOffSegment(segment, scale, assignment) {
  if (segment.compensation?.contract !== LATHE_COMPENSATION_CONTRACT
    || segment.compensation?.controller !== "haas-lathe-ngc"
    || segment.compensation.mode !== "off") fail("tool-nose-controller-required", "Off-mode nose geometry requires an explicit parser-provided Haas controller and T offset context.");
  if (segment.verificationBlocked || segment.verificationIssues?.length) fail("tool-nose-source-blocked", "Uncertain off-mode motion cannot establish a physical nose-center sweep.");
  const result = resolveNoseCompensationSetup(assignment, segment);
  if (!result.ready) fail("tool-nose-setup-required", result.messages.join(" "));
  const source = geometrySnapshot(segment), curve = nativeCurve(source, scale), setup = result.setup;
  const errorBound = numericalErrorBound([segment], [curve], setup, false);
  const shift = mul(setup.tipDirection, -setup.radiusMm);
  const translated = {...curve, start: add(curve.start, shift), end: add(curve.end, shift),
    ...(curve.arc ? {center: add(curve.center, shift)} : {}),
  };
  return {
    ...segment, ...source, start: programmed(translated.start, scale), end: programmed(translated.end, scale),
    ...(curve.arc ? {center: {...translated.center}} : {}),
    // Preserve any explicit rapid dogleg; only translating its reference frame.
    points: source.points?.length ? source.points.map(p => programmed(add(point(p, scale), shift), scale)) : sampleForDisplay(translated, scale),
    programmedGeometry: source, compensationPending: false, compensationResolved: true,
    compensation: {...segment.compensation, resolved: true, noseRadiusMm: setup.radiusMm},
    geometryUncertaintyMm: errorBound, cutterEnvelope: circleEnvelope(setup),
  };
}

function transformRegion(region, scale, setupResolver) {
  if (region[0].compensation?.event !== "start" || region.at(-1).compensation?.event !== "cancel" || region.length < 3) {
    fail("tool-nose-entry-exit-required", "Use a linear G41/G42 approach, at least one compensated block, and a linear G40 departure.");
  }
  const mode = region[0].compensation.mode;
  if (!["left", "right"].includes(mode)) fail("tool-nose-side-required", "Compensation must explicitly select G41 left or G42 right.");
  const setups = region.map(segment => {
    const metadata = segment.compensation;
    if (metadata?.contract !== LATHE_COMPENSATION_CONTRACT || metadata.controller !== "haas-lathe-ngc") fail("tool-nose-controller-required", "This compensation geometry requires the explicit Haas lathe controller contract.");
    if (segment.verificationIssues?.some(code => code !== PENDING)) fail("tool-nose-source-blocked", "An independent source-motion uncertainty blocks this compensation region.");
    if (segment.verificationBlocked === true && !segment.verificationIssues?.includes(PENDING)) fail("tool-nose-source-blocked", "The source motion is blocked for an unresolved reason.");
    if (segment.plane && !["G18", "xz", "XZ"].includes(segment.plane)) fail("tool-nose-plane-unsupported", "Only explicit G18 turning-plane compensation is supported.");
    if (metadata.cancelVector || metadata.i !== undefined || metadata.k !== undefined) fail("tool-nose-cancel-vector-unsupported", "G40 I/K departure vectors require a separate controller construction.");
    const result = resolveNoseCompensationSetup(setupResolver(segment), segment);
    if (!result.ready) fail("tool-nose-setup-required", result.messages.join(" "));
    return result.setup;
  });
  const setup = setups[0];
  if (setups.some(item => setupIdentity(item) !== setupIdentity(setup)) || region.some(segment => segment.toolKey !== region[0].toolKey)) {
    fail("tool-nose-tool-change", "Cancel compensation before changing the exact tool, offset register or nose setup.");
  }
  if (region.slice(1, -1).some(segment => segment.compensation.mode !== mode || segment.compensation.event !== "active")) {
    fail("tool-nose-mode-change", "Cancel compensation before switching G41/G42 sides or starting it again.");
  }
  const source = region.map(segment => geometrySnapshot(segment));
  const curves = source.map(segment => nativeCurve(segment, scale));
  if (curves[0].arc || curves.at(-1).arc) fail("tool-nose-linear-entry-exit", "G41/G42 entry and G40 departure must be linear moves.");
  for (let i = 1; i < curves.length; i += 1) {
    if (!samePoint(curves[i - 1].end, curves[i].start)) fail("tool-nose-source-discontinuity", "Compensation cannot bridge a discontinuity in commanded motion.");
  }
  const errorBound = numericalErrorBound(region, curves, setup);
  const compensated = curves.map((curve, index) => index === 0 || index === curves.length - 1 ? {...curve} : offsetCurve(curve, mode === "left" ? 1 : -1, setup.radiusMm));
  for (let i = 2; i < compensated.length - 1; i += 1) joinCurves(compensated[i - 1], compensated[i], setup.radiusMm);
  // Restrict entry to a tangent approach. This makes Type-A/B startup behavior
  // identical; do not silently pick one of their non-tangent corner strategies.
  const incoming = tangent(curves[0], true), first = tangent(curves[1]);
  if (Math.abs(cross(incoming, first)) > ANGLE_EPS || dot(incoming, first) < 1 - ANGLE_EPS) fail("tool-nose-entry-tangent-required", "This bounded contract requires a tangent linear approach to the first compensated block.");
  if (distance(curves[0].start, curves[0].end) < setup.radiusMm - EPS
    || distance(curves.at(-1).start, curves.at(-1).end) < setup.radiusMm - EPS) fail("tool-nose-lead-too-short", "Approach and departure lengths must be at least the effective nose radius.");
  const tipVector = mul(setup.tipDirection, setup.radiusMm);
  compensated[0].start = sub(curves[0].start, tipVector);
  compensated[0].end = {...compensated[1].start};
  compensated.at(-1).start = {...compensated.at(-2).end};
  compensated.at(-1).end = sub(curves.at(-1).end, tipVector);
  if (dot(sub(compensated[0].end, compensated[0].start), incoming) <= EPS
    || dot(sub(compensated.at(-1).end, compensated.at(-1).start), tangent(curves.at(-1))) <= EPS) fail("tool-nose-lead-reversal", "The selected imaginary-tip orientation makes the compensated approach or departure reverse.");
  return region.map((segment, index) => {
    const curve = compensated[index];
    const issues = (segment.verificationIssues || []).filter(code => code !== PENDING);
    return {
      ...segment, ...source[index], start: programmed(curve.start, scale), end: programmed(curve.end, scale),
      ...(curve.arc ? {center: {...curve.center}, radius: curve.radius, sweep: curve.sweep} : {}),
      points: sampleForDisplay(curve, scale), programmedGeometry: source[index],
      compensationPending: false, compensationResolved: true,
      compensation: {...segment.compensation, resolved: true, noseRadiusMm: setup.radiusMm},
      verificationIssues: issues, verificationBlocked: issues.length > 0,
      geometryUncertaintyMm: errorBound, cutterEnvelope: circleEnvelope(setup),
    };
  });
}

/**
 * Transform complete G41/G42..G40 regions atomically. A failed region retains
 * exact commanded geometry and stays blocked; independent later regions may
 * still be resolved. Unrequested legacy paths are unchanged.
 */
export function compensateLathePath(segments, {xScale, setupResolver} = {}) {
  if (!Array.isArray(segments)) return {status: "blocked", segments: [], issues: [{code: "tool-nose-path-required", message: "A native segment array is required."}], modeledCount: 0};
  const output = [], issues = [];
  let modeledCount = 0, requested = false;
  const restoreUnrequested = segment => {
    if (!segment.cutterEnvelope && segment.compensationResolved !== true && segment.compensation?.resolved !== true) return segment;
    if (!segment.programmedGeometry) fail("tool-nose-original-geometry-missing", "Revoked nose geometry has no preserved commanded path; it cannot fall back to contact-point cutting.");
    const restored = {...segment, ...geometrySnapshot(segment)};
    delete restored.cutterEnvelope;
    delete restored.compensationResolved;
    delete restored.compensationPending;
    if (restored.compensation) {
      restored.compensation = {...restored.compensation};
      delete restored.compensation.resolved;
      delete restored.compensation.noseRadiusMm;
    }
    return restored;
  };
  const blocked = (region, error) => {
    const code = error.code || "tool-nose-transform-failed";
    issues.push({code, message: error.message, line: region[0].line, executionLine: region[0].executionLine, toolKey: region[0].toolKey});
    output.push(...region.map(segment => {
      const restored = {...segment, ...geometrySnapshot(segment), compensationResolved: false,
        ...(segment.compensation ? {compensation: {...segment.compensation, resolved: false}} : {}),
        verificationBlocked: true, verificationIssues: [...new Set([...(segment.verificationIssues || []), code])],
      };
      delete restored.cutterEnvelope;
      return restored;
    }));
  };
  for (let i = 0; i < segments.length;) {
    if (!segments[i].compensation || (segments[i].compensation.mode === "off" && segments[i].compensation.event !== "cancel")) {
      const segment = segments[i++];
      try {
        if (nonTurning(segment) || typeof setupResolver !== "function") {output.push(restoreUnrequested(segment)); continue;}
        const assignment = setupResolver(segment);
        if (assignment?.noseCompensation?.accepted !== true) {output.push(restoreUnrequested(segment)); continue;}
        requested = true;
        if (![0.5, 1].includes(xScale)) fail("tool-nose-x-scale-required", "Select diameter or radius X programming explicitly.");
        output.push(transformOffSegment(segment, xScale, assignment)); modeledCount += 1;
      } catch (error) {blocked([segment], error);}
      continue;
    }
    requested = true;
    const region = [segments[i++]];
    while (region.at(-1).compensation.event !== "cancel" && i < segments.length && segments[i].compensation) region.push(segments[i++]);
    try {
      if (![0.5, 1].includes(xScale)) fail("tool-nose-x-scale-required", "Select diameter or radius X programming explicitly.");
      if (typeof setupResolver !== "function") fail("tool-nose-setup-required", "An exact program-tool setup resolver is required.");
      const resolved = transformRegion(region, xScale, setupResolver);
      output.push(...resolved); modeledCount += resolved.length;
    } catch (error) {
      blocked(region, error);
    }
  }
  return {status: issues.length ? "blocked" : requested ? "ready" : "not-requested", segments: output, issues, modeledCount};
}
