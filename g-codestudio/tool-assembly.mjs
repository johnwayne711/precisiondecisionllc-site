const EPSILON = 1e-9;

export const TOOL_ASSEMBLY_2D_STATUS = Object.freeze({
  unverified: "UNVERIFIED",
  catalogScaled: "CATALOG SCALED",
  dimensionVerified: "DIMENSION VERIFIED",
  manufacturerCadVerified: "MANUFACTURER CAD VERIFIED",
});

// Kennametal catalog values for MCLNR164D material 1096070 and its CNMG432
// gage insert. Internal dimensions are millimeters, regardless of display units.
export const DEFAULT_TOOL_ASSEMBLY_2D = Object.freeze({
  id: "kennametal-mclnr164d-cnmg432",
  name: "Kennametal MCLNR164D + CNMG432",
  manufacturer: "Kennametal",
  holderCatalogId: "MCLNR164D",
  holderMaterialNumber: "1096070",
  insertCatalogId: "CNMG432 / CNMG120408",
  verification: "manufacturerCadVerified",
  hand: "right",
  insertIc: 12.7,
  insertCuttingEdgeLength: 12.896,
  insertIncludedAngle: 80,
  insertNoseRadius: 0.8,
  insertThickness: 4.763,
  insertHoleDiameter: 5.16,
  holderLength: 152.4,
  holderShankWidth: 25.4,
  holderFDimension: 31.75,
  holderHeadLength: 30.556,
  holderApproachAngle: 95,
  holderOrthogonalRake: -5,
  holderInclination: -5,
  shimCatalogId: "ICSN433",
  lockPinCatalogId: "KL46",
  clampCatalogId: "CK20",
  clampScrewCatalogId: "STC20",
  cadSource: "Kennametal MCLNR164D Graphical Tool Model (GTM STEP)",
  cadProjectionTolerance: 0.05,
});

