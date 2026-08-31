import {toolLibraryAssemblyById} from "./tool-library.mjs";

const EPSILON = 1e-9;

export const TOOL_ASSEMBLY_2D_STATUS = Object.freeze({
  unverified: "UNVERIFIED",
  catalogScaled: "CATALOG-SCALED 2D ENVELOPE",
  manufacturerCadProjection: "MANUFACTURER CAD 2D DISPLAY",
});

function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deepClone(entry)]));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function frozenDefinition(definition) {
  return deepFreeze(deepClone({...definition, sources: definition.sources || []}));
}

const SUPPORTED_GEOMETRY_KINDS = new Set(["diamond-turning", "groove"]);
const SUPPORTED_CUTTING_MODES = new Set(["point", "axial-band"]);
const CONFIRMED_AXIAL_DIRECTIONS = new Set(["positive-z", "negative-z", "radial-only", "both"]);
const CATALOG_ENVELOPE_NOTICE = "Constructed connected catalog-scaled holder envelope with analytic cutter geometry. Exact seat, pocket, clamp, and mounting-hardware geometry is not represented; this is a display aid, not manufacturer CAD.";
const MCLNR164D_CAD_NOTICE = "Stroke-only top-plan projection of the official Kennametal MCLNR164D GTM holder body and its mounted CNMG432 insert, referenced to the GTM cutting-reference point. Clamp, screw, lock-pin, and shim detail is intentionally omitted. The tessellated projection is display geometry, not configured program-tip validation, stock-removal approval, collision authority, or trusted external dimensional validation.";

// Retained display projection from Kennametal's official MCLNR164D GTM data.
// The source arrays are [model X, -model Z] in mm. They map into the approved
// vertical OD-holder display as app {z: model X - CRP.x, x: model Z - CRP.z}.
// Only the holder body and already-mounted CUT insert are retained so the result
// stays a simple outline; M3/M4 visibility never changes its mounted position.
export const MCLNR164D_CAD_PROJECTION = deepFreeze({
  id: "kennametal-mclnr164d-gtm-top-plan-v1",
  units: "mm",
  coordinateOrder: ["model-x", "negative-model-z"],
  view: "top plan from model +Y onto model X/Z",
  projectionGrid: 0.05,
  holderSimplificationTolerance: 0.08,
  insertSimplificationTolerance: 0.035,
  cadInsertNoseRadius: 0.79375,
  modelCrp: [-31.75, 25.4, -152.4],
  source: {
    stepUrl: "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/zip-g/MCLNR164D_GTM.stp",
    stepSha256: "deba0c11ac8ae90b23e7b79757988a75e7ae68337e38c5939eedcdd9bd81a80a",
    manifestUrl: "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/json/MCLNR164D_GTM/MCLNR164D_GTM.json",
    manifestSha256: "d02bcbd96406059758d0cd13bcaed09dc4769fff0d0bac051bfe2f5a235d46a2",
    holderMeshSha256: "10269c53efd5fd5acba045cffcd1862b3320961e837c2da0074b1c5b850c481b",
    insertMeshSha256: "f7b71d06236a937d70a41513fb8638858e32f0444bc4b3d7e1df10a995193271",
  },
  holderOutline: [[-25.4,-0.05],[0.05,0],[0.05,138.1],[-12.15,150.25],[-19.05,150.8],[-19.2,150.8],[-19.2,150.6],[-19.5,150.6],[-30.2,151.5],[-30.45,151.4],[-30.8,151],[-30.8,150.35],[-29.85,139.85],[-29.85,139.75],[-30.1,139.8],[-30.1,139.5],[-28.65,123.45],[-25.4,123.45]],
  insertOutline: [[-18.85,138.35],[-17.95,138.4],[-17.55,138.9],[-18.45,150.15],[-18.65,150.85],[-19.2,151.35],[-19.65,151.55],[-22.2,151.7],[-30.85,152.45],[-31.2,152.45],[-31.45,152.3],[-31.75,151.9],[-31.8,151.25],[-30.9,141.75],[-30.85,140.6],[-30.7,139.95],[-30.1,139.4],[-29.65,139.2],[-28.4,139.2],[-23.45,138.75],[-19.05,138.45]],
  // Reverse-side depth visibility. The rear two edges and far nose are omitted.
  faceDownVisiblePath: [[-18.641087,150.741761],[-18.65,150.85],[-18.9,151.1],[-19.2,151.35],[-19.65,151.55],[-22.2,151.7],[-30.85,152.45],[-31.2,152.45],[-31.45,152.3],[-31.75,151.9],[-31.8,151.25],[-31.75,150.7],[-31.6,149],[-31.45,147.35],[-31.2,144.55],[-31.05,142.85],[-30.9,141.75],[-30.85,140.6],[-30.7,139.95],[-30.35,139.6],[-30.1,139.4],[-30.038633,139.424577]],
});

