/**
 * Exact principal-axis setup helpers for the solid-first STEP workflow.
 *
 * Face origins/directions must come from the analytic kernel face, never its
 * triangles or screen coordinates. Helpers return new mapping values and do
 * not transform or modify the imported source geometry. Selecting the intended
 * spindle face, longitudinal plane, and program-zero face is a user decision.
 */
const AXES = Object.freeze(["x", "y", "z"]);
export const SOLID_SETUP_COORDINATE_LIMIT_MM = 1e9;

export const PRINCIPAL_PLANES = Object.freeze([
  Object.freeze({id: "xy", label: "XY plane", normalAxis: "z", axes: Object.freeze(["x", "y"])}),
  Object.freeze({id: "xz", label: "XZ plane", normalAxis: "y", axes: Object.freeze(["x", "z"])}),
  Object.freeze({id: "yz", label: "YZ plane", normalAxis: "x", axes: Object.freeze(["y", "z"])}),
]);

function requireAxis(axis, label) {
  if (!AXES.includes(axis)) throw new Error(`Choose an explicit model X, Y, or Z ${label}.`);
  return axis;
}

function requireCoordinate(value, label) {
  if (!Number.isFinite(value) || Math.abs(value) > SOLID_SETUP_COORDINATE_LIMIT_MM) {
    throw new Error(`${label} must be a finite coordinate within the supported model range.`);
  }
  return value;
}

function requirePoint(point, label) {
  if (!point || typeof point !== "object") throw new Error(`${label} requires explicit X, Y, and Z coordinates.`);
  for (const axis of AXES) requireCoordinate(point[axis], `${label} ${axis.toUpperCase()}`);
  return point;
}

/**
 * Return the sole nonzero coordinate axis, or null if not exactly principal.
 * Even tiny off-axis components reject: snapping a near-parallel imported face
 * would move its geometry by a size-dependent amount without authority.
 * Direction vectors need not be unit length; their sign is retained separately.
 */
export function principalAxis(vector) {
  if (!vector || !AXES.every((axis) => Number.isFinite(vector[axis]))) return null;
  const nonzero = AXES.filter((axis) => vector[axis] !== 0);
  return nonzero.length === 1 ? nonzero[0] : null;
}

function longitudinalAxes(axialAxis, normalAxis) {
  requireAxis(axialAxis, "spindle axis");
  requireAxis(normalAxis, "section-plane normal");
  if (axialAxis === normalAxis) {
    throw new Error("Choose a longitudinal plane containing the spindle axis, not a cross section perpendicular to it.");
  }
  return {axialAxis, radialAxis: AXES.find((axis) => axis !== axialAxis && axis !== normalAxis), normalAxis};
}

/** Manual fallback: no face or bounding-box center is inferred. */
export function manualPrincipalSetup({axialAxis, normalAxis, spindleCenterMm} = {}) {
  const axes = longitudinalAxes(axialAxis, normalAxis);
  const center = requirePoint(spindleCenterMm, "Explicit spindle center");
  return {
    ...axes,
    planeOffsetMm: center[normalAxis],
    radialOriginMm: center[axes.radialAxis],
  };
}

/**
 * A selected exact cylindrical face establishes the axis line, not Z0 or +Z.
 * Reversing the cylinder's parameter-axis direction does not choose a machine
 * direction. Only the selected Z0 datum face (or explicit manual sign) does that.
 */
export function setupFromCylinder(face, {normalAxis} = {}) {
  if (face?.kind !== "cylinder") throw new Error("Select a cylindrical face to establish the spindle axis.");
  const axialAxis = principalAxis(face.axis);
  if (!axialAxis) throw new Error("This cylinder is not exactly aligned with model X, Y, or Z. Angled spindle setup is not supported yet.");
  if (!Number.isFinite(face.radiusMm) || face.radiusMm <= 0 || face.radiusMm > SOLID_SETUP_COORDINATE_LIMIT_MM) {
    throw new Error("The selected cylinder must have a finite positive analytic radius within the supported coordinate range.");
  }
  return manualPrincipalSetup({axialAxis, normalAxis, spindleCenterMm: face.origin});
}

/**
 * A selected planar face or shoulder establishes program Z0 and the direction of
 * program +Z, away from the part. `normal` must be the outward, orientation-
 * corrected analytic face normal, not a mesh normal or an arbitrary plane axis.
 */
export function setupFromFrontFace(face, axialAxis) {
  requireAxis(axialAxis, "spindle axis");
  if (face?.kind !== "plane") throw new Error("Select a planar face or shoulder to establish program Z0.");
  if (principalAxis(face.normal) !== axialAxis) {
    throw new Error("The Z0 face or shoulder must be exactly perpendicular to the selected spindle axis.");
  }
  const origin = requirePoint(face.origin, "Analytic front-face origin");
  return {axialOriginMm: origin[axialAxis], axialDirection: Math.sign(face.normal[axialAxis])};
}

/**
 * Switch between the two supported planes through the existing spindle line.
 * The previous plane offset and radial origin supply both perpendicular center
 * coordinates exactly; no mesh, box center, rounding, or implicit zero is used.
 * Other mapping fields are retained, but the caller must invalidate the prior
 * section/contour and comparison because their plane and radial axis changed.
 */
export function changeLongitudinalPlane(setup, normalAxis) {
  const previousAxes = longitudinalAxes(setup?.axialAxis, setup?.normalAxis);
  if (setup.radialAxis !== previousAxes.radialAxis) throw new Error("The existing setup must have three distinct principal axes.");
  requireCoordinate(setup.planeOffsetMm, "Existing section-plane coordinate");
  requireCoordinate(setup.radialOriginMm, "Existing spindle radial coordinate");
  const nextAxes = longitudinalAxes(setup.axialAxis, normalAxis);
  const center = {
    [setup.normalAxis]: setup.planeOffsetMm,
    [setup.radialAxis]: setup.radialOriginMm,
  };
  return {
    ...setup,
    ...nextAxes,
    planeOffsetMm: center[normalAxis],
    radialOriginMm: center[nextAxes.radialAxis],
  };
}
