export const TOOL_LIBRARY_SCHEMA_VERSION = "1.0.0";
export const TOOL_LIBRARY_CATALOG_REVISION = "kennametal-seed-2026-08-30.1";
export const TOOL_LIBRARY_RETRIEVED_ON = "2026-08-30";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function sourceRecord(id, kind, url, extra = {}) {
  return {
    id,
    revision: 1,
    revisionRef: `${id}@1`,
    publisher: "Kennametal",
    authority: "manufacturer",
    kind,
    url,
    retrievedOn: TOOL_LIBRARY_RETRIEVED_ON,
    ...extra,
  };
}

const SOURCE_RECORDS = [
  sourceRecord(
    "source:kennametal:holder:1096070:product-page",
    "manufacturer-product-page",
    "https://www.kennametal.com/us/en/products/p.mcln-5.1096070.html",
  ),
  sourceRecord(
    "source:kennametal:holder:1096070:cad-step",
    "manufacturer-cad-step",
    "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/zip-g/MCLNR164D_GTM.stp",
    {sha256: "deba0c11ac8ae90b23e7b79757988a75e7ae68337e38c5939eedcdd9bd81a80a"},
  ),
  sourceRecord(
    "source:kennametal:holder:1096070:cad-manifest",
    "manufacturer-cad-manifest",
    "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/json/MCLNR164D_GTM/MCLNR164D_GTM.json",
    {sha256: "d02bcbd96406059758d0cd13bcaed09dc4769fff0d0bac051bfe2f5a235d46a2"},
  ),
  sourceRecord(
    "source:kennametal:insert:1159602:product-page",
    "manufacturer-product-page",
    "https://www.kennametal.com/us/en/products/p.cnmg.1159602.html",
  ),
  sourceRecord(
    "source:kennametal:insert:1159602:cad-step",
    "manufacturer-cad-step",
    "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/zip-g/CNMG120408_GTM.stp",
  ),
  sourceRecord(
    "source:kennametal:holder:1096068:product-page",
    "manufacturer-product-page",
    "https://www.kennametal.com/us/en/products/p.mcln-5.1096068.html",
  ),
  sourceRecord(
    "source:kennametal:holder:1096068:cad-step",
    "manufacturer-cad-step",
    "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/zip-g/MCLNR163C_GTM.stp",
  ),
  sourceRecord(
    "source:kennametal:insert:1158184:product-page",
    "manufacturer-product-page",
    "https://www.kennametal.com/us/en/products/p.cnmg-p.1158184.html",
  ),
  sourceRecord(
    "source:kennametal:insert:1158184:cad-step",
    "manufacturer-cad-step",
    "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/zip-g/CNMG090308P_GTM.stp",
  ),
  sourceRecord(
    "source:kennametal:holder:1096245:product-page",
    "manufacturer-product-page",
    "https://www.kennametal.com/us/en/products/p.mdjn-3.1096245.html",
  ),
  sourceRecord(
    "source:kennametal:holder:1096245:cad-step",
    "manufacturer-cad-step",
    "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/zip-g/MDJNR164D_GTM.stp",
  ),
  sourceRecord(
    "source:kennametal:insert:1159612:product-page",
    "manufacturer-product-page",
    "https://www.kennametal.com/us/en/products/p.dnmg.1159612.html",
  ),
  sourceRecord(
    "source:kennametal:insert:1159612:cad-step",
    "manufacturer-cad-step",
    "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/zip-g/DNMG150408B_GTM.stp",
  ),
  sourceRecord(
    "source:kennametal:holder:1096291:product-page",
    "manufacturer-product-page",
    "https://www.kennametal.com/us/en/products/p.mvjn-3.1096291.html",
  ),
  sourceRecord(
    "source:kennametal:holder:1096291:cad-step",
    "manufacturer-cad-step",
    "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/zip-g/MVJNR164D_GTM.stp",
  ),
  sourceRecord(
    "source:kennametal:insert:1160070:product-page",
    "manufacturer-product-page",
    "https://www.kennametal.com/us/en/products/p.vnmg.1160070.html",
  ),
  sourceRecord(
    "source:kennametal:insert:1160070:cad-step",
    "manufacturer-cad-step",
    "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/zip-g/VNMG220408_GTM.stp",
  ),
  sourceRecord(
    "source:kennametal:holder:1016462:product-page",
    "manufacturer-product-page",
    "https://www.kennametal.com/us/en/products/p.ns.1016462.html",
  ),
  sourceRecord(
    "source:kennametal:holder:1016462:cad-step",
    "manufacturer-cad-step",
    "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/zip-g/NSR163D_GTM.stp",
  ),
  sourceRecord(
    "source:kennametal:insert:4109881:product-page",
    "manufacturer-product-page",
    "https://www.kennametal.com/us/en/products/p.np-k-groove-and-profile-back-turning-chip-control.4109881.html",
  ),
  sourceRecord(
    "source:kennametal:insert:4109881:cad-step",
    "manufacturer-cad-step",
    "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/zip-g/NP3002RK_GTM.stp",
  ),
];