const CNMG_COMMON = {
  manufacturer: "Kennametal",
  insertCatalogId: "CNMG432 / CNMG120408",
  insertMaterialNumber: "1159602",
  insertIc: 12.7,
  insertCuttingEdgeLength: 12.896,
  insertIncludedAngle: 80,
  insertNoseRadius: 0.8,
  insertThickness: 4.76,
  insertHoleDiameter: 5.16,
  holderLength: 152.4,
  holderShankWidth: 25.4,
  holderFDimension: 31.75,
  holderHeadLength: 30.556,
  holderApproachAngle: 95,
  holderOrthogonalRake: -5,
  holderInclination: -5,
  geometryKind: "diamond-turning",
  family: "turn",
  sources: [
    "https://www.kennametal.com/us/en/products/p.cnmg.1159602.html",
  ],
  cuttingModel: {
    family: "turn",
    mode: "point",
    axialMin: 0,
    axialMax: 0,
    axialDirection: null,
    axialDirectionChoices: ["negative-z", "positive-z", "radial-only"],
    recommendedAxialDirection: null,
    referenceSemantics: "programmed-contact-point",
    simulationReady: false,
  },
};

export const DEFAULT_TOOL_ASSEMBLY_2D = frozenDefinition({
  ...CNMG_COMMON,
  id: "kennametal-mclnr164d-cnmg432",
  revision: 3,
  name: "Kennametal MCLNR164D + CNMG432 · RH",
  holderCatalogId: "MCLNR164D",
  holderMaterialNumber: "1096070",
  verification: "catalogScaled",
  displayVerification: "manufacturerCadProjection",
  renderingClaim: "manufacturer-cad-projection",
  geometryNotice: MCLNR164D_CAD_NOTICE,
  cadProjectionId: MCLNR164D_CAD_PROJECTION.id,
  hand: "right",
  sources: [
    "https://www.kennametal.com/us/en/products/p.mcln-5.1096070.html",
    MCLNR164D_CAD_PROJECTION.source.stepUrl,
    MCLNR164D_CAD_PROJECTION.source.manifestUrl,
    ...CNMG_COMMON.sources,
  ],
});

const LEFT_CNMG = frozenDefinition({
  ...CNMG_COMMON,
  id: "kennametal-mclnl164d-cnmg432",
  revision: 1,
  name: "Kennametal MCLNL164D + CNMG432 · LH",
  holderCatalogId: "MCLNL164D",
  holderMaterialNumber: "1096092",
  verification: "catalogScaled",
  renderingClaim: "catalog-connected-envelope",
  geometryNotice: CATALOG_ENVELOPE_NOTICE,
  hand: "left",
  holderHeadLength: 30.48,
  sources: [
    "https://www.kennametal.com/us/en/products/p.mcln-5.1096092.html",
    ...CNMG_COMMON.sources,
  ],
});

