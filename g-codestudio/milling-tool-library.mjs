export const MILLING_TOOL_LIBRARY_SCHEMA_VERSION = "1.0.0";
export const MILLING_TOOL_LIBRARY_CATALOG_REVISION = "primary-milling-seed-2026-08-31.1";
export const MILLING_TOOL_LIBRARY_RETRIEVED_ON = "2026-08-31";

const MM_PER_INCH = 25.4;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function manufacturerSource(id, publisher, kind, url) {
  return {
    id,
    revision: 1,
    revisionRef: `${id}@1`,
    publisher,
    authority: "manufacturer",
    kind,
    url,
    retrievedOn: MILLING_TOOL_LIBRARY_RETRIEVED_ON,
    retention: "outbound-link-only",
  };
}

const SOURCES = [
  manufacturerSource(
    "source:harvey-tool:771416:product",
    "Harvey Tool",
    "manufacturer-product-page",
    "https://www.harveytool.com/products/tool-details-771416",
  ),
  manufacturerSource(
    "source:harvey-tool:square-stub-standard:family",
    "Harvey Tool",
    "manufacturer-family-page",
    "https://www.harveytool.com/products/miniature-end-mills---square---stub--standard",
  ),
  manufacturerSource(
    "source:helical-solutions:12112:product",
    "Helical Solutions",
    "manufacturer-product-page",
    "https://www.helicaltool.com/products/tool-details-12112",
  ),
  manufacturerSource(
    "source:osg-usa:hp245-2500:product",
    "OSG USA",
    "manufacturer-product-page",
    "https://osgtool.com/hp245-2500/",
  ),
  manufacturerSource(
    "source:osg-usa:hp245:dimension-table",
    "OSG USA",
    "manufacturer-dimensioned-pdf",
    "https://osgtool.com/content/literature/8002024CA/List%20HP245%20-%20HY-PRO%20CARB-5D.pdf",
  ),
];

const NO_MOUNTING_CLAIMS = {
  mounting: false,
  holder: false,
  collision: false,
  mountingState: "unknown",
  holderState: "not-included",
  collisionState: "unknown",
};

function unavailableDemoCutting(blockedReason) {
  return {
    eligible: false,
    scope: [],
    reference: null,
    blockedReason,
  };
}