const HOLDERS = [
  {
    id: "holder:kennametal:1096070",
    revision: 1,
    revisionRef: "holder:kennametal:1096070@1",
    manufacturer: "Kennametal",
    materialNumber: "1096070",
    catalogId: {iso: "MCLNR164D", ansi: "MCLNR164D"},
    hand: "right",
    gageInsert: "CN..432",
    dimensions: {
      units: "mm",
      shankHeight: 25.4,
      shankWidth: 25.4,
      fDimension: 31.75,
      overallLength: 152.4,
      headLength: 30.556,
    },
    cuttingGeometry: {
      application: "external-turning",
      approachAngleDegrees: 95,
      leadAngleDegrees: -5,
      insertShape: "C",
      insertIncludedAngleDegrees: 80,
    },
    officialCadAvailable: true,
    sourceRefs: [
      "source:kennametal:holder:1096070:product-page",
      "source:kennametal:holder:1096070:cad-step",
      "source:kennametal:holder:1096070:cad-manifest",
    ],
  },
  {
    id: "holder:kennametal:1096068",
    revision: 1,
    revisionRef: "holder:kennametal:1096068@1",
    manufacturer: "Kennametal",
    materialNumber: "1096068",
    catalogId: {iso: "MCLNR163C", ansi: "MCLNR163C"},
    hand: "right",
    gageInsert: "CN..322",
    dimensions: {
      units: "mm",
      shankHeight: 25.4,
      shankWidth: 25.4,
      fDimension: 31.75,
      overallLength: 127,
      headLength: 25.4,
    },
    cuttingGeometry: {
      application: "external-turning",
      approachAngleDegrees: 95,
      leadAngleDegrees: -5,
      insertShape: "C",
      insertIncludedAngleDegrees: 80,
    },
    officialCadAvailable: true,
    sourceRefs: [
      "source:kennametal:holder:1096068:product-page",
      "source:kennametal:holder:1096068:cad-step",
    ],
  },
  {
    id: "holder:kennametal:1096245",
    revision: 1,
    revisionRef: "holder:kennametal:1096245@1",
    manufacturer: "Kennametal",
    materialNumber: "1096245",
    catalogId: {iso: "MDJNR164D", ansi: "MDJNR164D"},
    hand: "right",
    gageInsert: "DN..432",
    dimensions: {
      units: "mm",
      shankHeight: 25.4,
      shankWidth: 25.4,
      fDimension: 31.75,
      overallLength: 152.4,
      headLength: 31.496,
    },
    cuttingGeometry: {
      application: "external-turning",
      approachAngleDegrees: 93,
      leadAngleDegrees: -3,
      insertShape: "D",
      insertIncludedAngleDegrees: 55,
    },
    officialCadAvailable: true,
    sourceRefs: [
      "source:kennametal:holder:1096245:product-page",
      "source:kennametal:holder:1096245:cad-step",
    ],
  },
  {
    id: "holder:kennametal:1096291",
    revision: 1,
    revisionRef: "holder:kennametal:1096291@1",
    manufacturer: "Kennametal",
    materialNumber: "1096291",
    catalogId: {iso: "MVJNR164D", ansi: "MVJNR164D"},
    hand: "right",
    gageInsert: "VN..432",
    dimensions: {
      units: "mm",
      shankHeight: 25.4,
      shankWidth: 25.4,
      fDimension: 31.75,
      overallLength: 152.4,
      headLength: 50.8,
    },
    cuttingGeometry: {
      application: "external-turning",
      approachAngleDegrees: 93,
      leadAngleDegrees: -3,
      insertShape: "V",
      insertIncludedAngleDegrees: 35,
    },
    officialCadAvailable: true,
    sourceRefs: [
      "source:kennametal:holder:1096291:product-page",
      "source:kennametal:holder:1096291:cad-step",
    ],
  },
  {
    id: "holder:kennametal:1016462",
    revision: 1,
    revisionRef: "holder:kennametal:1016462@1",
    manufacturer: "Kennametal",
    materialNumber: "1016462",
    catalogId: {iso: "NSR163D", ansi: "NSR163D"},
    hand: "right",
    gageInsert: "N.3R",
    dimensions: {
      units: "mm",
      shankHeight: 25.4,
      shankWidth: 25.4,
      fDimension: 31.75,
      overallLength: 152.4,
      headLength: 31.75,
      endChamfer: 12.7,
      cuttingDepth: 5.334,
    },
    cuttingGeometry: {
      application: "external-grooving-back-turning",
      approachAngleDegrees: 90,
      insertShape: "groove",
    },
    officialCadAvailable: true,
    sourceRefs: [
      "source:kennametal:holder:1016462:product-page",
      "source:kennametal:holder:1016462:cad-step",
    ],
  },
];

