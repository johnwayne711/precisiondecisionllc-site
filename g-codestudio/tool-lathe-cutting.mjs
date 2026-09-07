// Nominal machining contracts are independent of manufacturer display meshes.
// Published metric nominals are not physical seating, compensation or clearance
// qualification. Setup acceptance is explicit and pinned to this model revision.
const axialDatums = ["negative-z-edge", "center", "positive-z-edge"];
const axialDirections = ["negative-z", "positive-z", "radial-only", "both"];
const wallSides = ["positive-x", "negative-x"];
const specs = [
  {id: "kennametal-a16tmclnr4-cnmg432", assemblyRevision: 2, operation: "id-bore", width: 0, cornerRadius: 0,
    noseRadius: 0.8, tipDatumChoices: ["programmed-contact-point"], axialDirectionChoices: axialDirections.slice(0, 3),
    wallSideChoices: wallSides, minimumBoreDiameter: 30.48,
    sourceUrl: "https://www.kennametal.com/us/en/products/p.cnmg.1159602.html",
    interpretation: "Explicit programmed-contact-point ID sweep; published nose radius is metadata, not automatic nose compensation."},
  {id: "kennametal-a4smr120414c-a4g0405m04u04gmn", assemblyRevision: 2, operation: "od-groove", width: 4.12, cornerRadius: 0.4,
    tipDatumChoices: axialDatums, axialDirectionChoices: axialDirections, maximumCuttingDepth: 3.4,
    sourceUrl: "https://www.kennametal.com/us/en/products/p.a4g-u-gmn.1952734.html"},
  {id: "kennametal-a4smr120414c-a4c0405n00cf02", assemblyRevision: 2, operation: "parting", width: 4.12, cornerRadius: 0.2,
    tipDatumChoices: axialDatums, axialDirectionChoices: ["radial-only"], maximumCuttingDepth: 14,
    sourceUrl: "https://www.kennametal.com/us/en/products/p.a4c-n-cf.2234816.html",
    cuttingDepthSource: {component: "holder", field: "cuttingDepth", valueMm: 14,
      sourceUrl: "https://www.kennametal.com/us/en/products/p.a4-integral-toolholder-through-coolant-inch.7061212.html"},
    interpretation: "Ideal nominal W4.12/R0.2 section with a 14 mm source-known holder reach upper bound; insert depth is unknown. This is not physical seating or holder-collision clearance."},
  {id: "kennametal-a4enn160305-a4g0300m03p02gmp", assemblyRevision: 3, operation: "face-groove", width: 3, cornerRadius: 0.2,
    tipDatumChoices: ["inner-edge", "center", "outer-edge"], axialDirectionChoices: ["negative-z", "positive-z"],
    maximumCuttingDepth: 3.5, minimumGrooveDiameter: 70,
    sourceUrl: "https://www.kennametal.com/us/en/products/p.a4-groove-and-turn-insert-a4g-p-gmp-medium-positive-square-precision-ground.1923833.html"},
  {id: "kennametal-a16tner2-nr2031l", assemblyRevision: 2, operation: "id-groove", width: 1.575, cornerRadius: 0.775,
    tipDatumChoices: axialDatums, axialDirectionChoices: axialDirections, wallSideChoices: wallSides,
    maximumCuttingDepth: 2.794, minimumBoreDiameter: 34.92,
    sourceUrl: "https://www.kennametal.com/us/en/products/p.nr.1112973.html",
    interpretation: "Published metric R0.775 nominal circular corners; the displayed CAD ellipse and its R0.787 metadata are not substituted."},
  {id: "kennametal-lssr163d-lt16erag60cb", assemblyRevision: 2, operation: "od-thread", width: null, cornerRadius: 0.075,
    noseRadius: 0.075, includedAngleDegrees: 60, pitchRangeMm: [0.5, 3],
    tipDatumChoices: ["tip-center"], axialDirectionChoices: ["negative-z", "positive-z"],
    sourceUrl: "https://www.kennametal.com/us/en/products/p.lt-er-60cb.1679780.html"},
  {id: "kennametal-e10lsel3-lt16nlag60", assemblyRevision: 3, operation: "id-thread", width: null, cornerRadius: 0.05,
    noseRadius: 0.05, includedAngleDegrees: 60, pitchRangeMm: [0.5, 3], minimumBoreDiameter: 20.32,
    tipDatumChoices: ["tip-center"], axialDirectionChoices: ["negative-z", "positive-z"], wallSideChoices: wallSides,
    sourceUrl: "https://www.kennametal.com/us/en/products/p.laydown-internal-threading-insert-partial-profile-60.1743831.html"},
];

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const NOMINAL_LATHE_CUTTERS = freeze(specs.map(spec => ({
  ...spec, mode: "nominal-lathe", units: "mm", nominalModelRef: `${spec.id}:nominal-cutting-v1`,
  materialSide: spec.operation.startsWith("id-") ? "inside" : spec.operation === "face-groove" ? "face" : "outside",
  referenceSemantics: "nominal-cutter-datum", mountingRequired: true,
  nominalAccepted: false, tipDatum: null, axialDirection: null, simulationReady: false,
  stockRemovalVerified: false, physicalAccuracyQualified: false, collisionAuthority: false,
  ...(spec.wallSideChoices ? {wallSide: null} : {}),
  interpretation: spec.interpretation || (spec.operation.endsWith("thread")
    ? "Nominal 60-degree rounded-tip axial envelope clipped by stock; not a helical thread, crest/root standard or pitch-fit verification."
    : "Ideal manufacturer-dimensioned front line with two tangent circular corners; the selected datum is a virtual sharp edge or front-line center, not the CAD holder CRP."),
})));