// Manufacturer geometry from Kennametal's official MCLNR164D GTM STEP file.
// The STEP cutting-reference point (CRP) is the local origin. Its model +Z
// shank axis maps to lathe +X and its model +X width maps to lathe +Z. Curved
// boundaries are tessellated to a maximum 0.05 mm chordal display tolerance;
// all coordinates and the overall scale remain in exact millimeters.
const MCLNR164D_CAD_COMPONENTS = Object.freeze([
  {role: "clampScrew", outline: [[13.166,17.818],[13.014,18.096],[12.842,18.538],[12.75,18.922],[12.702,19.392],[12.726,19.864],[12.8,20.252],[12.92,20.626],[13.086,20.982],[13.252,21.25],[13.392,21.44],[13.712,21.784],[14.858,22.75],[15.176,22.982],[15.42,23.22],[16.506,24.134],[16.758,24.322],[17.028,24.484],[17.31,24.618],[17.532,24.702],[17.912,24.8],[18.146,24.836],[18.46,24.858],[18.776,24.848],[19.088,24.806],[19.394,24.734],[19.62,24.66],[19.91,24.534],[20.188,24.382],[20.448,24.202],[20.688,23.998],[20.908,23.77],[21.106,23.522],[21.352,23.116],[21.51,22.754],[21.638,22.298],[21.696,21.828],[21.696,21.512],[21.638,21.042],[21.51,20.588],[21.352,20.228],[21.194,19.956],[21.01,19.702],[20.802,19.466],[20.63,19.304],[19.544,18.392],[19.226,18.16],[18.922,17.87],[17.708,16.864],[17.444,16.696],[17.09,16.522],[16.794,16.416],[16.49,16.34],[16.178,16.296],[15.862,16.282],[15.548,16.3],[15.236,16.35],[14.932,16.43],[14.636,16.54],[14.282,16.718],[14.082,16.846],[13.832,17.038],[13.6,17.254],[13.344,17.556]]},
  {role: "clamp", outline: [[7.222,10.026],[6.964,10.276],[6.948,10.35],[6.958,10.552],[7.014,10.914],[7.124,11.442],[7.478,12.858],[8.934,14.974],[11.252,18.27],[11.142,18.85],[11.106,19.318],[11.128,19.906],[11.176,20.256],[11.25,20.6],[11.428,21.158],[11.676,21.69],[11.988,22.186],[12.36,22.638],[12.696,22.964],[13.74,23.842],[14.018,24.058],[14.408,24.308],[14.83,24.522],[15.268,24.69],[15.72,24.814],[16.184,24.894],[16.77,24.926],[17.238,24.898],[17.702,24.826],[18.27,24.67],[18.814,24.444],[19.226,24.216],[19.614,23.948],[19.974,23.642],[20.38,23.214],[20.596,22.932],[20.85,22.536],[21.064,22.116],[21.236,21.676],[21.364,21.222],[21.444,20.758],[21.48,20.288],[21.468,19.818],[21.408,19.352],[21.304,18.894],[21.154,18.45],[20.96,18.022],[20.786,17.716],[20.522,17.33],[20.22,16.972],[19.882,16.646],[18.838,15.768],[18.56,15.554],[18.266,15.362],[17.852,15.14],[17.528,15.002],[17.084,14.856],[16.71,14.77],[16.312,14.204],[15.916,13.87],[15.516,13.354],[14.674,12.178],[12.938,9.664],[12.438,9.25],[11.488,8.548],[10.958,8.16],[10.454,7.802],[10.034,8.014],[9.576,8.272],[8.744,8.802],[7.962,9.384]]},
  {role: "lockPin", outline: [[3.502,7.292],[3.512,7.582],[3.56,7.968],[3.646,8.344],[3.736,8.62],[3.886,8.976],[4.022,9.232],[4.232,9.556],[4.41,9.784],[4.604,9.998],[4.888,10.26],[5.196,10.502],[5.52,10.71],[5.864,10.884],[6.044,10.958],[6.41,11.078],[6.788,11.162],[7.172,11.206],[7.462,11.216],[7.994,11.174],[8.406,11.198],[8.774,11.172],[8.992,11.136],[9.334,11.046],[9.508,10.984],[9.838,10.828],[10.118,10.658],[10.46,10.39],[10.706,10.138],[10.964,9.806],[11.114,9.556],[11.266,9.212],[11.348,8.97],[11.406,8.74],[11.446,8.518],[11.476,8.11],[11.452,7.7],[11.416,7.478],[11.342,7.188],[11.3,6.72],[11.246,6.436],[11.17,6.156],[11.038,5.792],[10.916,5.53],[10.722,5.196],[10.496,4.882],[10.172,4.526],[9.804,4.206],[9.49,3.982],[9.154,3.792],[8.802,3.634],[8.434,3.514],[8.058,3.43],[7.674,3.386],[7.286,3.378],[6.804,3.424],[6.426,3.504],[5.966,3.656],[5.612,3.818],[5.196,4.068],[4.888,4.304],[4.604,4.57],[4.348,4.862],[4.122,5.18],[3.886,5.604],[3.704,6.054],[3.578,6.522],[3.512,7.002]]},
  {role: "shim", outline: [[1.436,1.07],[1.212,1.276],[1.038,1.54],[0.942,1.806],[0.914,1.962],[0.906,2.12],[1.776,12.1],[1.82,12.316],[1.874,12.464],[1.962,12.63],[2.096,12.806],[2.348,13.03],[2.266,12.964],[2.716,13.33],[2.852,13.408],[2.998,13.468],[3.15,13.51],[3.306,13.532],[13.216,14.324],[13.468,14.306],[13.682,14.25],[13.91,14.142],[14.136,13.968],[14.318,13.75],[14.436,13.526],[14.512,13.252],[14.528,13.096],[14.524,12.938],[13.662,3.084],[13.624,2.866],[13.548,2.66],[13.456,2.496],[13.34,2.346],[12.82,1.896],[12.67,1.792],[12.408,1.674],[12.13,1.62],[2.218,0.828],[2.038,0.836],[1.814,0.882],[1.636,0.95]]},
  {role: "insert", outline: [[0.542,0.034],[0.332,0.14],[0.254,0.202],[0.136,0.336],[0.076,0.438],[0.026,0.568],[-0.006,0.82],[0.978,12.078],[1,12.194],[1.056,12.342],[1.192,12.534],[1.758,13.012],[1.896,13.088],[2.084,13.142],[13.354,14.046],[13.53,14.036],[13.682,13.994],[13.824,13.922],[13.934,13.838],[14.04,13.72],[14.136,13.548],[14.184,13.378],[14.192,13.2],[13.208,1.954],[13.182,1.828],[13.132,1.7],[13.01,1.522],[12.924,1.44],[12.412,1.018],[12.274,0.946],[12.084,0.896],[0.854,-0.004],[0.676,0.002]]},
  {role: "holder", outline: [[1.734,0.93],[1.584,0.94],[1.404,0.994],[1.256,1.08],[1.156,1.17],[1.044,1.322],[0.99,1.444],[0.952,1.61],[0.948,1.722],[1.902,12.642],[1.68,12.626],[3.108,28.95],[6.35,28.95],[6.35,152.4],[31.75,152.4],[31.75,14.346],[19.582,2.176],[12.592,1.616],[12.608,1.798]]},
]);