const INSERTS = [
  {
    id: "insert:kennametal:1159602",
    revision: 1,
    revisionRef: "insert:kennametal:1159602@1",
    manufacturer: "Kennametal",
    materialNumber: "1159602",
    catalogId: {iso: "CNMG120408", ansi: "CNMG432"},
    grade: "KC730",
    hand: "neutral",
    dimensions: {
      units: "mm",
      inscribedCircle: 12.7,
      cuttingEdgeLength: 12.896,
      thickness: 4.76,
      noseRadius: 0.8,
      holeDiameter: 5.16,
    },
    cuttingGeometry: {shape: "C", includedAngleDegrees: 80},
    officialCadAvailable: true,
    sourceRefs: [
      "source:kennametal:insert:1159602:product-page",
      "source:kennametal:insert:1159602:cad-step",
    ],
  },
  {
    id: "insert:kennametal:1158184",
    revision: 1,
    revisionRef: "insert:kennametal:1158184@1",
    manufacturer: "Kennametal",
    materialNumber: "1158184",
    catalogId: {iso: "CNMG090308P", ansi: "CNMG322P"},
    baseSizeClass: "CNMG322",
    grade: "KC730",
    hand: "neutral",
    dimensions: {
      units: "mm",
      inscribedCircle: 9.525,
      cuttingEdgeLength: 9.672,
      thickness: 3.18,
      noseRadius: 0.8,
      holeDiameter: 3.81,
    },
    cuttingGeometry: {shape: "C", includedAngleDegrees: 80},
    officialCadAvailable: true,
    sourceRefs: [
      "source:kennametal:insert:1158184:product-page",
      "source:kennametal:insert:1158184:cad-step",
    ],
  },
  {
    id: "insert:kennametal:1159612",
    revision: 1,
    revisionRef: "insert:kennametal:1159612@1",
    manufacturer: "Kennametal",
    materialNumber: "1159612",
    catalogId: {iso: "DNMG150408B", ansi: "DNMG432"},
    grade: "KC730",
    hand: "neutral",
    dimensions: {
      units: "mm",
      inscribedCircle: 12.7,
      cuttingEdgeLength: 15.504,
      thickness: 4.762,
      noseRadius: 0.8,
      holeDiameter: 5.156,
    },
    cuttingGeometry: {shape: "D", includedAngleDegrees: 55},
    officialCadAvailable: true,
    sourceRefs: [
      "source:kennametal:insert:1159612:product-page",
      "source:kennametal:insert:1159612:cad-step",
    ],
  },
  {
    id: "insert:kennametal:1160070",
    revision: 1,
    revisionRef: "insert:kennametal:1160070@1",
    manufacturer: "Kennametal",
    materialNumber: "1160070",
    catalogId: {iso: "VNMG220408", ansi: "VNMG432"},
    grade: "K68",
    hand: "neutral",
    dimensions: {
      units: "mm",
      inscribedCircle: 12.7,
      cuttingEdgeLength: 22.142,
      thickness: 4.763,
      noseRadius: 0.8,
      holeDiameter: 5.16,
    },
    cuttingGeometry: {shape: "V", includedAngleDegrees: 35},
    officialCadAvailable: true,
    sourceRefs: [
      "source:kennametal:insert:1160070:product-page",
      "source:kennametal:insert:1160070:cad-step",
    ],
  },
  {
    id: "insert:kennametal:4109881",
    revision: 1,
    revisionRef: "insert:kennametal:4109881@1",
    manufacturer: "Kennametal",
    materialNumber: "4109881",
    catalogId: {iso: "NP3002RK", ansi: "NP3002RK"},
    grade: "KCU25",
    hand: "right",
    dimensions: {
      units: "mm",
      cuttingWidth: 4.88,
      profileApMaximum: 3.84,
      cornerRadius: 0.1,
      cuttingDepth: 5.08,
    },
    cuttingGeometry: {shape: "groove", application: "groove-profile-back-turning"},
    officialCadAvailable: true,
    sourceRefs: [
      "source:kennametal:insert:4109881:product-page",
      "source:kennametal:insert:4109881:cad-step",
    ],
  },
];