const BACK_TURN = frozenDefinition({
  id: "kennametal-nsr163d-np3002rk-back-turn",
  revision: 2,
  name: "Kennametal NSR163D + NP3002RK · Back turn RH",
  manufacturer: "Kennametal",
  holderCatalogId: "NSR163D",
  holderMaterialNumber: "1016462",
  insertCatalogId: "NP3002RK",
  insertMaterialNumber: "4109881",
  verification: "catalogScaled",
  renderingClaim: "catalog-scaled-envelope",
  geometryNotice: "Manufacturer-compatible size-3 holder/insert pairing with a flat catalog envelope and the published handed cutting corner. Holder seating/head detail is omitted. Stock removal remains blocked until the mounted edge and programmed reference convention have external dimensional evidence.",
  hand: "right",
  family: "back-turn-groove",
  geometryKind: "groove",
  holderLength: 152.4,
  holderShankWidth: 25.4,
  holderFDimension: 31.75,
  holderHeadLength: 31.75,
  holderEndChamfer: 12.7,
  holderCuttingDepth: 5.334,
  insertCuttingWidth: 4.88,
  insertProfileMaximum: 3.84,
  insertCornerRadius: 0.1,
  insertCornerSides: ["positive-z"],
  insertCuttingDepth: 5.08,
  sources: [
    "https://www.kennametal.com/us/en/products/p.ns.1016462.html",
    "https://www.kennametal.com/us/en/products/p.np-k-groove-and-profile-back-turning-chip-control.4109881.html",
  ],
  cuttingModel: {
    family: "back-turn-groove",
    mode: "axial-band",
    axialWidth: 4.88,
    cornerRadius: 0.1,
    cornerSides: ["positive-z"],
    tipDatum: null,
    tipDatumChoices: ["negative-z-edge", "center", "positive-z-edge"],
    recommendedTipDatum: "positive-z-edge",
    axialDirection: null,
    axialDirectionChoices: ["positive-z", "negative-z", "radial-only"],
    recommendedAxialDirection: "positive-z",
    stockRemovalVerified: false,
    blockedReason: "The handed insert display is catalog-scaled, but its mounted cutting-edge/reference sweep has not yet been externally verified.",
    simulationReady: false,
  },
});

function unverifiedTemplate(id, name, family, geometryKind) {
  return frozenDefinition({
    id, revision: 1, name, family, geometryKind, manufacturer: "Custom", verification: "unverified", hand: "neutral",
    renderingClaim: "unconfigured-template",
    geometryNotice: "No drawable or simulation-ready geometry exists until every required dimension and cutting datum is explicitly confirmed.",
    holderLength: null, holderShankWidth: null, holderFDimension: null, holderHeadLength: null,
    sources: [],
    cuttingModel: {family, mode: "unsupported", simulationReady: false},
  });
}

export const TOOL_ASSEMBLY_2D_LIBRARY = Object.freeze([
  DEFAULT_TOOL_ASSEMBLY_2D,
  LEFT_CNMG,
  BACK_TURN,
  unverifiedTemplate("custom-od-groove-part", "Custom OD groove / parting tool", "groove-part", "groove"),
  unverifiedTemplate("custom-od-thread", "Custom OD threading tool", "thread", "thread"),
  unverifiedTemplate("custom-id-boring", "Custom ID boring tool", "id-bore", "boring"),
  unverifiedTemplate("custom-id-groove", "Custom ID grooving tool", "id-groove", "groove"),
  unverifiedTemplate("custom-drill", "Custom drill / holemaking tool", "holemaking", "drill"),
]);

export function listToolAssemblies2d() {
  return [...TOOL_ASSEMBLY_2D_LIBRARY];
}

export function listSelectableToolAssemblies2d() {
  return TOOL_ASSEMBLY_2D_LIBRARY.filter((entry) => (
    resolveAssignableToolAssembly2d({id: entry.id, revision: entry.revision}) === entry
  ));
}

export function toolAssembly2dById(id, revision = null) {
  const entry = TOOL_ASSEMBLY_2D_LIBRARY.find((candidate) => candidate.id === id) || null;
  if (!entry || (revision !== null && Number(entry.revision) !== Number(revision))) return null;
  return entry;
}

