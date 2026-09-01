export const LIVE_TOOL_LIBRARY_SCHEMA_VERSION = "1.0.0";
export const LIVE_TOOL_LIBRARY_CATALOG_REVISION = "heimatec-browse-only-2026-08-31.1";
export const LIVE_TOOL_LIBRARY_RETRIEVED_ON = "2026-08-31";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function manufacturerSource(id, kind, url, extra = {}) {
  return {
    id,
    revision: 1,
    revisionRef: `${id}@1`,
    publisher: "heimatec",
    authority: "manufacturer",
    kind,
    url,
    retrievedOn: LIVE_TOOL_LIBRARY_RETRIEVED_ON,
    retention: "outbound-link-only",
    ...extra,
  };
}

const SOURCES = [
  manufacturerSource(
    "source:heimatec:801056135:drawing",
    "manufacturer-dimensioned-drawing",
    "https://heimatec.com/file/get/e8917c17-03dd-ee11-8a3f-a94d28584978/en-US",
    {publishedOn: "2024-04-11"},
  ),
  manufacturerSource(
    "source:heimatec:801056135:catalog",
    "manufacturer-catalog",
    "https://heimatec.com/file/get/d7ce78ab-59ed-ef11-8c68-965ec38886d9/en-US",
  ),
  manufacturerSource(
    "source:heimatec:801066050:product",
    "manufacturer-product-page",
    "https://heimatec.com/product-search?item=44562de3-7298-ed11-858f-c8276cf19734",
  ),
  manufacturerSource(
    "source:heimatec:801066050:step",
    "manufacturer-step-download",
    "https://heimatec.com/file/get/6096e723-0976-f111-b293-f0ac35935713/en-US",
  ),
  manufacturerSource(
    "source:heimatec:803066239:product",
    "manufacturer-product-page",
    "https://heimatec.com/product-search?item=58f24963-82c5-ea11-8429-001c42bcb3bc",
  ),
  manufacturerSource(
    "source:heimatec:803066239:drawing",
    "manufacturer-dimensioned-drawing",
    "https://heimatec.com/file/get/e50eb46a-3ae7-ee11-8b76-a94d28584978/en-US",
    {publishedOn: "2026-06-16"},
  ),
  manufacturerSource(
    "source:heimatec:803066239:step",
    "manufacturer-step-download",
    "https://heimatec.com/file/get/23a4c83b-0976-f111-b293-f0ac35935713/en-US",
  ),
  manufacturerSource(
    "source:heimatec:803066127:product",
    "manufacturer-product-page",
    "https://heimatec.com/product-search?item=d7f44da7-787b-e911-8397-001c42bcb3bc",
  ),
  manufacturerSource(
    "source:heimatec:803066127:drawing",
    "manufacturer-dimensioned-drawing",
    "https://heimatec.com/file/get/61f363ab-a5a0-ef11-8c68-965ec38886d9/en-US",
    {publishedOn: "2024-11-11"},
  ),
];

const BROWSE_ONLY_ASSIGNMENT = {
  state: "browse-only",
  assignable: false,
  scope: [],
  blockedReason: "Catalog facts and outbound manufacturer links do not establish a mounted transform, programmed reference, cutter model, stock-removal model, or collision model.",
};

const NO_SIMULATION_CLAIMS = {
  programReference: false,
  mountedTransform: false,
  cutterGeometry: false,
  stockRemoval: false,
  collision: false,
};