const COMPATIBILITY_EDGES = [
  {
    id: "compatibility:kennametal:1096070+1159602",
    revision: 1,
    revisionRef: "compatibility:kennametal:1096070+1159602@1",
    holderRevisionRef: "holder:kennametal:1096070@1",
    insertRevisionRef: "insert:kennametal:1159602@1",
    state: "manufacturer-listed-compatible",
    compatible: true,
    evidence: "The holder specifies gage insert CN..432 and lists material 1159602 as a compatible workpiece-side part.",
    sourceRefs: [
      "source:kennametal:holder:1096070:product-page",
      "source:kennametal:insert:1159602:product-page",
    ],
  },
  {
    id: "compatibility:kennametal:1096068+1158184",
    revision: 1,
    revisionRef: "compatibility:kennametal:1096068+1158184@1",
    holderRevisionRef: "holder:kennametal:1096068@1",
    insertRevisionRef: "insert:kennametal:1158184@1",
    state: "manufacturer-listed-compatible",
    compatible: true,
    evidence: "The holder specifies gage insert CN..322 and lists material 1158184; the insert page reciprocally lists holder material 1096068.",
    sourceRefs: [
      "source:kennametal:holder:1096068:product-page",
      "source:kennametal:insert:1158184:product-page",
    ],
  },
  {
    id: "compatibility:kennametal:1096245+1159612",
    revision: 1,
    revisionRef: "compatibility:kennametal:1096245+1159612@1",
    holderRevisionRef: "holder:kennametal:1096245@1",
    insertRevisionRef: "insert:kennametal:1159612@1",
    state: "manufacturer-listed-compatible",
    compatible: true,
    evidence: "The holder specifies gage insert DN..432 and lists material 1159612 as a compatible workpiece-side part.",
    sourceRefs: [
      "source:kennametal:holder:1096245:product-page",
      "source:kennametal:insert:1159612:product-page",
    ],
  },
  {
    id: "compatibility:kennametal:1096291+1160070",
    revision: 1,
    revisionRef: "compatibility:kennametal:1096291+1160070@1",
    holderRevisionRef: "holder:kennametal:1096291@1",
    insertRevisionRef: "insert:kennametal:1160070@1",
    state: "manufacturer-listed-compatible",
    compatible: true,
    evidence: "The holder specifies gage insert VN..432 and lists material 1160070; the insert page lists holder material 1096291.",
    sourceRefs: [
      "source:kennametal:holder:1096291:product-page",
      "source:kennametal:insert:1160070:product-page",
    ],
  },
  {
    id: "compatibility:kennametal:1016462+4109881",
    revision: 1,
    revisionRef: "compatibility:kennametal:1016462+4109881@1",
    holderRevisionRef: "holder:kennametal:1016462@1",
    insertRevisionRef: "insert:kennametal:4109881@1",
    state: "manufacturer-listed-compatible",
    compatible: true,
    evidence: "The insert page lists NSR163D holder material 1016462 as a compatible machine-side part.",
    sourceRefs: [
      "source:kennametal:holder:1016462:product-page",
      "source:kennametal:insert:4109881:product-page",
    ],
  },
];

function manufacturerClaim(sourceRefs) {
  return {
    state: "manufacturer-published",
    available: true,
    assignable: false,
    sourceRefs,
  };
}

function unavailableClaim(state, blockedReason, sourceRefs = []) {
  return {
    state,
    available: false,
    assignable: false,
    blockedReason,
    sourceRefs,
  };
}

function catalogOnlyClaims(holderSourceRef, insertSourceRef, compatibilitySourceRefs) {
  const catalogSourceRefs = [holderSourceRef, insertSourceRef];
  return {
    identity: manufacturerClaim(catalogSourceRefs),
    dimensions: manufacturerClaim(catalogSourceRefs),
    compatibility: manufacturerClaim(compatibilitySourceRefs),
    displayGeometry: unavailableClaim(
      "catalog-record-only",
      "Official downloadable CAD exists, but no retained 2D projection revision and mounted reference transform have been validated for this assembly.",
      catalogSourceRefs,
    ),
    mountedReference: unavailableClaim(
      "unavailable",
      "No authoritative mounted cutting-reference point and app transform are retained for this assembly. Catalog F/L1 dimensions and CAD bounds cannot be used as a substitute.",
      catalogSourceRefs,
    ),
    cuttingModel: unavailableClaim(
      "unavailable",
      "Compatibility and catalog dimensions do not establish programmed-tip semantics, permitted cutting direction, or stock-removal authority.",
      catalogSourceRefs,
    ),
    collisionModel: unavailableClaim(
      "unavailable",
      "No validated holder/insert/turret collision solid, tolerance, or mounted transform is retained.",
      catalogSourceRefs,
    ),
  };
}