export function nominalLatheCuttingDefinition(id) {
  return NOMINAL_LATHE_CUTTERS.find(model => model.id === id) || null;
}

export function nominalLatheCuttingClaim(id, sourceRefs) {
  const model = nominalLatheCuttingDefinition(id);
  if (!model) return {state: "unavailable", available: false, assignable: false, sourceRefs};
  return {state: "nominal-model-conditional", available: true, assignable: true,
    revisionRef: model.nominalModelRef, sourceRefs,
    interpretation: model.interpretation,
    requires: ["explicit-nominal-acceptance", "programmed-cutter-datum", "mounting", "spindle", "supported-motion", "stock-setup"],
    physicalAccuracyQualified: false, collisionAuthority: false,
    note: "Manufacturer-dimensioned nominal stock model only; CAD seating, physical cutter accuracy and collision remain unqualified."};
}

// Only these setup facts may alter a canonical model. Caller-provided dimensions,
// operation or stockRemovalVerified flags can never replace the retained model.
const SETUP_FIELDS = ["nominalAccepted", "nominalModelRef", "tipDatum", "axialDirection",
  "wallSide", "mountingOrientation", "requiredSpindleDirection"];

export function resolveNominalLatheCuttingModel(definition, setup = definition) {
  const canonical = nominalLatheCuttingDefinition(definition?.id);
  const unsupported = message => ({mode: "unsupported", simulationReady: false, stockRemovalVerified: false,
    referenceSemantics: "nominal-cutter-datum", errors: [message], blockedReason: message});
  if (!canonical || definition?.revision !== canonical.assemblyRevision) {
    return unsupported("The exact nominal cutter assembly revision is unavailable; choose its current catalog revision.");
  }
  if (definition.cuttingModel && definition.cuttingModel.mode !== "nominal-lathe") {
    return unsupported("A display-only or substituted cutting model cannot authorize nominal lathe removal.");
  }
  const values = {};
  for (const field of SETUP_FIELDS) {
    values[field] = Object.hasOwn(setup || {}, field) ? setup[field] : setup?.cuttingModel?.[field];
  }
  const errors = [];
  if (values.nominalAccepted !== true) errors.push("Explicit nominal cutting-model acceptance is required; display confirmation is not cutting approval.");
  if (values.nominalModelRef !== canonical.nominalModelRef) errors.push("Accept the exact current nominal cutting-model revision.");
  if (!canonical.tipDatumChoices.includes(values.tipDatum)) errors.push("Choose the nominal cutter's programmed datum explicitly.");
  if (!canonical.axialDirectionChoices.includes(values.axialDirection)) errors.push("Choose the permitted nominal cutting direction explicitly.");
  if (canonical.wallSideChoices && !canonical.wallSideChoices.includes(values.wallSide)) errors.push("Choose the positive-X or negative-X bore wall explicitly.");
  if (!["standard", "flipped"].includes(values.mountingOrientation)) errors.push("Choose standard or flipped physical mounting explicitly.");
  if (!["m3", "m4"].includes(values.requiredSpindleDirection)) errors.push("Choose the required M3 or M4 rotation for this mounting explicitly.");
  return {...canonical, ...values, errors, simulationReady: errors.length === 0,
    blockedReason: errors.length ? errors.join(" ") : null};
}