const RECORDS = [
  {
    id: "live-tool:heimatec:801056135",
    revision: 1,
    revisionRef: "live-tool:heimatec:801056135@1",
    manufacturer: "heimatec",
    catalogNumber: "8 010 56 135",
    name: "AXIAL 8 010 56 135",
    type: "axial",
    mount: {family: "BMT", shankDiameterMm: 54},
    massKg: 3.8,
    output: {colletSystem: "ER32 A-u-tec"},
    drive: {
      ratio: "1:1",
      rotationRelationship: "same",
      maximumTorqueNm: 50,
      maximumSpeedRpm: 15000,
    },
    coolant: {modes: ["internal", "external"], maximumPressureBar: 100},
    operatingFeatures: {dryRunPermitted: true},
    publishedDrawing: {
      publishedOn: "2024-04-11",
      units: "mm",
      xRange: {minimum: -50, maximum: 50},
      yRange: {minimum: -46, maximum: 50},
      toolEndDiameters: [58, 57],
      driveDiameter: 54,
      axialDimensions: [63, 52, 44, 15],
      anglesDegrees: [15],
      sourceRef: "source:heimatec:801056135:drawing",
    },
    sourceRefs: [
      "source:heimatec:801056135:drawing",
      "source:heimatec:801056135:catalog",
    ],
    assignment: BROWSE_ONLY_ASSIGNMENT,
    claims: NO_SIMULATION_CLAIMS,
  },
  {
    id: "live-tool:heimatec:801066050",
    revision: 1,
    revisionRef: "live-tool:heimatec:801066050@1",
    manufacturer: "heimatec",
    catalogNumber: "8 010 66 050",
    name: "AXIAL 8 010 66 050",
    type: "axial",
    mount: {shankDiameterMm: 65},
    output: {colletSystem: "ER32 A-u-tec"},
    drive: {
      ratio: "1:1",
      rotationRelationship: "same",
      maximumTorqueNm: 50,
      maximumSpeedRpm: 5000,
    },
    coolant: {modes: ["external"], maximumPressureBar: null},
    operatingFeatures: {bearing: "combi"},
    publishedDrawing: null,
    dimensionedDrawingStatus: "not-currently-published",
    sourceRefs: [
      "source:heimatec:801066050:product",
      "source:heimatec:801066050:step",
    ],
    assignment: BROWSE_ONLY_ASSIGNMENT,
    claims: NO_SIMULATION_CLAIMS,
  },
  {
    id: "live-tool:heimatec:803066239",
    revision: 1,
    revisionRef: "live-tool:heimatec:803066239@1",
    manufacturer: "heimatec",
    catalogNumber: "8 030 66 239",
    name: "RADIAL 8 030 66 239",
    type: "radial",
    mount: {family: "BMT65", shankDiameterMm: 65},
    massKg: 8.2,
    output: {colletSystem: "ER32", diameterMm: 32},
    orientation: {reversible: true, adjustmentDegrees: 180},
    drive: {
      ratio: "1:1",
      rotationRelationship: "same",
      maximumTorqueNm: 70,
      maximumSpeedRpm: 10000,
    },
    coolant: {modes: ["external"], maximumPressureBar: 140},
    publishedDrawing: {
      publishedOn: "2026-06-16",
      units: "mm",
      overallLength: 223,
      width: 96,
      height: 133,
      centerDistance: 72,
      horizontalReferenceDimensions: [111, 72],
      verticalReferenceDimensions: [83, 61],
      machineDiameter: 65,
      outputDiameter: 32,
      sourceRef: "source:heimatec:803066239:drawing",
    },
    sourceRefs: [
      "source:heimatec:803066239:product",
      "source:heimatec:803066239:drawing",
      "source:heimatec:803066239:step",
    ],
    assignment: BROWSE_ONLY_ASSIGNMENT,
    claims: NO_SIMULATION_CLAIMS,
  },
  {
    id: "live-tool:heimatec:803066127",
    revision: 1,
    revisionRef: "live-tool:heimatec:803066127@1",
    manufacturer: "heimatec",
    catalogNumber: "8 030 66 127",
    name: "RADIAL 8 030 66 127",
    type: "radial",
    mount: {shankDiameterMm: 65},
    output: {colletSystem: "ER32"},
    orientation: {reversible: true, adjustmentDegrees: 180},
    drive: {
      ratio: "2:1",
      rotationRelationship: "opposite",
      maximumTorqueNm: 63,
      maximumSpeedRpm: 3000,
    },
    coolant: {modes: ["internal", "external"], maximumPressureBar: 140},
    operatingFeatures: {bearing: "combi"},
    publishedDrawing: {
      publishedOn: "2024-11-11",
      units: "mm",
      width: 96,
      bodyRange: {minimum: -50, maximum: 50},
      centerDistance: 65,
      linearChain: [102, 99, 65, 26, 22, 13],
      machineDiameter: 65,
      toolEndDiameters: [57, 58, 68],
      anglesDegrees: [15, 20, 45],
      radius: 43,
      sourceRef: "source:heimatec:803066127:drawing",
    },
    sourceRefs: [
      "source:heimatec:803066127:product",
      "source:heimatec:803066127:drawing",
    ],
    assignment: BROWSE_ONLY_ASSIGNMENT,
    claims: NO_SIMULATION_CLAIMS,
  },
];

export const LIVE_TOOL_LIBRARY_LICENSING_BOUNDARY = deepFreeze({
  state: "factual-metadata-and-outbound-links-only",
  factualMetadataIncluded: true,
  manufacturerMaterialsCopyrighted: true,
  reusePermissionEstablished: false,
  manufacturerPdfBundled: false,
  manufacturerStepBundled: false,
  copiedOrDerivedOutlineIncluded: false,
  note: "Manufacturer drawings, catalogs, and STEP files remain at official heimatec URLs. This catalog retains factual published values and outbound links only; it does not grant reuse rights in manufacturer files or geometry.",
});

export const LIVE_TOOL_LIBRARY_CATALOG = deepFreeze({
  schemaVersion: LIVE_TOOL_LIBRARY_SCHEMA_VERSION,
  catalogRevision: LIVE_TOOL_LIBRARY_CATALOG_REVISION,
  retrievedOn: LIVE_TOOL_LIBRARY_RETRIEVED_ON,
  scope: "browse-only",
  licensingBoundary: LIVE_TOOL_LIBRARY_LICENSING_BOUNDARY,
  sources: SOURCES,
  records: RECORDS,
});

const RECORDS_BY_CATALOG_NUMBER = new Map(
  LIVE_TOOL_LIBRARY_CATALOG.records.map((record) => [record.catalogNumber.replace(/\s+/g, ""), record]),
);

function normalizeCatalogNumber(value) {
  return String(value ?? "").replace(/\s+/g, "");
}

export function listLiveToolLibraryRecords() {
  return Object.freeze([...LIVE_TOOL_LIBRARY_CATALOG.records]);
}

export function liveToolLibraryRecordByCatalogNumber(catalogNumber) {
  return RECORDS_BY_CATALOG_NUMBER.get(normalizeCatalogNumber(catalogNumber)) || null;
}
