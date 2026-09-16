import {
  millingToolGeometryMm,
  millingToolLibraryRecordByCatalogNumber,
  millingToolLibraryRecordById,
} from "./milling-tool-library.mjs";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function resolveRecord(recordOrId) {
  if (recordOrId && typeof recordOrId === "object" && !Array.isArray(recordOrId)) {
    const resolved = millingToolLibraryRecordById(recordOrId.id);
    if (resolved === recordOrId) return resolved;
  }
  const value = String(recordOrId ?? "");
  const record = millingToolLibraryRecordById(value)
    || millingToolLibraryRecordByCatalogNumber(value);
  if (!record) throw new RangeError(`Unknown milling-tool record: ${value || "(empty)"}`);
  return record;
}

function finite(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new RangeError(`${label} must be finite.`);
  return numeric;
}

function svgPoint({axisMm, radiusMm}) {
  return {x: finite(axisMm, "Tool axis coordinate"), y: -finite(radiusMm, "Tool radius coordinate")};
}

function mirroredProfile(profile) {
  return [
    ...profile,
    ...profile.slice().reverse().map(({axisMm, radiusMm}) => ({axisMm, radiusMm: -radiusMm})),
  ];
}

function line(role, start, end, extra = {}) {
  return {type: "line", role, start, end, ...extra};
}

function polyline(role, points, extra = {}) {
  return {type: "polyline", role, points, ...extra};
}

function polygon(role, points, extra = {}) {
  return {type: "polygon", role, points, closed: true, ...extra};
}

function profilePointData(record, schematic) {
  if (record.profile === "drill-point") {
    return {
      type: "drill-point-apex",
      pointAngleDegrees: record.normalizedDimensionsMm.pointAngleDegrees,
      pointLengthMm: schematic.pointLengthMm,
    };
  }
  if (record.profile === "ball") {
    return {
      type: "ball-end-mill-apex",
      ballRadiusMm: record.normalizedDimensionsMm.cutterDiameter / 2,
    };
  }
  return {type: "flat-end-mill-tip"};
}

function dimensionData(record, schematic) {
  const dimensions = record.normalizedDimensionsMm;
  const cuttingLengthMm = dimensions.lengthOfCut ?? dimensions.fluteLength;
  return {
    cutterDiameterMm: dimensions.cutterDiameter,
    shankDiameterMm: dimensions.shankDiameter,
    lengthOfCutMm: dimensions.lengthOfCut ?? null,
    fluteLengthMm: dimensions.fluteLength ?? null,
    cuttingLengthMm,
    cuttingLengthKind: dimensions.fluteLength === undefined ? "length-of-cut" : "flute-length",
    overallLengthMm: dimensions.overallLength,
    point: profilePointData(record, schematic),
  };
}

/**
 * Return concise UI labels for the independent authority carried by a milling
 * catalog record. These labels deliberately keep cutter display/demo scope
 * separate from driven-unit mounting, holder, and collision authority.
 */
export function millingToolPreviewClaimLabels(recordOrId) {
  const record = resolveRecord(recordOrId);
  const eligible = record.demoCuttingEligibility?.eligible === true;
  return deepFreeze([
    {id: "dimensions", label: "MANUFACTURER-PUBLISHED DIMENSIONS", state: "available", tone: "source"},
    {id: "schematic", label: "ORIGINAL DIMENSION-DRIVEN SCHEMATIC", state: "available", tone: "display"},
    {
      id: "demo-cutting",
      label: eligible ? "BOUNDED DEMO CUTTING ELIGIBLE" : "BROWSE-ONLY CUTTER",
      state: eligible ? "bounded" : "blocked",
      tone: eligible ? "warning" : "blocked",
    },
    {id: "mounting", label: "MOUNTING TRANSFORM UNKNOWN", state: "blocked", tone: "blocked"},
    {id: "holder", label: "DRIVEN HOLDER NOT INCLUDED", state: "blocked", tone: "blocked"},
    {id: "collision", label: "COLLISION AUTHORITY UNAVAILABLE", state: "blocked", tone: "blocked"},
  ]);
}

/**
 * Build an SVG-ready, source-scale view model from the catalog's original
 * parametric schematic. Manufacturer artwork/CAD is never copied into this
 * model. SVG coordinates use X along the tool axis and Y across its diameter.
 */