const RECORDS = [
  {
    id: "milling-tool:harvey-tool:771416",
    revision: 1,
    revisionRef: "milling-tool:harvey-tool:771416@1",
    geometryRevisionRef: "milling-geometry:harvey-tool:771416@1",
    manufacturer: "Harvey Tool",
    catalogNumber: "771416",
    name: "Miniature End Mill · Square · Stub & Standard",
    family: "end-mill",
    profile: "square",
    flutes: 4,
    centerCutting: true,
    material: "solid carbide",
    coating: {code: "UN", name: "uncoated"},
    publishedDimensions: {
      units: "inch",
      cutterDiameter: 0.25,
      lengthOfCut: 0.2,
      shankDiameter: 0.25,
      overallLength: 2.5,
    },
    normalizedDimensionsMm: {
      units: "mm",
      cutterDiameter: 6.35,
      lengthOfCut: 5.08,
      shankDiameter: 6.35,
      overallLength: 63.5,
    },
    sourceRefs: [
      "source:harvey-tool:771416:product",
      "source:harvey-tool:square-stub-standard:family",
    ],
    demoCuttingEligibility: {
      eligible: true,
      scope: ["demo-cutting"],
      reference: {
        type: "flat-end-mill-tip",
        units: "mm",
        axisMm: 0,
        radialMm: 0,
        geometryRevisionRef: "milling-geometry:harvey-tool:771416@1",
      },
      blockedOutsideScope: "No driven-unit mounting transform, holder envelope, or collision authority is retained.",
    },
    claims: {
      identity: true,
      publishedDimensions: true,
      parametricCuttingGeometry: true,
      demoCutting: true,
      ...NO_MOUNTING_CLAIMS,
    },
  },
  {
    id: "milling-tool:helical-solutions:12112",
    revision: 1,
    revisionRef: "milling-tool:helical-solutions:12112@1",
    geometryRevisionRef: "milling-geometry:helical-solutions:12112@1",
    manufacturer: "Helical Solutions",
    catalogNumber: "12112",
    name: "3 Flute Ball End Mill · APLUS",
    family: "end-mill",
    profile: "ball",
    flutes: 3,
    centerCutting: null,
    material: null,
    coating: {code: "APLUS", name: "APLUS"},
    publishedDimensions: {
      units: "inch",
      cutterDiameter: 0.25,
      lengthOfCut: 0.5,
      shankDiameter: 0.25,
      overallLength: 2.5,
    },
    normalizedDimensionsMm: {
      units: "mm",
      cutterDiameter: 6.35,
      lengthOfCut: 12.7,
      shankDiameter: 6.35,
      overallLength: 63.5,
    },
    sourceRefs: ["source:helical-solutions:12112:product"],
    demoCuttingEligibility: unavailableDemoCutting(
      "This seed retains a source-scaled ball profile for browsing, but no approved demo-cutting reference semantics.",
    ),
    claims: {
      identity: true,
      publishedDimensions: true,
      parametricCuttingGeometry: true,
      demoCutting: false,
      ...NO_MOUNTING_CLAIMS,
    },
  },
  {
    id: "milling-tool:osg-usa:hp245-2500",
    revision: 1,
    revisionRef: "milling-tool:osg-usa:hp245-2500@1",
    geometryRevisionRef: "milling-geometry:osg-usa:hp245-2500@1",
    manufacturer: "OSG USA",
    catalogNumber: "HP245-2500",
    name: "HY-PRO CARB HP-5D Drill",
    family: "drill",
    profile: "drill-point",
    flutes: 2,
    centerCutting: true,
    material: "carbide",
    coating: {code: "EgiAs", name: "EgiAs"},
    publishedDimensions: {
      units: "mm",
      cutterDiameter: 6.35,
      fluteLength: 53,
      shankDiameter: 8,
      overallLength: 91,
      pointAngleDegrees: 140,
    },
    normalizedDimensionsMm: {
      units: "mm",
      cutterDiameter: 6.35,
      fluteLength: 53,
      shankDiameter: 8,
      overallLength: 91,
      pointAngleDegrees: 140,
    },
    sourceRefs: [
      "source:osg-usa:hp245-2500:product",
      "source:osg-usa:hp245:dimension-table",
    ],
    demoCuttingEligibility: unavailableDemoCutting(
      "This seed retains a source-scaled drill-point profile for browsing, but no approved demo-cutting reference semantics.",
    ),
    claims: {
      identity: true,
      publishedDimensions: true,
      parametricCuttingGeometry: true,
      demoCutting: false,
      ...NO_MOUNTING_CLAIMS,
    },
  },
];

export const MILLING_TOOL_LIBRARY_LICENSING_BOUNDARY = deepFreeze({
  state: "factual-metadata-and-original-parametric-schematics",
  factualMetadataIncluded: true,
  originalParametricSchematicsIncluded: true,
  manufacturerMaterialsCopyrighted: true,
  reusePermissionEstablished: false,
  manufacturerArtworkBundled: false,
  manufacturerCadBundled: false,
  manufacturerGeometryCopiedOrDerived: false,
  note: "The catalog retains factual published dimensions and official outbound links. Schematics are original dimension-driven primitives, not copies or derivations of manufacturer artwork, DXF, STEP, or CAD.",
});

export const MILLING_TOOL_LIBRARY_CATALOG = deepFreeze({
  schemaVersion: MILLING_TOOL_LIBRARY_SCHEMA_VERSION,
  catalogRevision: MILLING_TOOL_LIBRARY_CATALOG_REVISION,
  retrievedOn: MILLING_TOOL_LIBRARY_RETRIEVED_ON,
  defaultGeometryUnits: "mm",
  scope: "catalog-and-bounded-demo-cutting",
  licensingBoundary: MILLING_TOOL_LIBRARY_LICENSING_BOUNDARY,
  sources: SOURCES,
  records: RECORDS,
});

const RECORDS_BY_ID = new Map(
  MILLING_TOOL_LIBRARY_CATALOG.records.map((record) => [record.id, record]),
);
const RECORDS_BY_CATALOG_NUMBER = new Map(
  MILLING_TOOL_LIBRARY_CATALOG.records.map((record) => [normalizeCatalogNumber(record.catalogNumber), record]),
);