export function resolveAssignableToolAssembly2d(assemblyRef) {
  if (!assemblyRef || typeof assemblyRef !== "object" || Array.isArray(assemblyRef)) return null;
  const {id, revision} = assemblyRef;
  if (typeof id !== "string" || !id.length || id.trim() !== id || !Number.isInteger(revision) || revision < 1) {
    return null;
  }
  const catalogAssembly = toolLibraryAssemblyById(id);
  const displayClaim = catalogAssembly?.claims?.displayGeometry;
  if (!catalogAssembly
    || catalogAssembly.revision !== revision
    || catalogAssembly.assignment?.assignable !== true
    || displayClaim?.available !== true
    || displayClaim.assignable !== true) {
    return null;
  }
  const definition = TOOL_ASSEMBLY_2D_LIBRARY.find((entry) => entry.id === id && entry.revision === revision) || null;
  if (!definition || toolAssembly2dDisplayCapability(definition).available !== true) return null;
  return definition;
}

function finite(value) {
  return Number.isFinite(value);
}

function add(point, vector, distance = 1) {
  return {z: point.z + vector.z * distance, x: point.x + vector.x * distance};
}

function unitVector(angle) {
  return {z: Math.cos(angle), x: Math.sin(angle)};
}

function cuttingOffsets(model) {
  const width = Number(model.axialWidth);
  if (!(width > EPSILON)) return null;
  if (model.tipDatum === "negative-z-edge") return {minimum: 0, maximum: width};
  if (model.tipDatum === "positive-z-edge") return {minimum: -width, maximum: 0};
  if (model.tipDatum === "center") return {minimum: -width / 2, maximum: width / 2};
  return null;
}

function validateToolAssembly2dGeometry(assembly, {requirePlacement = true} = {}) {
  const errors = [];
  if (!assembly || !assembly.id) return ["A tool assembly is required."];
  if (!SUPPORTED_GEOMETRY_KINDS.has(assembly.geometryKind)) {
    errors.push(`Geometry kind ${assembly.geometryKind || "unknown"} does not have a supported 2D builder.`);
  }
  for (const [label, value] of [
    ["Holder overall length", assembly.holderLength],
    ["Holder shank width", assembly.holderShankWidth],
    ["Holder F dimension", assembly.holderFDimension],
    ["Holder head length", assembly.holderHeadLength],
  ]) {
    if (!finite(value) || value <= 0) errors.push(`${label} must be confirmed and greater than zero.`);
  }
  if (assembly.geometryKind === "diamond-turning") {
    for (const [label, value] of [
      ["Insert inscribed circle", assembly.insertIc],
      ["Insert cutting-edge length", assembly.insertCuttingEdgeLength],
      ["Insert thickness", assembly.insertThickness],
      ["Insert hole diameter", assembly.insertHoleDiameter],
    ]) {
      if (!finite(value) || value <= 0) errors.push(`${label} must be greater than zero.`);
    }
    if (!finite(assembly.insertIncludedAngle) || assembly.insertIncludedAngle < 20 || assembly.insertIncludedAngle > 160) {
      errors.push("Insert included angle must be between 20° and 160°.");
    }
    if (!finite(assembly.insertNoseRadius) || assembly.insertNoseRadius < 0) errors.push("Insert nose radius cannot be negative.");
    if (!finite(assembly.holderApproachAngle) || assembly.holderApproachAngle <= 0 || assembly.holderApproachAngle >= 180) {
      errors.push("Holder approach angle must be between 0° and 180°.");
    }
    if (finite(assembly.insertIncludedAngle) && finite(assembly.insertCuttingEdgeLength) && finite(assembly.insertNoseRadius)) {
      const halfAngle = assembly.insertIncludedAngle * Math.PI / 360;
      const maximumRadius = assembly.insertCuttingEdgeLength * Math.tan(halfAngle) / 2;
      if (assembly.insertNoseRadius >= maximumRadius - EPSILON) {
        errors.push(`Insert nose radius must be less than ${maximumRadius.toFixed(4)} mm.`);
      }
    }
  }
  if (assembly.geometryKind === "groove") {
    if (!finite(assembly.insertCuttingWidth) || assembly.insertCuttingWidth <= 0) errors.push("Insert cutting width must be confirmed and greater than zero.");
    if (!finite(assembly.insertCuttingDepth) || assembly.insertCuttingDepth <= 0) errors.push("Insert cutting depth must be confirmed and greater than zero.");
    if (finite(assembly.insertCornerRadius) && assembly.insertCornerRadius > 0) {
      const sides = assembly.insertCornerSides || [];
      if (!Array.isArray(sides) || !sides.length || sides.some((side) => !["negative-z", "positive-z"].includes(side))) {
        errors.push("Every catalog corner radius must identify its supported cutting-edge side.");
      }
    }
    if (requirePlacement && !cuttingOffsets(assembly.cuttingModel || {})) errors.push("The programmed Z datum edge must be confirmed to place this outline.");
  }
  if (finite(assembly.holderHeadLength) && finite(assembly.holderLength) && assembly.holderHeadLength >= assembly.holderLength) {
    errors.push("Holder head length must be shorter than the overall length.");
  }
  if (finite(assembly.holderFDimension) && finite(assembly.holderShankWidth) && assembly.holderFDimension < assembly.holderShankWidth) {
    errors.push("Holder F dimension must be at least the shank width for this connected envelope.");
  }
  return errors;
}

