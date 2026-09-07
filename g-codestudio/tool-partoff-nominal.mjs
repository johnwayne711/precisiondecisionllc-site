// A separately declared nominal section, NOT a mesh-derived physical cutter.
// The manufacturer publishes W/RR; neither chipbreaker CAD, seat fit nor a
// machine's actual edge preparation/offset is replaced by this idealization.
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const A4C0405N00CF02_NOMINAL_SECTION = deepFreeze({
  id: "kennametal-a4c0405n00cf02-nominal-working-section-v1",
  units: "mm",
  manufacturer: "Kennametal",
  materialNumber: "2234816",
  catalogId: "A4C0405N00CF02",
  width: 4.12,
  cornerRadius: 0.2,
  cornerSides: ["negative-z", "positive-z"],
  source: {
    productUrl: "https://www.kennametal.com/us/en/products/p.a4c-n-cf.2234816.html",
    drawingUrl: "https://images.kennametal.com/is/image/Kennametal/109372717",
    widthField: "W",
    radiusField: "RR",
    manufacturerPublishedInches: {width: 0.162, cornerRadius: 0.008},
    note: "Canonical 4.12/0.2 mm use the published metric nominal values; the inch table values are rounded, not alternate dimensions.",
  },
  referenceSemantics: "Explicit virtual intersection of the nominal front line and selected axial edge, or front-line center; physical radius X, no diameter conversion.",
  tipDatumChoices: ["negative-z-edge", "center", "positive-z-edge"],
  assumptions: [
    "The user explicitly chooses an ideal neutral part-off working section: straight front and two tangent circular corners.",
    "W and RR describe this idealized working-plane section, not the supplied chipbreaker edge's 3D B-splines/ellipses.",
    "The programmed radial reference is the nominal front line; the selected axial datum is a virtual sharp corner or front-line center.",
  ],
  physicalAccuracyQualified: false,
  mountedDatumQualified: false,
  stockRemovalAuthority: false,
  collisionAuthority: false,
});

const DATUMS = new Set(A4C0405N00CF02_NOMINAL_SECTION.tipDatumChoices);

// No implicit datum, mounting or interpretation: consumers must explicitly
// accept the nominal-section contract independently of selecting an SKU.
export function buildA4cNominalPartoffSection({tipDatum, acceptNominalSection, referencePoint} = {}) {
  const errors = [];
  if (acceptNominalSection !== true) errors.push("Explicit nominal-section acceptance is required.");
  if (!DATUMS.has(tipDatum)) errors.push("Choose the negative-Z edge, center or positive-Z edge datum.");
  if (!referencePoint || !Number.isFinite(referencePoint.z) || !Number.isFinite(referencePoint.x)) {
    errors.push("A finite programmed reference in millimeters and physical radius is required.");
  }
  if (errors.length) return {valid: false, errors};
  const {width, cornerRadius: radius} = A4C0405N00CF02_NOMINAL_SECTION;
  const leftOffset = tipDatum === "negative-z-edge" ? 0 : tipDatum === "center" ? -width / 2 : -width;
  const left = referencePoint.z + leftOffset, right = left + width;
  const front = referencePoint.x, back = front + radius;
  const lower = {z: left, x: back}, leftTangent = {z: left + radius, x: front};
  const rightTangent = {z: right - radius, x: front}, upper = {z: right, x: back};
  // Avoid treating huge translated coordinates that swallow an actual feature
  // as a valid circle/line. This is representability, not physical accuracy.
  if (![left, right, front, back].every(Number.isFinite)
    || Math.abs((right - left) - width) > 1e-9
    || Math.abs((back - front) - radius) > 1e-9) {
    return {valid: false, errors: ["Nominal section coordinates cannot preserve its dimensions."]};
  }
  return deepFreeze({
    valid: true,
    errors: [],
    id: A4C0405N00CF02_NOMINAL_SECTION.id,
    semantics: "idealized-nominal-working-section-only",
    units: "mm",
    width,
    cornerRadius: radius,
    tipDatum,
    referencePoint: {z: referencePoint.z, x: referencePoint.x},
    axialOffsets: {minimum: leftOffset, maximum: leftOffset + width},
    bounds: {minimumZ: left, maximumZ: right, minimumX: front, maximumX: back},
    // Angles use ordinary (Z, physical-X) axes; each arc progresses CCW.
    frontBoundary: [
      {kind: "arc", from: lower, to: leftTangent, center: {z: left + radius, x: back}, radius,
        startAngle: Math.PI, sweepAngle: Math.PI / 2},
      {kind: "line", from: leftTangent, to: rightTangent},
      {kind: "arc", from: rightTangent, to: upper, center: {z: right - radius, x: back}, radius,
        startAngle: Math.PI * 1.5, sweepAngle: Math.PI / 2},
    ],
    // Only the leading section is defined. No invented back closure or depth.
    closedBody: false,
    maximumCuttingDepth: null,
    stockRemovalAuthority: false,
    collisionAuthority: false,
    physicalAccuracyQualified: false,
  });
}

// Analytic leading-edge support for this nominal section; no tessellation.
// Null outside the width means "no section", not X=0 or an unbounded cutter.
export function nominalPartoffFrontRadius(section, axialZ) {
  if (!section?.valid || section.id !== A4C0405N00CF02_NOMINAL_SECTION.id
    || !Number.isFinite(axialZ)) return null;
  const {minimumZ: left, maximumZ: right, minimumX: front} = section.bounds;
  if (axialZ < left || axialZ > right) return null;
  const radius = section.cornerRadius;
  const sideDistance = Math.min(axialZ - left, right - axialZ);
  if (sideDistance >= radius) return front;
  const delta = radius - sideDistance;
  // factored radicand avoids cancellation of radius^2 - delta^2 near the edge.
  return front + radius - Math.sqrt(Math.max(0, (radius - delta) * (radius + delta)));
}