function normalizeCatalogNumber(value) {
  return String(value ?? "").trim().toUpperCase().replace(/[\s_]+/g, "-");
}

function positiveNumber(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new RangeError(`${label} must be a positive finite number.`);
  }
  return numeric;
}

function segmentCount(value) {
  const numeric = Math.trunc(Number(value));
  if (!Number.isFinite(numeric) || numeric < 4) return 16;
  return Math.min(128, numeric);
}

function mirroredClosedOutline(positiveProfile) {
  return [
    ...positiveProfile,
    ...positiveProfile.slice().reverse().map(({axisMm, radiusMm}) => ({axisMm, radiusMm: -radiusMm})),
  ];
}

function schematicBase(profile, dimensionsMm, cuttingProfile, shankProfile, extra = {}) {
  const positiveEnvelope = [...cuttingProfile];
  const lastCutting = positiveEnvelope.at(-1);
  for (const point of shankProfile) {
    if (point.axisMm !== lastCutting?.axisMm || point.radiusMm !== lastCutting?.radiusMm) {
      positiveEnvelope.push(point);
    }
  }
  return deepFreeze({
    kind: "original-parametric-axial-schematic",
    profile,
    units: "mm",
    origin: "tool-tip-axis-center",
    axialDirection: "positive-toward-shank",
    dimensionsMm,
    cuttingProfile,
    shankProfile,
    outline: mirroredClosedOutline(positiveEnvelope),
    manufacturerArtworkUsed: false,
    manufacturerCadUsed: false,
    mountingGeometryIncluded: false,
    holderGeometryIncluded: false,
    collisionGeometryIncluded: false,
    ...extra,
  });
}

export function parametricFlatEndMillSchematicMm(dimensionsMm) {
  const cutterDiameter = positiveNumber(dimensionsMm?.cutterDiameter, "Cutter diameter");
  const lengthOfCut = positiveNumber(dimensionsMm?.lengthOfCut, "Length of cut");
  const shankDiameter = positiveNumber(dimensionsMm?.shankDiameter, "Shank diameter");
  const overallLength = positiveNumber(dimensionsMm?.overallLength, "Overall length");
  if (lengthOfCut > overallLength) throw new RangeError("Length of cut cannot exceed overall length.");
  const normalized = {
    units: "mm", cutterDiameter, lengthOfCut, shankDiameter, overallLength,
  };
  const cuttingRadius = cutterDiameter / 2;
  const shankRadius = shankDiameter / 2;
  return schematicBase(
    "square",
    normalized,
    [{axisMm: 0, radiusMm: cuttingRadius}, {axisMm: lengthOfCut, radiusMm: cuttingRadius}],
    [{axisMm: lengthOfCut, radiusMm: shankRadius}, {axisMm: overallLength, radiusMm: shankRadius}],
    {
      cuttingTip: {type: "flat-end-mill-tip", axisMm: 0},
      transitionAuthority: "schematic-only",
    },
  );
}

export function parametricBallEndMillSchematicMm(dimensionsMm, {curveSegments = 16} = {}) {
  const cutterDiameter = positiveNumber(dimensionsMm?.cutterDiameter, "Cutter diameter");
  const lengthOfCut = positiveNumber(dimensionsMm?.lengthOfCut, "Length of cut");
  const shankDiameter = positiveNumber(dimensionsMm?.shankDiameter, "Shank diameter");
  const overallLength = positiveNumber(dimensionsMm?.overallLength, "Overall length");
  const radius = cutterDiameter / 2;
  if (lengthOfCut < radius) throw new RangeError("Ball-end length of cut cannot be shorter than the ball radius.");
  if (lengthOfCut > overallLength) throw new RangeError("Length of cut cannot exceed overall length.");
  const count = segmentCount(curveSegments);
  const cuttingProfile = [];
  for (let index = 0; index <= count; index += 1) {
    if (index === 0) {
      cuttingProfile.push({axisMm: 0, radiusMm: 0});
      continue;
    }
    if (index === count) {
      cuttingProfile.push({axisMm: radius, radiusMm: radius});
      continue;
    }
    const theta = Math.PI / 2 - (Math.PI / 2) * index / count;
    cuttingProfile.push({
      axisMm: radius - Math.sin(theta) * radius,
      radiusMm: Math.cos(theta) * radius,
    });
  }
  if (lengthOfCut > radius) cuttingProfile.push({axisMm: lengthOfCut, radiusMm: radius});
  const normalized = {
    units: "mm", cutterDiameter, lengthOfCut, shankDiameter, overallLength, ballRadius: radius,
  };
  const shankRadius = shankDiameter / 2;
  return schematicBase(
    "ball",
    normalized,
    cuttingProfile,
    [{axisMm: lengthOfCut, radiusMm: shankRadius}, {axisMm: overallLength, radiusMm: shankRadius}],
    {
      cuttingTip: {type: "ball-end-mill-apex", axisMm: 0},
      transitionAuthority: "schematic-only",
    },
  );
}