export function validateToolAssemblyDisplay2d(assembly) {
  return validateToolAssembly2dGeometry(assembly);
}

export function toolAssembly2dDisplayCapability(assembly) {
  const errors = validateToolAssembly2dGeometry(assembly, {requirePlacement: false});
  return {available: errors.length === 0, errors};
}

export function validateToolAssembly2d(assembly) {
  const errors = validateToolAssembly2dGeometry(assembly);
  if (!assembly || !assembly.id) return errors;
  const cuttingMode = assembly.cuttingModel?.mode;
  if (!SUPPORTED_CUTTING_MODES.has(cuttingMode)) {
    errors.push(`Cutting model ${cuttingMode || "unknown"} is not supported for stock removal.`);
  }
  if (assembly.geometryKind === "diamond-turning" && cuttingMode !== "point") {
    errors.push("Diamond-turning geometry requires the point cutting model.");
  }
  if (assembly.geometryKind === "groove" && cuttingMode !== "axial-band") {
    errors.push("Groove geometry requires the finite axial-band cutting model.");
  }
  if (assembly.geometryKind === "diamond-turning") {
    if (assembly.cuttingModel?.referenceSemantics !== "programmed-contact-point") {
      errors.push("The turning model must explicitly use programmed-contact-point reference semantics.");
    }
    if (!["negative-z", "positive-z", "radial-only"].includes(assembly.cuttingModel?.axialDirection)) {
      errors.push("The permitted Z cutting direction must be confirmed for this turning tool.");
    }
  }
  if (assembly.geometryKind === "groove" && !CONFIRMED_AXIAL_DIRECTIONS.has(assembly.cuttingModel?.axialDirection)) {
    errors.push("The permitted Z cutting direction must be confirmed.");
  }
  return errors;
}

function shankEnvelope(assembly, referencePoint, handSign = 1) {
  const innerZ = referencePoint.z + handSign * (assembly.holderFDimension - assembly.holderShankWidth);
  const outerZ = referencePoint.z + handSign * assembly.holderFDimension;
  const nearX = referencePoint.x + assembly.holderHeadLength;
  const farX = referencePoint.x + assembly.holderLength;
  return [
    {z: innerZ, x: nearX},
    {z: innerZ, x: farX},
    {z: outerZ, x: farX},
    {z: outerZ, x: nearX},
  ];
}