const CATALOG_ONLY_ASSIGNMENT = {
  state: "blocked",
  assignable: false,
  scope: [],
  blockedReason: "This is a searchable catalog record only. Mounted display/reference assignment must fail closed until both claims have retained evidence.",
};

const ASSEMBLIES = [
  {
    id: "kennametal-mclnr164d-cnmg432",
    revision: 3,
    revisionRef: "assembly:kennametal:mclnr164d+cnmg432@3",
    name: "Kennametal MCLNR164D + CNMG432 · RH",
    manufacturer: "Kennametal",
    holderRevisionRef: "holder:kennametal:1096070@1",
    insertRevisionRef: "insert:kennametal:1159602@1",
    compatibilityRevisionRef: "compatibility:kennametal:1096070+1159602@1",
    facets: {
      shape: "C",
      family: "turning",
      hand: "right",
      insertIcInches: 0.5,
      applications: ["external", "turning", "profiling", "facing"],
    },
    catalogRecordOnly: false,
    assignment: {
      state: "mounted-display-only",
      assignable: true,
      scope: ["displayGeometry", "mountedReference"],
      blockedOutsideScope: "Cutting and collision claims remain unavailable and are not authorized by this mounted display assignment.",
    },
    claims: {
      identity: manufacturerClaim([
        "source:kennametal:holder:1096070:product-page",
        "source:kennametal:insert:1159602:product-page",
      ]),
      dimensions: manufacturerClaim([
        "source:kennametal:holder:1096070:product-page",
        "source:kennametal:insert:1159602:product-page",
      ]),
      compatibility: manufacturerClaim([
        "source:kennametal:holder:1096070:product-page",
        "source:kennametal:insert:1159602:product-page",
      ]),
      displayGeometry: {
        state: "manufacturer-cad-projection",
        available: true,
        assignable: true,
        revisionRef: "kennametal-mclnr164d-gtm-top-plan-v1",
        projection: "Official GTM top-plan holder-body and mounted-insert display projection; stroke-only and display-only.",
        sourceRefs: [
          "source:kennametal:holder:1096070:cad-step",
          "source:kennametal:holder:1096070:cad-manifest",
        ],
      },
      mountedReference: {
        state: "manufacturer-cad-reference",
        available: true,
        assignable: true,
        revisionRef: "kennametal-mclnr164d-gtm-crp-v1",
        reference: {
          type: "manufacturer-cutting-reference-point",
          coordinateSystem: "Kennametal MCLNR164D GTM model XYZ",
          coordinateOrder: ["x", "y", "z"],
          units: "mm",
          point: [-31.75, 25.4, -152.4],
          displayTransformRef: "kennametal-mclnr164d-gtm-top-plan-v1",
        },
        sourceRefs: [
          "source:kennametal:holder:1096070:cad-step",
          "source:kennametal:holder:1096070:cad-manifest",
        ],
      },
      cuttingModel: unavailableClaim(
        "separate-unvalidated-model",
        "The retained CAD display/reference does not validate configured program-tip semantics, permitted cutting direction, or stock-removal authority.",
        ["source:kennametal:holder:1096070:product-page", "source:kennametal:insert:1159602:product-page"],
      ),
      collisionModel: unavailableClaim(
        "unavailable",
        "The retained stroke-only display omits hardware and has no collision tolerance or complete mounted solid authority.",
        ["source:kennametal:holder:1096070:cad-step"],
      ),
    },
  },
  {
    id: "kennametal-mclnr163c-cnmg322p",
    revision: 1,
    revisionRef: "assembly:kennametal:mclnr163c+cnmg322p@1",
    name: "Kennametal MCLNR163C + CNMG322P · RH",
    manufacturer: "Kennametal",
    holderRevisionRef: "holder:kennametal:1096068@1",
    insertRevisionRef: "insert:kennametal:1158184@1",
    compatibilityRevisionRef: "compatibility:kennametal:1096068+1158184@1",
    facets: {
      shape: "C",
      family: "turning",
      hand: "right",
      insertIcInches: 0.375,
      applications: ["external", "turning", "profiling", "facing"],
    },
    catalogRecordOnly: true,
    assignment: CATALOG_ONLY_ASSIGNMENT,
    claims: catalogOnlyClaims(
      "source:kennametal:holder:1096068:product-page",
      "source:kennametal:insert:1158184:product-page",
      ["source:kennametal:holder:1096068:product-page", "source:kennametal:insert:1158184:product-page"],
    ),
  },
  {
    id: "kennametal-mdjnr164d-dnmg432",
    revision: 1,
    revisionRef: "assembly:kennametal:mdjnr164d+dnmg432@1",
    name: "Kennametal MDJNR164D + DNMG432 · RH",
    manufacturer: "Kennametal",
    holderRevisionRef: "holder:kennametal:1096245@1",
    insertRevisionRef: "insert:kennametal:1159612@1",
    compatibilityRevisionRef: "compatibility:kennametal:1096245+1159612@1",
    facets: {
      shape: "D",
      family: "turning",
      hand: "right",
      insertIcInches: 0.5,
      applications: ["external", "turning", "profiling"],
    },
    catalogRecordOnly: true,
    assignment: CATALOG_ONLY_ASSIGNMENT,
    claims: catalogOnlyClaims(
      "source:kennametal:holder:1096245:product-page",
      "source:kennametal:insert:1159612:product-page",
      ["source:kennametal:holder:1096245:product-page", "source:kennametal:insert:1159612:product-page"],
    ),
  },
  {
    id: "kennametal-mvjnr164d-vnmg432",
    revision: 1,
    revisionRef: "assembly:kennametal:mvjnr164d+vnmg432@1",
    name: "Kennametal MVJNR164D + VNMG432 · RH",
    manufacturer: "Kennametal",
    holderRevisionRef: "holder:kennametal:1096291@1",
    insertRevisionRef: "insert:kennametal:1160070@1",
    compatibilityRevisionRef: "compatibility:kennametal:1096291+1160070@1",
    facets: {
      shape: "V",
      family: "turning",
      hand: "right",
      insertIcInches: 0.5,
      applications: ["external", "turning", "profiling"],
    },
    catalogRecordOnly: true,
    assignment: CATALOG_ONLY_ASSIGNMENT,
    claims: catalogOnlyClaims(
      "source:kennametal:holder:1096291:product-page",
      "source:kennametal:insert:1160070:product-page",
      ["source:kennametal:holder:1096291:product-page", "source:kennametal:insert:1160070:product-page"],
    ),
  },
  {
    id: "kennametal-nsr163d-np3002rk-back-turn",
    revision: 2,
    revisionRef: "assembly:kennametal:nsr163d+np3002rk@2",
    name: "Kennametal NSR163D + NP3002RK · Groove/back turn RH",
    manufacturer: "Kennametal",
    holderRevisionRef: "holder:kennametal:1016462@1",
    insertRevisionRef: "insert:kennametal:4109881@1",
    compatibilityRevisionRef: "compatibility:kennametal:1016462+4109881@1",
    facets: {
      shape: "groove",
      family: "grooving",
      hand: "right",
      insertIcInches: null,
      applications: ["external", "grooving", "profiling", "back-turning"],
    },
    catalogRecordOnly: true,
    assignment: CATALOG_ONLY_ASSIGNMENT,
    claims: catalogOnlyClaims(
      "source:kennametal:holder:1016462:product-page",
      "source:kennametal:insert:4109881:product-page",
      ["source:kennametal:holder:1016462:product-page", "source:kennametal:insert:4109881:product-page"],
    ),
  },
];