export function millingToolPreviewViewModel(recordOrId, {paddingRatio = 0.06, paddingMm = null} = {}) {
  const record = resolveRecord(recordOrId);
  const schematic = millingToolGeometryMm(record);
  const dimensions = dimensionData(record, schematic);
  const maximumRadiusMm = Math.max(
    dimensions.cutterDiameterMm / 2,
    dimensions.shankDiameterMm / 2,
  );
  const requestedPadding = paddingMm === null
    ? Math.max(maximumRadiusMm * 0.35, dimensions.overallLengthMm * finite(paddingRatio, "Padding ratio"))
    : finite(paddingMm, "Preview padding");
  if (requestedPadding < 0) throw new RangeError("Preview padding cannot be negative.");

  const cuttingOutline = mirroredProfile(schematic.cuttingProfile).map(svgPoint);
  const shankOutline = mirroredProfile(schematic.shankProfile).map(svgPoint);
  const overallOutline = schematic.outline.map(svgPoint);
  const halfSpan = maximumRadiusMm + requestedPadding;
  const cuttingBoundaryAxis = dimensions.cuttingLengthMm;
  const cutterHalfDiameter = dimensions.cutterDiameterMm / 2;
  const shankHalfDiameter = dimensions.shankDiameterMm / 2;

  const primitives = [
    polygon("overall-envelope", overallOutline, {claim: "original-parametric-schematic"}),
    polyline("cutting-envelope", cuttingOutline, {closed: true, claim: "manufacturer-published-dimensions"}),
    polyline("shank-envelope", shankOutline, {closed: true, claim: "manufacturer-published-dimensions"}),
    line("centerline", {x: 0, y: 0}, {x: dimensions.overallLengthMm, y: 0}, {dash: [3, 3]}),
    line(
      dimensions.cuttingLengthKind,
      {x: cuttingBoundaryAxis, y: -Math.max(cutterHalfDiameter, shankHalfDiameter)},
      {x: cuttingBoundaryAxis, y: Math.max(cutterHalfDiameter, shankHalfDiameter)},
      {dash: [2, 2]},
    ),
    line("tool-tip-reference", {x: 0, y: -Math.max(1, maximumRadiusMm * 0.2)}, {x: 0, y: Math.max(1, maximumRadiusMm * 0.2)}),
  ];

  return deepFreeze({
    kind: "milling-tool-preview-view-model",
    recordRef: {id: record.id, revision: record.revision, revisionRef: record.revisionRef},
    geometryRevisionRef: record.geometryRevisionRef,
    title: `${record.manufacturer} ${record.catalogNumber} · ${record.profile}`,
    identity: {
      manufacturer: record.manufacturer,
      catalogNumber: record.catalogNumber,
      name: record.name,
      family: record.family,
      profile: record.profile,
      flutes: record.flutes,
    },
    sourceRefs: [...record.sourceRefs],
    units: "mm",
    coordinateSystem: {
      x: "tool-axis-from-tip-toward-shank",
      y: "diameter-cross-section",
      origin: "tool-tip-axis-center",
    },
    viewBox: {
      x: -requestedPadding,
      y: -halfSpan,
      width: dimensions.overallLengthMm + requestedPadding * 2,
      height: halfSpan * 2,
    },
    dimensions,
    primitives,
    claims: millingToolPreviewClaimLabels(record),
    notice: record.demoCuttingEligibility?.eligible === true
      ? record.demoCuttingEligibility.blockedOutsideScope
      : record.demoCuttingEligibility?.blockedReason,
    manufacturerArtworkUsed: false,
    manufacturerCadUsed: false,
    mountingGeometryIncluded: false,
    holderGeometryIncluded: false,
    collisionGeometryIncluded: false,
  });
}

/**
 * Adapt an explicitly eligible milling seed to the high-level definition
 * contract consumed by the app's 2D tool-assembly code. The returned geometry
 * describes only the cutter and shank in the cutter's local axial coordinate
 * system. Placement still needs a separately proven live-tool transform.
 */
export function adaptEligibleMillingToolTo2dAssembly(recordOrId) {
  const record = resolveRecord(recordOrId);
  if (record.demoCuttingEligibility?.eligible !== true) return null;
  const preview = millingToolPreviewViewModel(record);
  const dimensions = preview.dimensions;
  const scope = [...record.demoCuttingEligibility.scope];
  return deepFreeze({
    id: record.id,
    revision: record.revision,
    name: `${record.manufacturer} ${record.catalogNumber} · ${record.name}`,
    manufacturer: record.manufacturer,
    family: "live-milling",
    geometryKind: "axial-milling-cutter",
    verification: "catalogScaled",
    displayVerification: "catalogScaled",
    renderingClaim: "catalog-construction",
    geometryNotice: "Source-scale cutter and shank envelope only. Driven unit, collet projection, mounting transform, turret, and collision envelope are not represented.",
    sourceRecordRef: {id: record.id, revision: record.revision, revisionRef: record.revisionRef},
    geometryRevisionRef: record.geometryRevisionRef,
    profile: record.profile,
    cutterProfile: record.profile,
    cutterDiameter: dimensions.cutterDiameterMm,
    shankDiameter: dimensions.shankDiameterMm,
    lengthOfCut: dimensions.cuttingLengthMm,
    overallLength: dimensions.overallLengthMm,
    point: dimensions.point,
    schematic: millingToolGeometryMm(record),
    preview,
    sources: [...record.sourceRefs],
    assignment: {
      assignable: true,
      scope,
      reference: {...record.demoCuttingEligibility.reference},
      blockedOutsideScope: record.demoCuttingEligibility.blockedOutsideScope,
    },
    cuttingModel: {
      family: "live-milling",
      mode: "axial-flat-endmill",
      supportedOperation: "straight-linear-plunge-along-local-tool-axis",
      referenceSemantics: record.demoCuttingEligibility.reference.type,
      geometryRevisionRef: record.geometryRevisionRef,
      diameter: dimensions.cutterDiameterMm,
      lengthOfCut: dimensions.cuttingLengthMm,
      centerCutting: record.centerCutting === true,
      dimensionsExact: record.claims?.publishedDimensions === true,
      point: dimensions.point,
      scope,
      demoSimulationReady: true,
      simulationReady: false,
      stockRemovalVerified: record.claims?.demoCutting === true,
      collisionReady: false,
      holderGeometryIncluded: false,
      blockedOutsideScope: record.demoCuttingEligibility.blockedOutsideScope,
    },
  });
}