function turningModel(assembly, referencePoint, displayState = null) {
  const handSign = assembly.hand === "left" ? -1 : 1;
  const spindleDirection = displayState?.spindleDirection === "m3" || displayState?.spindleDirection === "m4"
    ? displayState.spindleDirection
    : "unknown";
  const includedAngle = assembly.insertIncludedAngle * Math.PI / 180;
  const halfAngle = includedAngle / 2;
  const approachAngle = assembly.holderApproachAngle * Math.PI / 180;
  const firstAngle = Math.PI - approachAngle;
  const secondAngle = firstAngle - includedAngle;
  const axisAngle = (firstAngle + secondAngle) / 2;
  const facingVector = (angle) => {
    const vector = unitVector(angle);
    return {z: handSign * vector.z, x: vector.x};
  };
  const firstRay = facingVector(firstAngle);
  const secondRay = facingVector(secondAngle);
  const axis = facingVector(axisAngle);
  const first = add(referencePoint, firstRay, assembly.insertCuttingEdgeLength);
  const opposite = add(first, secondRay, assembly.insertCuttingEdgeLength);
  const second = add(referencePoint, secondRay, assembly.insertCuttingEdgeLength);
  const noseCenter = add(referencePoint, axis, assembly.insertNoseRadius / Math.sin(halfAngle));
  const unreflectedNoseStart = axisAngle + Math.PI / 2 + halfAngle;
  const noseArc = {
    center: noseCenter,
    radius: assembly.insertNoseRadius,
    startAngle: Math.atan2(
      Math.sin(unreflectedNoseStart),
      handSign * Math.cos(unreflectedNoseStart),
    ),
    sweep: handSign * (Math.PI - includedAngle),
  };
  const shankOutline = shankEnvelope(assembly, referencePoint, handSign);
  const holderOutline = [first, ...shankOutline, second];
  const noseSamples = sampleToolNoseArc(noseArc, Math.min(0.01, assembly.insertNoseRadius / 50));
  const insertOutline = noseSamples.length >= 2
    ? [noseSamples[0], first, opposite, second, noseSamples.at(-1), ...noseSamples.slice(1, -1).reverse()]
    : [referencePoint, first, opposite, second];
  const exposedInsertPath = noseSamples.length >= 2 ? [first, ...noseSamples, second] : [first, referencePoint, second];
  const holderComponent = {role: "holder", outline: holderOutline};
  const insertComponent = {role: "insert", outline: insertOutline};
  if (displayState) {
    const unknownPose = spindleDirection === "unknown";
    holderComponent.renderOrder = 1;
    insertComponent.renderOrder = 2;
    holderComponent.paths = [{points: holderOutline, closed: true}];
    insertComponent.paths = [{
      points: spindleDirection === "m3" ? exposedInsertPath : insertOutline,
      closed: spindleDirection !== "m3",
    }];
    holderComponent.dashed = unknownPose;
    insertComponent.dashed = unknownPose;
  }
  return {
    insert: {
      outline: insertOutline, body: insertOutline, exposedPath: exposedInsertPath,
      noseArc, includedAngle, cuttingEdgeLength: assembly.insertCuttingEdgeLength,
    },
    cutter: {outline: insertOutline, noseArc},
    holder: {
      outline: holderOutline, bodyOutline: holderOutline, shankOutline,
      envelopeKind: "catalog-connected-envelope",
    },
    spindleDisplay: displayState ? {
      direction: spindleDirection,
      running: typeof displayState.spindleRunning === "boolean" ? displayState.spindleRunning : null,
      facing: spindleDirection === "m3" ? "down" : spindleDirection === "m4" ? "up" : "unknown",
    } : null,
    components: [holderComponent, insertComponent],
  };
}

function cadProjectionPoint(referencePoint, point) {
  const [modelX, negativeModelZ] = point;
  const [crpX, , crpZ] = MCLNR164D_CAD_PROJECTION.modelCrp;
  return {
    z: referencePoint.z + modelX - crpX,
    x: referencePoint.x - negativeModelZ - crpZ,
  };
}