const FACET_LABELS = {
  shape: new Map([
    ["C", "C · 80° diamond"],
    ["D", "D · 55° diamond"],
    ["V", "V · 35° diamond"],
    ["groove", "Groove / back-turn"],
  ]),
  family: new Map([
    ["turning", "External turning"],
    ["grooving", "External grooving"],
  ]),
  hand: new Map([["right", "Right hand"]]),
};

function buildFacet(field, values) {
  return values.map((value) => ({
    value,
    label: FACET_LABELS[field].get(value),
    count: ASSEMBLIES.filter((assembly) => assembly.facets[field] === value).length,
  }));
}

const FACETS = {
  shape: buildFacet("shape", ["C", "D", "V", "groove"]),
  family: buildFacet("family", ["turning", "grooving"]),
  hand: buildFacet("hand", ["right"]),
};

export const TOOL_LIBRARY_CATALOG = deepFreeze({
  schemaVersion: TOOL_LIBRARY_SCHEMA_VERSION,
  catalogRevision: TOOL_LIBRARY_CATALOG_REVISION,
  retrievedOn: TOOL_LIBRARY_RETRIEVED_ON,
  defaultUnits: "mm",
  manufacturerScope: ["Kennametal"],
  sources: SOURCE_RECORDS,
  holders: HOLDERS,
  inserts: INSERTS,
  compatibilityEdges: COMPATIBILITY_EDGES,
  assemblies: ASSEMBLIES,
  facets: FACETS,
});

