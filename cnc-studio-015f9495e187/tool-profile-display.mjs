// Display-only projection of an independently source-registered holder/insert.
// Coordinates are retained millimeters, never a cutting or collision envelope.
export function validateProfileDisplaySource(projection, mountingAxis) {
  const errors = [];
  if (!projection || projection.units !== "mm") return ["A millimeter source projection is required."];
  if (!["program-x", "program-z"].includes(mountingAxis)) errors.push("The physical shank axis must be explicit.");
  if (!Array.isArray(projection.modelCrp) || projection.modelCrp.length !== 3
    || !projection.modelCrp.every(Number.isFinite)) errors.push("A finite source-named reference is required.");
  for (const key of ["holderOutline", "insertOutline"]) {
    const points = projection[key];
    if (!Array.isArray(points) || points.length < 3 || points.length > 20000
      || points.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite))) {
      errors.push(`The ${key} must retain a bounded finite source outline.`);
    }
  }
  return errors;
}

export function buildProfileDisplay(assembly, referencePoint, displayState, projection) {
  const flipped = assembly.mountingOrientation === "flipped";
  const mountingKnown = ["standard", "flipped"].includes(assembly.mountingOrientation);
  const sign = flipped ? -1 : 1;
  const axial = assembly.mountingAxis === "program-z";
  const [crpX, , crpZ] = projection.modelCrp;
  const map = path => path.map(([modelX, negativeModelZ]) => axial ? {
    z: referencePoint.z - negativeModelZ - crpZ,
    x: referencePoint.x + sign * (crpX - modelX),
  } : {
    z: referencePoint.z + sign * (modelX - crpX),
    x: referencePoint.x - negativeModelZ - crpZ,
  });
  const holderOutline = map(projection.holderOutline);
  const insertOutline = map(projection.insertOutline);
  // Full independent component boundaries: no invented hidden-edge trimming.
  // A 2D projection cannot establish the seating-face depth/occlusion.
  const component = (role, outline, renderOrder) => ({
    role, outline, renderOrder, dashed: !mountingKnown,
    paths: [{points: outline, closed: true}],
  });
  return {
    cadProjection: {
      id: projection.id, units: "mm", view: projection.view,
      modelCrp: [...projection.modelCrp], source: {...projection.source},
      mountingAxis: assembly.mountingAxis,
      sourceTessellationErrorBoundMm: projection.sourceTessellationErrorBoundMm ?? null,
      sourceModelUncertaintyMm: projection.sourceModelUncertaintyMm ?? null,
    },
    holder: {outline: holderOutline, bodyOutline: holderOutline, envelopeKind: "manufacturer-source-profile-display"},
    insert: {outline: insertOutline, body: insertOutline},
    cutter: {outline: insertOutline},
    spindleDisplay: {
      direction: ["m3", "m4"].includes(displayState?.spindleDirection) ? displayState.spindleDirection : "unknown",
      running: typeof displayState?.spindleRunning === "boolean" ? displayState.spindleRunning : null,
      facing: mountingKnown ? (flipped ? "flipped" : "standard") : "unknown",
    },
    components: [component("holder", holderOutline, 1), component("insert", insertOutline, 2)],
  };
}