function mclnr164dCadDisplayModel(assembly, referencePoint, displayState) {
  const analytic = turningModel(assembly, referencePoint, displayState);
  const spindleDirection = analytic.spindleDisplay.direction;
  const mapPath = (path) => path.map((point) => cadProjectionPoint(referencePoint, point));
  const holderOutline = mapPath(MCLNR164D_CAD_PROJECTION.holderOutline);
  const insertOutline = mapPath(MCLNR164D_CAD_PROJECTION.insertOutline);
  const exposedInsertPath = mapPath(MCLNR164D_CAD_PROJECTION.faceDownVisiblePath);
  const shankOutline = shankEnvelope(assembly, referencePoint, 1);
  const unknownPose = spindleDirection === "unknown";
  const faceDown = spindleDirection === "m3";
  const holderComponent = {
    role: "holder",
    outline: holderOutline,
    renderOrder: 1,
    paths: [{points: holderOutline, closed: true}],
    dashed: unknownPose,
  };
  const insertComponent = {
    role: "insert",
    outline: insertOutline,
    renderOrder: 2,
    paths: [{points: faceDown ? exposedInsertPath : insertOutline, closed: !faceDown}],
    dashed: unknownPose,
  };
  return {
    ...analytic,
    cadProjection: {
      id: MCLNR164D_CAD_PROJECTION.id,
      units: MCLNR164D_CAD_PROJECTION.units,
      view: MCLNR164D_CAD_PROJECTION.view,
      projectionGrid: MCLNR164D_CAD_PROJECTION.projectionGrid,
      holderSimplificationTolerance: MCLNR164D_CAD_PROJECTION.holderSimplificationTolerance,
      insertSimplificationTolerance: MCLNR164D_CAD_PROJECTION.insertSimplificationTolerance,
      modelCrp: [...MCLNR164D_CAD_PROJECTION.modelCrp],
      source: {...MCLNR164D_CAD_PROJECTION.source},
    },
    insert: {
      ...analytic.insert,
      outline: insertOutline,
      body: insertOutline,
      exposedPath: exposedInsertPath,
      cadNoseRadius: MCLNR164D_CAD_PROJECTION.cadInsertNoseRadius,
    },
    cutter: analytic.cutter,
    holder: {
      outline: holderOutline,
      bodyOutline: holderOutline,
      shankOutline,
      envelopeKind: "manufacturer-cad-projection",
    },
    components: [holderComponent, insertComponent],
  };
}

function grooveModel(assembly, referencePoint) {
  const offsets = cuttingOffsets(assembly.cuttingModel);
  const minimumZ = referencePoint.z + offsets.minimum;
  const maximumZ = referencePoint.z + offsets.maximum;
  const cutterBackX = referencePoint.x + assembly.insertCuttingDepth;
  const cornerRadius = Math.max(0, Math.min(
    Number(assembly.insertCornerRadius) || 0,
    assembly.insertCuttingWidth / 2,
    assembly.insertCuttingDepth,
  ));
  const cornerSides = new Set(assembly.insertCornerSides || []);
  const negativeCorner = cornerRadius > EPSILON && cornerSides.has("negative-z") ? {
    center: {z: minimumZ + cornerRadius, x: referencePoint.x + cornerRadius},
    radius: cornerRadius,
    startAngle: Math.PI,
    sweep: Math.PI / 2,
  } : null;
  const positiveCorner = cornerRadius > EPSILON && cornerSides.has("positive-z") ? {
    center: {z: maximumZ - cornerRadius, x: referencePoint.x + cornerRadius},
    radius: cornerRadius,
    startAngle: -Math.PI / 2,
    sweep: Math.PI / 2,
  } : null;
  const negativePoints = negativeCorner ? sampleToolNoseArc(negativeCorner, Math.min(0.002, cornerRadius / 25)) : [{z: minimumZ, x: referencePoint.x}];
  const positivePoints = positiveCorner ? sampleToolNoseArc(positiveCorner, Math.min(0.002, cornerRadius / 25)) : [{z: maximumZ, x: referencePoint.x}];
  const cutterOutline = [
    ...negativePoints,
    ...positivePoints,
    {z: maximumZ, x: cutterBackX},
    {z: minimumZ, x: cutterBackX},
  ];
  const holderOutline = shankEnvelope(assembly, referencePoint, assembly.hand === "left" ? -1 : 1);
  return {
    insert: null,
    cutter: {
      outline: cutterOutline,
      width: assembly.insertCuttingWidth,
      cornerRadius,
      cornerArcs: [negativeCorner, positiveCorner].filter(Boolean),
    },
    holder: {outline: holderOutline, bodyOutline: holderOutline, shankOutline: holderOutline, envelopeKind: "catalog-shank-only"},
    components: [{role: "holder", outline: holderOutline}, {role: "cutter", outline: cutterOutline}],
  };
}