export const TOOL_LIBRARY_FACETS = TOOL_LIBRARY_CATALOG.facets;

/**
 * Construct a standalone, source-scaled plan outline for a diamond insert.
 * This is component geometry only: it does not establish a mounted transform,
 * programmed reference, cutting direction, stock-removal model, or collision model.
 */
export function catalogDiamondInsertOutline2d({includedAngleDegrees, inscribedCircle, noseRadius = 0}, {segmentsPerFillet = 8} = {}) {
  const angle = Number(includedAngleDegrees);
  const ic = Number(inscribedCircle);
  const requestedRadius = Number(noseRadius);
  const segmentCount = Math.max(2, Math.min(64, Math.trunc(Number(segmentsPerFillet) || 8)));
  if (!(angle > 0 && angle < 180) || !(ic > 0) || !(requestedRadius >= 0)) {
    throw new RangeError("Catalog insert plan requires a 0–180° included angle, positive IC, and nonnegative nose radius.");
  }
  const halfAngle = angle * Math.PI / 360;
  const inradius = ic / 2;
  const longHalf = inradius / Math.sin(halfAngle);
  const shortHalf = inradius / Math.cos(halfAngle);
  const vertices = [
    {x: longHalf, y: 0}, {x: 0, y: shortHalf}, {x: -longHalf, y: 0}, {x: 0, y: -shortHalf},
  ];
  const points = [];
  const fillets = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const previous = vertices[(index + vertices.length - 1) % vertices.length];
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    const towardPrevious = {x: previous.x - current.x, y: previous.y - current.y};
    const towardNext = {x: next.x - current.x, y: next.y - current.y};
    const previousLength = Math.hypot(towardPrevious.x, towardPrevious.y);
    const nextLength = Math.hypot(towardNext.x, towardNext.y);
    const uPrevious = {x: towardPrevious.x / previousLength, y: towardPrevious.y / previousLength};
    const uNext = {x: towardNext.x / nextLength, y: towardNext.y / nextLength};
    const interiorAngle = Math.acos(Math.max(-1, Math.min(1, uPrevious.x * uNext.x + uPrevious.y * uNext.y)));
    const maximumRadius = Math.min(previousLength, nextLength) * Math.tan(interiorAngle / 2) / 2;
    const filletRadius = Math.min(requestedRadius, maximumRadius);
    if (filletRadius <= 1e-9) {
      points.push(current);
      fillets.push({center: current, radius: 0, sweepRadians: 0});
      continue;
    }
    const tangentDistance = filletRadius / Math.tan(interiorAngle / 2);
    const tangentPrevious = {x: current.x + uPrevious.x * tangentDistance, y: current.y + uPrevious.y * tangentDistance};
    const tangentNext = {x: current.x + uNext.x * tangentDistance, y: current.y + uNext.y * tangentDistance};
    const bisectorLength = Math.hypot(uPrevious.x + uNext.x, uPrevious.y + uNext.y);
    const bisector = {x: (uPrevious.x + uNext.x) / bisectorLength, y: (uPrevious.y + uNext.y) / bisectorLength};
    const centerDistance = filletRadius / Math.sin(interiorAngle / 2);
    const center = {x: current.x + bisector.x * centerDistance, y: current.y + bisector.y * centerDistance};
    const start = Math.atan2(tangentPrevious.y - center.y, tangentPrevious.x - center.x);
    const end = Math.atan2(tangentNext.y - center.y, tangentNext.x - center.x);
    let sweep = end - start;
    while (sweep <= 0) sweep += Math.PI * 2;
    if (sweep > Math.PI + 1e-9) throw new RangeError("Catalog insert fillet would require a major arc.");
    fillets.push({center, radius: filletRadius, sweepRadians: sweep});
    for (let step = 0; step <= segmentCount; step += 1) {
      const arcAngle = start + sweep * step / segmentCount;
      points.push({x: center.x + Math.cos(arcAngle) * filletRadius, y: center.y + Math.sin(arcAngle) * filletRadius});
    }
  }
  return deepFreeze({
    units: "mm",
    includedAngleDegrees: angle,
    inscribedCircle: ic,
    noseRadius: requestedRadius,
    theoreticalVertices: vertices,
    points,
    fillets,
  });
}

const HOLDERS_BY_REVISION = new Map(
  TOOL_LIBRARY_CATALOG.holders.map((holder) => [holder.revisionRef, holder]),
);
const INSERTS_BY_REVISION = new Map(
  TOOL_LIBRARY_CATALOG.inserts.map((insert) => [insert.revisionRef, insert]),
);
const COMPATIBILITY_BY_REVISION = new Map(
  TOOL_LIBRARY_CATALOG.compatibilityEdges.map((edge) => [edge.revisionRef, edge]),
);
const ASSEMBLIES_BY_ID = new Map(
  TOOL_LIBRARY_CATALOG.assemblies.map((assembly) => [assembly.id, assembly]),
);
const SOURCES_BY_ID = new Map(
  TOOL_LIBRARY_CATALOG.sources.map((source) => [source.id, source]),
);

