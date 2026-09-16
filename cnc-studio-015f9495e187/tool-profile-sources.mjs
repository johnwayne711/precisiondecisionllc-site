import {A4ENN160305_CAD_PROJECTION} from "./tool-cad-face-groove-projection.mjs";
import {A4SMR120414C_CAD_PROJECTION} from "./tool-cad-od-groove-projection.mjs";
import {E10LSEL3_CAD_PROJECTION} from "./tool-cad-id-thread-projection.mjs";
import {LSSR163D_CAD_PROJECTION} from "./tool-cad-od-thread-projection.mjs";
import {A4C0405N00CF02_CAD_PROJECTION} from "./tool-cad-partoff-projection.mjs";
import {A4C0405N00CF02_NOMINAL_SECTION} from "./tool-partoff-nominal.mjs";
import {A16TNER2_CAD_PROJECTION} from "./tool-cad-id-groove-projection.mjs";

// Independently sourced assemblies; no generic gage replacement or fitted scale.
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const PROFILED_TOOLS = deepFreeze([
  {
    id: "kennametal-a4smr120414c-a4g0405m04u04gmn",
    revision: 2,
    name: "Kennametal A4SMR120414C + A4G0405M04U04GMN · OD groove RH",
    family: "grooving", shape: "groove", mountingAxis: "program-x",
    applications: ["external", "grooving"], projection: A4SMR120414C_CAD_PROJECTION,
    holder: {
      name: "A4SMR120414C", materialNumber: "7061212", hand: "right",
      productUrl: "https://www.kennametal.com/us/en/products/p.a4-integral-toolholder-through-coolant-inch.7061212.html",
      dimensions: {shankHeight: 19.05, shankWidth: 19.05, overallLength: 114.3, headLength: 34.95,
        fDimension: 19.134, cuttingDepth: 14},
    },
    insert: {
      name: "A4G0405M04U04GMN", materialNumber: "1952734", hand: "neutral",
      productUrl: "https://www.kennametal.com/us/en/products/p.a4g-u-gmn.1952734.html",
      dimensions: {cuttingWidth: 4.12, cornerRadius: 0.4, length: 20, cuttingDepth: 3.4},
    },
    compatibilityEvidence: "The official A4SMR120414C holder page explicitly lists insert 1952734 / A4G0405M04U04GMN as compatible.",
    notice: "Actual 4.12 mm A4G0405M04U04GMN insert CAD is registered by its named MCS to the holder CSW, not substituted with the holder download's 4 mm gage. Source seating planes coincide without fitted offsets. The holder's named CRP anchors the display; the exact insert programmed datum is not qualified. Source model tolerance is 0.002 in, not a 0.0005 in cutting qualification. Stroke-only CAD display; stock uses a separately accepted nominal W/R model and explicit cutter datum, not this outline. Physical cutting accuracy and collision remain unqualified.",
    blockedReason: "OD groove removal requires separate nominal W/R-model acceptance and explicit cutter datum, direction, mounting and spindle setup; the CAD holder reference cannot supply them.",
  },
  {
    id: "kennametal-a4enn160305-a4g0300m03p02gmp",
    revision: 3,
    name: "Kennametal A4ENN160305 + A4G0300M03P02GMP · Face groove",
    family: "face-grooving", shape: "groove", mountingAxis: "program-x",
    applications: ["face-grooving"], projection: A4ENN160305_CAD_PROJECTION,
    holder: {
      name: "A4ENN160305", materialNumber: "2414139", hand: "neutral", revision: 2,
      cadRouting: {url: "https://www.product-config.net/catalog3/cad?d=kennametal&id=2414139",
        sha256: "836b65cc5655acb589754afc28e39b27b23c8ef451b70c4b668c440835498be8", handField: "HAND", handValue: "N"},
      productUrl: "https://www.kennametal.com/us/en/products/p.a4en.2414139.html",
      dimensions: {shankHeight: 25.4, shankWidth: 25.4, overallLength: 152.4, fDimension: 30.8,
        headHeight: 32, headLength: 25, minimumGrooveDiameter: 70, minimumGrooveWidth: 3, cuttingDepth: 5},
    },
    insert: {
      name: "A4G0300M03P02GMP", materialNumber: "1923833", hand: "neutral",
      productUrl: "https://www.kennametal.com/us/en/products/p.a4-groove-and-turn-insert-a4g-p-gmp-medium-positive-square-precision-ground.1923833.html",
      dimensions: {cuttingWidth: 3, cornerRadius: 0.2, length: 19.9, cuttingDepth: 3.5},
    },
    compatibilityEvidence: "The official A4ENN160305 holder page explicitly lists insert 1923833 / A4G0300M03P02GMP as compatible.",
    notice: "Actual selected A4G0300M03P02GMP insert CAD is rigidly registered by its named MCS to the holder CSW, without scaling or fitted offsets. The holder's named CRP anchors this display; the exact programmed cutting datum and physical seating are not qualified. The holder is rectangular in this source projection. Model tolerance is 0.002 in and mesh accuracy is unqualified, so this is not a 0.0005 in cutting model. Stroke-only CAD display; stock uses a separate accepted nominal radial-width model with explicit cutter datum and front/back entry direction. Physical cutting accuracy and collision remain unqualified.",
    blockedReason: "Face-groove removal requires separate nominal radial-width acceptance, inner/center/outer cutter datum, entry direction, mounting and spindle setup.",
  },
  {
    id: "kennametal-e10lsel3-lt16nlag60",
    revision: 3,
    name: "Kennametal E10LSEL3 + LT16NLAG60 · ID thread 60° LH",
    family: "id-threading", shape: "thread", mountingAxis: "program-z",
    applications: ["internal", "id-threading"], projection: E10LSEL3_CAD_PROJECTION,
    holder: {
      name: "E10LSEL3", materialNumber: "1152681", hand: "left", revision: 2,
      cadRouting: {url: "https://www.product-config.net/catalog3/cad?d=kennametal&id=1152681",
        sha256: "14ed22cd38cf5aceb1a3a515d212fd05740e67b7d55a83e49388d7f41c89c142", handField: "HAND", handValue: "L"},
      productUrl: "https://www.kennametal.com/us/en/products/p.e-lse.1152681.html",
      dimensions: {shankDiameter: 15.875, minimumBoreDiameter: 20.32, fDimension: 11.684, coolantHoleDiameter: 5.537},
    },
    insert: {
      name: "LT16NLAG60", materialNumber: "1743831", hand: null,
      productUrl: "https://www.kennametal.com/us/en/products/p.laydown-internal-threading-insert-partial-profile-60.1743831.html",
      dimensions: {length: 16.497, cornerRadius: 0.05, profileDistanceEx: 1.194, profileDistanceE: 1.702},
      cuttingGeometry: {partialProfileAngleDegrees: 60, pitchRangeMm: [0.5, 3], tpiRange: [8, 48]},
    },
    compatibilityEvidence: "Reciprocal official material rows: holder 1152681 lists insert 1743831 / LT16NLAG60; the insert lists E10LSEL3 / 1152681.",
    notice: "Actual LT16NLAG60 insert STEP is tessellated in its original model frame, then registered by the named insert MCS and holder CSW. The differently framed standalone viewer mesh is not used. The source-named holder CRP is retained, not replaced by a guessed cutting corner. The manufacturer CAD route explicitly declares a left-hand holder; overall length is not inferred from model bounds. Source model tolerance is 0.002 in, not 0.0005 in qualification. Stroke-only CAD display; a separate accepted nominal 60-degree rounded-tip stock envelope requires explicit cutter datum and bore wall. This is not a helical thread, bore-clearance or collision proof.",
    blockedReason: "ID threading requires separate nominal rounded 60-degree envelope acceptance, tip-center datum, bore wall and supported threaded motion; display does not qualify thread fit, helix or crest/root form.",
  },
  {
    id: "kennametal-a4smr120414c-a4c0405n00cf02",
    revision: 2,
    name: "Kennametal A4SMR120414C + A4C0405N00CF02 · Part off RH",
    family: "parting", shape: "groove", mountingAxis: "program-x",
    applications: ["external", "parting"], projection: A4C0405N00CF02_CAD_PROJECTION,
    holder: {
      name: "A4SMR120414C", materialNumber: "7061212", hand: "right",
      productUrl: "https://www.kennametal.com/us/en/products/p.a4-integral-toolholder-through-coolant-inch.7061212.html",
      dimensions: {shankHeight: 19.05, shankWidth: 19.05, overallLength: 114.3, headLength: 34.95,
        fDimension: 19.134, cuttingDepth: 14},
    },
    insert: {
      name: "A4C0405N00CF02", materialNumber: "2234816", hand: "neutral",
      productUrl: "https://www.kennametal.com/us/en/products/p.a4c-n-cf.2234816.html",
      dimensions: {cuttingWidth: 4.12, cornerRadius: 0.2},
    },
    nominalSection: A4C0405N00CF02_NOMINAL_SECTION,
    compatibilitySource: {
      url: "https://www.kennametal.com/us/en/products/p/_jcr_content/root/responsivegrid/product_tabs_copy_co.compatible-parts.2234816.html/type%253DmsCompatibleProducts/currentPage%253D5.html",
      sha256: "deb14bad03c3c0eb70a775e80a31404c46f6e2d52336bfa5bc88448893f6cfb0",
    },
    compatibilityEvidence: "Official A4C0405N00CF02 / 2234816 compatible-holder list includes A4SMR120414C / 7061212. Compatibility is not a seating-accuracy claim.",
    notice: "Actual selected A4C insert CAD is registered by named MCS/CSW frames without fitting. Source component planes differ by 0.101356 mm (0.00399 in); physical seating and the exact cutting datum are unqualified. This does not prove the real components are incompatible. Source model tolerance is 0.002 in, not a 0.0005 in qualification. The separate nominal W/R section uses published dimensions, not this CAD's spline chipbreaker edge. CAD display only; a separate accepted nominal W/R model uses an explicit programmed cutter datum for bounded stock removal. Physical seating, cutting accuracy and collision remain unqualified.",
    blockedReason: "Part-off removal requires separate nominal W/R-model acceptance and explicit cutter datum, radial-only direction, mounting and spindle setup; inspecting the library section does not confirm them or physical seating.",
  },
  {
    id: "kennametal-lssr163d-lt16erag60cb",
    revision: 2,
    name: "Kennametal LSSR163D + LT16ERAG60CB · OD thread 60° RH",
    family: "od-threading", shape: "thread", mountingAxis: "program-x",
    applications: ["external", "od-threading"], projection: LSSR163D_CAD_PROJECTION,
    holder: {
      name: "LSSR163D", materialNumber: "1281818", hand: "right",
      productUrl: "https://www.kennametal.com/us/en/products/p.lss.1281818.html",
      dimensions: {shankHeight: 25.4, shankWidth: 25.4, overallLength: 152.4, headLength: 25.4, fDimension: 31.75},
    },
    insert: {
      name: "LT16ERAG60CB", materialNumber: "1679780", hand: "right",
      productUrl: "https://www.kennametal.com/us/en/products/p.lt-er-60cb.1679780.html",
      dimensions: {cornerRadius: 0.075, length: 16.497},
      cuttingGeometry: {partialProfileAngleDegrees: 60, pitchRangeMm: [0.5, 3], tpiRange: [8, 48]},
    },
    compatibilityEvidence: "Manufacturer LSSR163D / 1281818 holder record lists insert LT16ERAG60CB / 1679780. The manufacturer CAD route directly links 1281818 to LSSR163D_GTM; its internal body identifier 2968592 is also identified as LSSR163D in WIDIA's manufacturer catalog, not used as a different Kennametal order number.",
    notice: "Exact LT16ERAG60CB insert STEP is registered to the independently identified LSSR163D holder using named MCS/CSW frames, not a generic triangular insert or mirrored model. The manufacturer's product-to-CAD route resolves the holder's internal child identifier. Named holder CRP is a display reference, not a qualified insert tip. Published 60° / 0.075 mm are nominal profile facts; the source edge is a spline. Source model tolerance is 0.002 in, not a 0.0005 in qualification. CAD display only; a separate accepted nominal 60-degree rounded-tip stock envelope requires an explicit cutter datum. It does not prove crest/root form, a helix, thread fit or collision.",
    blockedReason: "OD threading requires separate nominal rounded 60-degree envelope acceptance, tip-center datum and supported threaded motion; display does not qualify thread fit, helix or crest/root form.",
  },
  {
    id: "kennametal-a16tner2-nr2031l",
    revision: 2,
    name: "Kennametal A16TNER2 + NR2031L · ID groove RH bar / LH insert",
    family: "id-grooving", shape: "groove", mountingAxis: "program-z",
    applications: ["internal", "id-grooving"], projection: A16TNER2_CAD_PROJECTION,
    holder: {
      name: "A16TNER2", materialNumber: "1094833", hand: "right", gageInsert: "N.2L",
      productUrl: "https://www.kennametal.com/us/en/products/p.a-ne.1094833.html",
      dimensions: {shankDiameter: 25.4, minimumBoreDiameter: 34.92, overallLength: 304.8, fDimension: 17.48},
    },
    insert: {
      name: "NR2031L", materialNumber: "1112973", hand: "left",
      productUrl: "https://www.kennametal.com/us/en/products/p.nr.1112973.html",
      dimensions: {cuttingWidth: 1.575, cornerRadius: 0.775, cuttingDepth: 2.794},
    },
    compatibilityEvidence: "The official A16TNER2 / 1094833 holder page lists NR2031L / 1112973. Both exact product-code CAD routes retain these product IDs and their STEP packages; the holder's internal 3632130 CAD label is not a different chosen insert.",
    notice: "Actual NR2031L insert CAD is rigidly registered to the manufacturer-routed A16TNER2 body using named MCS/CSW frames. Two finite seating faces coincide; another differs by 0.0004 mm. No fitted scaling, mirrored substitute or generic CUT is used. The RH holder and LH insert are independent published identities. Published insert radius is 0.775 mm; CAD metadata says 0.787 mm and the source cutting edge is elliptical, so these are not silently equated. Named holder CRP anchors display only. Source model tolerance is 0.002 in, not a 0.0005 in qualification. Separate nominal internal-groove stock removal requires explicit W/R-model acceptance, cutter datum and bore wall. Bore clearance, physical cutting accuracy and collision remain unqualified.",
    blockedReason: "ID groove removal requires separate nominal W/R-model acceptance, programmed cutter datum, bore wall, direction, mounting and spindle setup; exterior turning removal is not substituted.",
  },
]);
