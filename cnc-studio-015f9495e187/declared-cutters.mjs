// Operator-declared square end mills. A shop can assign a cutter that is not
// in the source-linked library by declaring its exact dimensions. The record
// is stored with the remembered job, labeled operator-declared, and never
// claims manufacturer identity, artwork, holder geometry or collision
// authority. Dimensions are canonical millimetres in the adapted definition.

const EPSILON = 1e-9;
export const DECLARED_CUTTER_ID_PREFIX = "declared-cutter:";
export const DECLARED_CUTTER_PROFILE = "square";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function toNumber(value) {
  if (value === "" || value === null || value === undefined) return NaN;
  return Number(value);
}

function slug(text) {
  return String(text || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "end-mill";
}

/** Validate operator input (in the declared units). Returns {record, errors}. */
export function validateDeclaredCutter(input = {}) {
  const errors = [];
  const units = input.units === "mm" ? "mm" : "inch";
  const name = String(input.name || "").trim();
  const cutterDiameter = toNumber(input.cutterDiameter);
  const lengthOfCut = toNumber(input.lengthOfCut);
  const shankDiameter = toNumber(input.shankDiameter);
  const overallLength = toNumber(input.overallLength);
  const flutes = toNumber(input.flutes);
  const centerCutting = input.centerCutting === true || input.centerCutting === "yes"
    ? true : (input.centerCutting === false || input.centerCutting === "no" ? false : null);
  if (!name) errors.push("Give the cutter a name (for example “.250 4FL carbide EM”).");
  if (!(cutterDiameter > EPSILON)) errors.push("Cutter diameter must be a positive number.");
  if (!(lengthOfCut > EPSILON)) errors.push("Length of cut must be a positive number.");
  if (!(shankDiameter > EPSILON)) errors.push("Shank diameter must be a positive number.");
  if (!(overallLength > EPSILON)) errors.push("Overall length must be a positive number.");
  if (lengthOfCut > overallLength + EPSILON) errors.push("Length of cut cannot exceed overall length.");
  if (!(Number.isInteger(flutes) && flutes > 0)) errors.push("Flute count must be a positive whole number.");
  if (centerCutting === null) errors.push("Declare whether the end mill is center cutting (yes/no). Side milling works either way; axial plunges need yes.");
  if (errors.length) return {record: null, errors};
  const id = typeof input.id === "string" && input.id.startsWith(DECLARED_CUTTER_ID_PREFIX)
    ? input.id
    : `${DECLARED_CUTTER_ID_PREFIX}${slug(name)}-${Date.now().toString(36)}`;
  return {
    errors: [],
    record: Object.freeze({
      id,
      revision: Number.isInteger(input.revision) && input.revision >= 1 ? input.revision : 1,
      name,
      units,
      profile: DECLARED_CUTTER_PROFILE,
      cutterDiameter,
      lengthOfCut,
      shankDiameter,
      overallLength,
      flutes,
      centerCutting,
      declaredAt: typeof input.declaredAt === "string" ? input.declaredAt : new Date().toISOString(),
    }),
  };
}

export function isDeclaredCutterId(id) {
  return typeof id === "string" && id.startsWith(DECLARED_CUTTER_ID_PREFIX);
}

/** Restore persisted records defensively; invalid entries are dropped. */
export function normalizeDeclaredCutters(candidates) {
  if (!Array.isArray(candidates)) return [];
  const records = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || !isDeclaredCutterId(candidate.id)) continue;
    const {record} = validateDeclaredCutter(candidate);
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    records.push(record);
  }
  return records;
}

/**
 * Adapt a declared record to the 2D tool-assembly definition contract used
 * by the app (same shape as adaptEligibleMillingToolTo2dAssembly), with
 * canonical millimetre dimensions and an explicit operator-declared source.
 */
export function declaredCutterTo2dAssembly(record) {
  if (!record || !isDeclaredCutterId(record.id)) return null;
  const scale = record.units === "mm" ? 1 : 25.4;
  const mm = (value) => Number(value) * scale;
  const dimensions = {
    cutterDiameterMm: mm(record.cutterDiameter),
    cuttingLengthMm: mm(record.lengthOfCut),
    shankDiameterMm: mm(record.shankDiameter),
    overallLengthMm: mm(record.overallLength),
  };
  if (!Object.values(dimensions).every((value) => finite(value) && value > 0)) return null;
  const scope = ["rotary-indexed-side-mill", ...(record.centerCutting === true ? ["demo-cutting"] : [])];
  return Object.freeze({
    id: record.id,
    revision: record.revision,
    name: `${record.name} · operator-declared square end mill`,
    manufacturer: "Operator-declared",
    family: "live-milling",
    geometryKind: "axial-milling-cutter",
    verification: "operatorDeclared",
    displayVerification: "operatorDeclared",
    renderingClaim: "operator-declared-envelope",
    geometryNotice: "Operator-declared cutter and shank envelope only. No manufacturer identity, artwork, driven unit, mounting transform, turret or collision envelope is represented.",
    sourceRecordRef: {id: record.id, revision: record.revision, revisionRef: `${record.id}@${record.revision}`},
    geometryRevisionRef: `declared-geometry:${record.id}@${record.revision}`,
    profile: DECLARED_CUTTER_PROFILE,
    cutterProfile: DECLARED_CUTTER_PROFILE,
    cutterDiameter: dimensions.cutterDiameterMm,
    shankDiameter: dimensions.shankDiameterMm,
    lengthOfCut: dimensions.cuttingLengthMm,
    overallLength: dimensions.overallLengthMm,
    flutes: record.flutes,
    point: null,
    schematic: null,
    preview: null,
    sources: [],
    declared: Object.freeze({...record}),
    assignment: Object.freeze({
      assignable: true,
      scope: Object.freeze(scope),
      reference: Object.freeze({type: "flat-end-mill-tip", units: "mm", axisMm: 0, radialMm: 0}),
      blockedOutsideScope: "Operator-declared cutters model rotary-indexed side milling; axial plunges also need a center-cutting declaration.",
    }),
    cuttingModel: Object.freeze({
      family: "live-milling",
      mode: "axial-flat-endmill",
      supportedOperation: "rotary-indexed-side-mill-and-straight-axial-plunge",
      referenceSemantics: "flat-end-mill-tip",
      geometryRevisionRef: `declared-geometry:${record.id}@${record.revision}`,
      diameter: dimensions.cutterDiameterMm,
      lengthOfCut: dimensions.cuttingLengthMm,
      centerCutting: record.centerCutting === true,
      centerCuttingDeclared: typeof record.centerCutting === "boolean",
      dimensionsExact: true,
      dimensionSource: "operator-declared",
      point: null,
      scope: Object.freeze(scope),
      demoSimulationReady: record.centerCutting === true,
      simulationReady: false,
      stockRemovalVerified: true,
      collisionReady: false,
      holderGeometryIncluded: false,
      blockedOutsideScope: "Operator-declared cutters model rotary-indexed side milling; axial plunges also need a center-cutting declaration.",
    }),
  });
}