function unique(values) {
  return [...new Set(values)];
}

function collectSourceRefs(assembly, holder, insert, compatibilityEdge) {
  return unique([
    ...holder.sourceRefs,
    ...insert.sourceRefs,
    ...compatibilityEdge.sourceRefs,
    ...Object.values(assembly.claims).flatMap((claim) => claim.sourceRefs || []),
  ]);
}

const DETAILS_BY_ID = new Map(
  TOOL_LIBRARY_CATALOG.assemblies.map((assembly) => {
    const holder = HOLDERS_BY_REVISION.get(assembly.holderRevisionRef);
    const insert = INSERTS_BY_REVISION.get(assembly.insertRevisionRef);
    const compatibilityEdge = COMPATIBILITY_BY_REVISION.get(assembly.compatibilityRevisionRef);
    const sources = collectSourceRefs(assembly, holder, insert, compatibilityEdge)
      .map((sourceRef) => SOURCES_BY_ID.get(sourceRef));
    return [assembly.id, deepFreeze({
      schemaVersion: TOOL_LIBRARY_SCHEMA_VERSION,
      catalogRevision: TOOL_LIBRARY_CATALOG_REVISION,
      assembly,
      holder,
      insert,
      compatibilityEdge,
      sources,
    })];
  }),
);

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

const SEARCH_TEXT_BY_ID = new Map(
  [...DETAILS_BY_ID].map(([id, detail]) => [id, normalize([
    detail.assembly.id,
    detail.assembly.name,
    detail.assembly.manufacturer,
    detail.assembly.revisionRef,
    detail.holder.materialNumber,
    detail.holder.catalogId.iso,
    detail.holder.catalogId.ansi,
    detail.holder.gageInsert,
    detail.insert.materialNumber,
    detail.insert.catalogId.iso,
    detail.insert.catalogId.ansi,
    detail.insert.baseSizeClass,
    detail.insert.grade,
    detail.assembly.facets.shape,
    detail.assembly.facets.family,
    ...detail.assembly.facets.applications,
  ].join(" "))]),
);

function matchesFilter(actual, expected) {
  if (expected === undefined || expected === null) return true;
  const accepted = Array.isArray(expected) ? expected : [expected];
  return accepted.some((value) => normalize(value) === normalize(actual));
}

export function listToolLibraryAssemblies() {
  return Object.freeze([...TOOL_LIBRARY_CATALOG.assemblies]);
}

export function filterToolLibraryAssemblies(filters = {}) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw new TypeError("Tool-library filters must be an object.");
  }
  return Object.freeze(TOOL_LIBRARY_CATALOG.assemblies.filter((assembly) => (
    matchesFilter(assembly.facets.shape, filters.shape)
    && matchesFilter(assembly.facets.family, filters.family)
    && matchesFilter(assembly.facets.hand, filters.hand)
    && (filters.insertIcInches === undefined || assembly.facets.insertIcInches === filters.insertIcInches)
    && (filters.catalogRecordOnly === undefined || assembly.catalogRecordOnly === filters.catalogRecordOnly)
    && (filters.assignable === undefined || assembly.assignment.assignable === filters.assignable)
  )));
}

export function searchToolLibraryAssemblies(query, filters = {}) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  const filtered = filterToolLibraryAssemblies(filters);
  if (!tokens.length) return filtered;
  return Object.freeze(filtered.filter((assembly) => {
    const text = SEARCH_TEXT_BY_ID.get(assembly.id);
    return tokens.every((token) => text.includes(token));
  }));
}

export function toolLibraryAssemblyById(id) {
  return ASSEMBLIES_BY_ID.get(String(id ?? "")) || null;
}

export function toolLibraryAssemblyDetail(id) {
  return DETAILS_BY_ID.get(String(id ?? "")) || null;
}

export function toolLibraryHolderByRevisionRef(revisionRef) {
  return HOLDERS_BY_REVISION.get(String(revisionRef ?? "")) || null;
}

export function toolLibraryInsertByRevisionRef(revisionRef) {
  return INSERTS_BY_REVISION.get(String(revisionRef ?? "")) || null;
}

export function toolLibraryCompatibilityByRevisionRef(revisionRef) {
  return COMPATIBILITY_BY_REVISION.get(String(revisionRef ?? "")) || null;
}