export function parametricDrillSchematicMm(dimensionsMm) {
  const cutterDiameter = positiveNumber(dimensionsMm?.cutterDiameter, "Cutter diameter");
  const fluteLength = positiveNumber(dimensionsMm?.fluteLength, "Flute length");
  const shankDiameter = positiveNumber(dimensionsMm?.shankDiameter, "Shank diameter");
  const overallLength = positiveNumber(dimensionsMm?.overallLength, "Overall length");
  const pointAngleDegrees = positiveNumber(dimensionsMm?.pointAngleDegrees, "Point angle");
  if (pointAngleDegrees >= 180) throw new RangeError("Point angle must be less than 180 degrees.");
  if (fluteLength > overallLength) throw new RangeError("Flute length cannot exceed overall length.");
  const cutterRadius = cutterDiameter / 2;
  const halfAngleRadians = pointAngleDegrees * Math.PI / 360;
  const pointLength = cutterRadius / Math.tan(halfAngleRadians);
  if (!(pointLength < fluteLength)) throw new RangeError("Drill point length must fit inside the flute length.");
  const normalized = {
    units: "mm", cutterDiameter, fluteLength, shankDiameter, overallLength, pointAngleDegrees,
  };
  const shankRadius = shankDiameter / 2;
  return schematicBase(
    "drill-point",
    normalized,
    [
      {axisMm: 0, radiusMm: 0},
      {axisMm: pointLength, radiusMm: cutterRadius},
      {axisMm: fluteLength, radiusMm: cutterRadius},
    ],
    [{axisMm: fluteLength, radiusMm: shankRadius}, {axisMm: overallLength, radiusMm: shankRadius}],
    {
      cuttingTip: {type: "drill-point-apex", axisMm: 0},
      pointLengthMm: pointLength,
      transitionAuthority: "schematic-only",
    },
  );
}

function resolveRecord(recordOrId) {
  if (recordOrId && typeof recordOrId === "object") {
    const resolved = RECORDS_BY_ID.get(String(recordOrId.id ?? ""));
    if (resolved === recordOrId) return resolved;
  }
  const value = String(recordOrId ?? "");
  const record = RECORDS_BY_ID.get(value) || RECORDS_BY_CATALOG_NUMBER.get(normalizeCatalogNumber(value));
  if (!record) throw new RangeError(`Unknown milling-tool record: ${value || "(empty)"}`);
  return record;
}

export function millingToolGeometryMm(recordOrId, options = {}) {
  const record = resolveRecord(recordOrId);
  if (record.profile === "square") {
    return parametricFlatEndMillSchematicMm(record.normalizedDimensionsMm);
  }
  if (record.profile === "ball") {
    return parametricBallEndMillSchematicMm(record.normalizedDimensionsMm, options);
  }
  if (record.profile === "drill-point") {
    return parametricDrillSchematicMm(record.normalizedDimensionsMm);
  }
  throw new RangeError(`Unsupported milling-tool profile: ${record.profile}`);
}

export function listMillingToolLibraryRecords() {
  return Object.freeze([...MILLING_TOOL_LIBRARY_CATALOG.records]);
}

export function millingToolLibraryRecordById(id) {
  return RECORDS_BY_ID.get(String(id ?? "")) || null;
}

export function millingToolLibraryRecordByCatalogNumber(catalogNumber) {
  return RECORDS_BY_CATALOG_NUMBER.get(normalizeCatalogNumber(catalogNumber)) || null;
}

export function inchesToMillimeters(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new TypeError("Inch value must be finite.");
  return numeric * MM_PER_INCH;
}