function finite(value) {
  return Number.isFinite(value);
}

function add(point, vector, distance = 1) {
  return {z: point.z + vector.z * distance, x: point.x + vector.x * distance};
}

function unitVector(angle) {
  return {z: Math.cos(angle), x: Math.sin(angle)};
}

function catalogPoint(referencePoint, longitudinal, transverse) {
  return {z: referencePoint.z + transverse, x: referencePoint.x + longitudinal};
}

function cadPoint(referencePoint, point) {
  return {z: referencePoint.z + point[0], x: referencePoint.x + point[1]};
}

export function validateToolAssembly2d(assembly) {
  const errors = [];
  const positive = [
    ["Insert inscribed circle", assembly.insertIc],
    ["Insert cutting-edge length", assembly.insertCuttingEdgeLength],
    ["Insert thickness", assembly.insertThickness],
    ["Insert hole diameter", assembly.insertHoleDiameter],
    ["Holder overall length", assembly.holderLength],
    ["Holder shank width", assembly.holderShankWidth],
    ["Holder F dimension", assembly.holderFDimension],
    ["Holder head length", assembly.holderHeadLength],
  ];
  for (const [label, value] of positive) {
    if (!finite(value) || value <= 0) errors.push(`${label} must be greater than zero.`);
  }
  if (!finite(assembly.insertIncludedAngle) || assembly.insertIncludedAngle < 20 || assembly.insertIncludedAngle > 160) {
    errors.push("Insert included angle must be between 20° and 160°.");
  }
  if (!finite(assembly.insertNoseRadius) || assembly.insertNoseRadius < 0) {
    errors.push("Insert nose radius cannot be negative.");
  }
  if (!finite(assembly.holderApproachAngle) || assembly.holderApproachAngle <= 0 || assembly.holderApproachAngle >= 180) {
    errors.push("Holder approach angle must be between 0° and 180°.");
  }
  if (finite(assembly.holderHeadLength) && finite(assembly.holderLength) && assembly.holderHeadLength >= assembly.holderLength) {
    errors.push("Holder head length must be shorter than the overall length.");
  }
  if (finite(assembly.holderShankWidth) && finite(assembly.holderFDimension)
      && assembly.holderFDimension < assembly.holderShankWidth) {
    errors.push("Holder F dimension must reach at least the full shank width from the tool tip datum.");
  }
  if (!errors.length) {
    const halfAngle = assembly.insertIncludedAngle * Math.PI / 360;
    const maximumRadius = assembly.insertCuttingEdgeLength * Math.tan(halfAngle) / 2;
    if (assembly.insertNoseRadius >= maximumRadius - EPSILON) {
      errors.push(`Insert nose radius must be less than ${maximumRadius.toFixed(4)} in the assembly's internal units.`);
    }
  }
  return errors;
}