function resolvedCuttingModel(assembly) {
  const model = {...assembly.cuttingModel};
  const directionReady = CONFIRMED_AXIAL_DIRECTIONS.has(model.axialDirection);
  const simulationReady = model.mode === "point"
    ? directionReady && model.referenceSemantics === "programmed-contact-point"
    : model.mode === "axial-band"
      && model.stockRemovalVerified === true
      && directionReady
      && Boolean(cuttingOffsets(model));
  return {...model, simulationReady};
}

function buildToolAssemblyWithValidation(assembly, referencePoint, validator, displayState = null) {
  const errors = validator(assembly);
  if (!referencePoint || !finite(referencePoint.z) || !finite(referencePoint.x)) errors.push("Programmed tool reference point is unavailable.");
  if (errors.length) return {valid: false, errors, id: assembly?.id || null, verification: assembly?.verification || "unverified"};
  let geometry = null;
  if (assembly.geometryKind === "diamond-turning") {
    geometry = displayState && assembly.cadProjectionId === MCLNR164D_CAD_PROJECTION.id
      ? mclnr164dCadDisplayModel(assembly, referencePoint, displayState)
      : turningModel(assembly, referencePoint, displayState);
  }
  else if (assembly.geometryKind === "groove") geometry = grooveModel(assembly, referencePoint);
  else {
    return {
      valid: false,
      errors: [`Geometry kind ${assembly.geometryKind || "unknown"} does not have a supported 2D builder.`],
      id: assembly.id,
      verification: assembly.verification,
    };
  }
  return {
    valid: true,
    errors: [],
    id: assembly.id,
    revision: assembly.revision,
    name: assembly.name,
    manufacturer: assembly.manufacturer,
    verification: assembly.verification,
    displayVerification: assembly.displayVerification || assembly.verification,
    renderingClaim: assembly.renderingClaim || "unverified",
    geometryNotice: assembly.geometryNotice || null,
    referencePoint: {...referencePoint},
    cuttingModel: resolvedCuttingModel(assembly),
    catalog: {
      holder: assembly.holderCatalogId || null,
      holderMaterialNumber: assembly.holderMaterialNumber || null,
      insert: assembly.insertCatalogId || null,
      insertMaterialNumber: assembly.insertMaterialNumber || null,
      sources: [...(assembly.sources || [])],
    },
    ...geometry,
  };
}

export function buildToolAssemblyDisplay2d(assembly, referencePoint, displayState = {}) {
  return buildToolAssemblyWithValidation(assembly, referencePoint, validateToolAssemblyDisplay2d, displayState);
}

export function buildToolAssembly2d(assembly, referencePoint) {
  return buildToolAssemblyWithValidation(assembly, referencePoint, validateToolAssembly2d);
}

export function sampleToolNoseArc(noseArc, maximumChord = 0.05) {
  if (!noseArc || noseArc.radius <= EPSILON) return [];
  const tolerance = Math.max(EPSILON, Math.min(noseArc.radius, maximumChord));
  const maximumStep = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / noseArc.radius)));
  const segments = Math.max(8, Math.ceil(Math.abs(noseArc.sweep) / Math.max(maximumStep, EPSILON)));
  return Array.from({length: segments + 1}, (_, index) => {
    const angle = noseArc.startAngle + noseArc.sweep * index / segments;
    return {
      z: noseArc.center.z + Math.cos(angle) * noseArc.radius,
      x: noseArc.center.x + Math.sin(angle) * noseArc.radius,
    };
  });
}

export function toolReferencePointForExecution(segments, visibleBlocks) {
  if (!Array.isArray(segments) || !segments.length) return null;
  const count = Math.max(0, Math.min(segments.length, Math.floor(Number(visibleBlocks) || 0)));
  const point = count > 0 ? segments[count - 1]?.end : segments[0]?.start;
  if (!point || !finite(point.z) || !finite(point.x)) return null;
  return {z: point.z, x: point.x};
}