export function buildToolAssembly2d(assembly, referencePoint) {
  const errors = validateToolAssembly2d(assembly);
  if (!referencePoint || !finite(referencePoint.z) || !finite(referencePoint.x)) errors.push("Programmed tool reference point is unavailable.");
  if (errors.length) return {valid: false, errors};

  // MCLNR: the CNMG active corner opens 5° and 85° from the shank datum,
  // producing the cataloged 95° approach geometry after mounting.
  const includedAngle = assembly.insertIncludedAngle * Math.PI / 180;
  const halfAngle = includedAngle / 2;
  const axisAngle = Math.PI / 4;
  const axis = unitVector(axisAngle);
  const upperRay = unitVector(axisAngle + halfAngle);
  const lowerRay = unitVector(axisAngle - halfAngle);
  const edgeLength = assembly.insertCuttingEdgeLength;
  const upperVertex = add(referencePoint, upperRay, edgeLength);
  const oppositeVertex = add(upperVertex, lowerRay, edgeLength);

  const noseCenterDistance = assembly.insertNoseRadius / Math.sin(halfAngle);
  const noseCenter = add(referencePoint, axis, noseCenterDistance);
  const noseArc = {
    center: noseCenter,
    radius: assembly.insertNoseRadius,
    startAngle: axisAngle + Math.PI / 2 + halfAngle,
    sweep: Math.PI - includedAngle,
  };
  const insertCenter = {
    z: (referencePoint.z + oppositeVertex.z) / 2,
    x: (referencePoint.x + oppositeVertex.x) / 2,
  };

  // Rotate the catalog plan view into the lathe X/Z display: holder length is
  // radial (+X), while catalog F and B locate the shank in +Z from the tool tip.
  const shankInner = assembly.holderFDimension - assembly.holderShankWidth;
  const shankOuter = assembly.holderFDimension;
  const shankOutline = [
    catalogPoint(referencePoint, assembly.holderHeadLength, shankInner),
    catalogPoint(referencePoint, assembly.holderLength, shankInner),
    catalogPoint(referencePoint, assembly.holderLength, shankOuter),
    catalogPoint(referencePoint, assembly.holderHeadLength, shankOuter),
  ];

  const components = MCLNR164D_CAD_COMPONENTS.map((component) => ({
    role: component.role,
    outline: component.outline.map((point) => cadPoint(referencePoint, point)),
  }));
  const cadInsert = components.find((component) => component.role === "insert");
  const cadHolder = components.find((component) => component.role === "holder");

  return {
    valid: true,
    errors: [],
    id: assembly.id,
    name: assembly.name,
    manufacturer: assembly.manufacturer,
    verification: assembly.verification,
    referencePoint: {...referencePoint},
    insert: {
      body: cadInsert.outline,
      noseArc,
      hole: {center: insertCenter, radius: assembly.insertHoleDiameter / 2},
      includedAngle,
      inscribedCircle: assembly.insertIc,
      cuttingEdgeLength: edgeLength,
      thickness: assembly.insertThickness,
    },
    holder: {
      bodyOutline: cadHolder.outline,
      shankOutline,
      overallLength: assembly.holderLength,
      shankWidth: assembly.holderShankWidth,
      fDimension: assembly.holderFDimension,
      headLength: assembly.holderHeadLength,
      approachAngle: assembly.holderApproachAngle,
    },
    components,
    catalog: {
      holder: assembly.holderCatalogId,
      holderMaterialNumber: assembly.holderMaterialNumber,
      insert: assembly.insertCatalogId,
      shim: assembly.shimCatalogId,
      lockPin: assembly.lockPinCatalogId,
      clamp: assembly.clampCatalogId,
      clampScrew: assembly.clampScrewCatalogId,
      cadSource: assembly.cadSource,
      cadProjectionTolerance: assembly.cadProjectionTolerance,
    },
  };
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
