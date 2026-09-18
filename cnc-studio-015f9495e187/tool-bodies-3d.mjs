/**
 * Illustrative 3D bodies for the assigned tool, its holder and the turret.
 *
 * The bodies are built from the same 2D display model the 2D plot draws
 * (manufacturer CAD top-plan projections or catalog-scaled outlines), so the
 * plan silhouette of every body is exactly the 2D outline. Thickness comes
 * from the assembly's published shank and insert values where it has them;
 * the turret disc and any driven-unit housing are drawn at fixed nominal
 * sizes because no machine profile records them. Everything here is display
 * geometry: it is not dimensional authority and never a clearance or
 * collision check (D-005, D-008, D-012).
 *
 * Local frame: z = program Z, x = radial X, w = tangential Y (all mm).
 * World frame (the 3D renderer's part frame): x = program Z signed by the
 * display orientation, y = radial X, z = tangential Y; a rotary-indexed
 * cutter carries its spindle angle so the whole assembly follows the point
 * the 3D toolpath is drawn at.
 */
const EPSILON = 1e-9;
const DEGREES = Math.PI / 180;

export const NOMINAL_TURRET_DISPLAY = Object.freeze({
  diameterMm: 254,
  thicknessMm: 63.5,
  stations: 12,
  // Axial stations sit inside the periphery, at this fraction of the radius.
  stationPitchFraction: 0.8,
});

export const NOMINAL_DRIVEN_HOLDER_DISPLAY = Object.freeze({
  noseDiameterMm: 50,
  noseLengthMm: 40,
  bodyDiameterMm: 65,
  bodyLengthMm: 80,
  shankGripFraction: 0.6,
});

export const NOMINAL_SHANK_HEIGHT_MM = 25.4;
export const NOMINAL_INSERT_THICKNESS_MM = 4.76;

export const TOOL_BODY_3D_NOTICE = "Illustrative bodies: plan outlines from the assigned tool's 2D display geometry, thickness from published shank and insert values where available, turret and driven unit at nominal size. Not dimensional authority and not a clearance or collision check.";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value) {
  return finite(value) && value > EPSILON;
}

function signedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    area += a.z * b.x - b.z * a.x;
  }
  return area / 2;
}

function cleanOutline(points) {
  const cleaned = [];
  for (const point of Array.isArray(points) ? points : []) {
    if (!finite(point?.z) || !finite(point?.x)) continue;
    const last = cleaned.at(-1);
    if (last && Math.abs(last.z - point.z) < EPSILON && Math.abs(last.x - point.x) < EPSILON) continue;
    cleaned.push({z: point.z, x: point.x});
  }
  while (cleaned.length > 1) {
    const first = cleaned[0];
    const last = cleaned.at(-1);
    if (Math.abs(first.z - last.z) < EPSILON && Math.abs(first.x - last.x) < EPSILON) cleaned.pop();
    else break;
  }
  return cleaned.length >= 3 ? cleaned : null;
}

/**
 * Extrude a closed plan outline (program Z, radial X) between two tangential
 * heights. Faces carry outward unit normals; the outline may be non-convex.
 */
export function extrudeOutline(outline, w0, w1) {
  const points = cleanOutline(outline);
  if (!points || !finite(w0) || !finite(w1) || Math.abs(w1 - w0) < EPSILON) return [];
  const bottom = Math.min(w0, w1);
  const top = Math.max(w0, w1);
  const area = signedArea(points);
  if (Math.abs(area) < EPSILON) return [];
  const ccw = area > 0 ? points : [...points].reverse();
  const faces = [
    {points: ccw.map((point) => ({z: point.z, x: point.x, w: top})), normal: {z: 0, x: 0, w: 1}},
    {points: [...ccw].reverse().map((point) => ({z: point.z, x: point.x, w: bottom})), normal: {z: 0, x: 0, w: -1}},
  ];
  for (let index = 0; index < ccw.length; index += 1) {
    const a = ccw[index];
    const b = ccw[(index + 1) % ccw.length];
    const dz = b.z - a.z;
    const dx = b.x - a.x;
    const length = Math.hypot(dz, dx);
    if (length < EPSILON) continue;
    faces.push({
      points: [
        {z: a.z, x: a.x, w: bottom},
        {z: b.z, x: b.x, w: bottom},
        {z: b.z, x: b.x, w: top},
        {z: a.z, x: a.x, w: top},
      ],
      normal: {z: dx / length, x: -dz / length, w: 0},
    });
  }
  return faces;
}

/**
 * Right prism about an axis parallel to program Z (a cylinder when `sides`
 * is large, a station-count polygon for the turret disc).
 */
export function prismAlongZ({centerX = 0, centerW = 0, radius, z0, z1, sides = 32, phase = 0} = {}) {
  if (!positive(radius) || !finite(z0) || !finite(z1) || Math.abs(z1 - z0) < EPSILON) return [];
  const count = Math.max(3, Math.floor(Number(sides) || 0));
  const near = Math.min(z0, z1);
  const far = Math.max(z0, z1);
  const ring = (z) => Array.from({length: count}, (_, index) => {
    const angle = phase + index / count * Math.PI * 2;
    return {z, x: centerX + radius * Math.cos(angle), w: centerW + radius * Math.sin(angle)};
  });
  const nearRing = ring(near);
  const farRing = ring(far);
  const faces = [
    {points: farRing, normal: {z: 1, x: 0, w: 0}},
    {points: [...nearRing].reverse(), normal: {z: -1, x: 0, w: 0}},
  ];
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const middle = phase + (index + 0.5) / count * Math.PI * 2;
    faces.push({
      points: [nearRing[index], nearRing[next], farRing[next], farRing[index]],
      normal: {z: 0, x: Math.cos(middle), w: Math.sin(middle)},
    });
  }
  return faces;
}

function outlineBounds(outline) {
  const points = cleanOutline(outline);
  if (!points) return null;
  return {
    minZ: Math.min(...points.map((point) => point.z)),
    maxZ: Math.max(...points.map((point) => point.z)),
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
  };
}

function componentOutline(model, roles) {
  for (const role of roles) {
    const component = (model.components || []).find((entry) => entry.role === role);
    if (component?.outline?.length >= 3) return component.outline;
  }
  return null;
}

function turretStationCount(stations) {
  const count = Math.floor(Number(stations));
  return Number.isInteger(count) && count >= 3 && count <= 48 ? count : NOMINAL_TURRET_DISPLAY.stations;
}

/** Distance from the turret centre to the flat that faces the part. */
export function turretApothem(stations) {
  return NOMINAL_TURRET_DISPLAY.diameterMm / 2 * Math.cos(Math.PI / turretStationCount(stations));
}

function turretDisc({centerX, centerW = 0, z0, z1, stations}) {
  const sides = turretStationCount(stations);
  return prismAlongZ({
    centerX,
    centerW,
    radius: NOMINAL_TURRET_DISPLAY.diameterMm / 2,
    z0,
    z1,
    sides,
    // A flat of the polygon faces the part instead of a vertex.
    phase: Math.PI - Math.PI / sides,
  });
}

function toWorld(point, orientationSign, tangent, cosine, sine) {
  const radial = point.x;
  const tangential = point.w + tangent;
  return {
    x: point.z * orientationSign,
    y: radial * cosine - tangential * sine,
    z: radial * sine + tangential * cosine,
  };
}

function normalToWorld(normal, orientationSign, cosine, sine) {
  return {
    x: normal.z * orientationSign,
    y: normal.x * cosine - normal.w * sine,
    z: normal.x * sine + normal.w * cosine,
  };
}

/**
 * Build the illustrative bodies for a valid 2D display model. Returns world
 * frame faces grouped by body role. `tangent` (machine Y of the cutter
 * reference, mm) and `spindleAngleDegrees` (the part-frame polar angle the
 * cutter is drawn at) place a live cutter where its 3D path ends.
 */
export function buildToolBodies3d(assembly, model, {
  orientationSign = 1,
  tangent = 0,
  spindleAngleDegrees = 0,
  turretStations = null,
  slices = 32,
  includeTurret = true,
} = {}) {
  const stations = turretStationCount(turretStations);
  const result = {bodies: [], notice: TOOL_BODY_3D_NOTICE, kind: null, turretStations: stations};
  // An axial station sits on the turret face inside the periphery; a square
  // shank ends where the flat facing the part begins.
  const axialStationOffset = NOMINAL_TURRET_DISPLAY.diameterMm / 2 * NOMINAL_TURRET_DISPLAY.stationPitchFraction;
  const shankEndOffset = turretApothem(stations);
  if (!assembly || !model?.valid || !model.referencePoint) return result;
  const reference = model.referencePoint;
  if (!finite(reference.z) || !finite(reference.x)) return result;
  const kind = assembly.geometryKind || null;
  result.kind = kind;
  const sign = orientationSign < 0 ? -1 : 1;
  const mountingKnown = ["standard", "flipped"].includes(assembly.mountingOrientation);
  const flipped = assembly.mountingOrientation === "flipped";
  const local = [];
  const push = (role, faces, {nominal = false, dashed = false} = {}) => {
    if (faces.length) local.push({role, faces, nominal, dashed});
  };
  let turret = null;

  if (kind === "axial-milling-cutter") {
    const cutterRadius = Number(assembly.cutterDiameter) / 2;
    const shankRadius = Number(assembly.shankDiameter) / 2;
    const lengthOfCut = Number(assembly.lengthOfCut);
    const overallLength = Number(assembly.overallLength);
    if (![cutterRadius, shankRadius, lengthOfCut, overallLength].every(positive)) return result;
    const cutterEnd = reference.z + lengthOfCut;
    const shankEnd = reference.z + Math.max(overallLength, lengthOfCut);
    push("cutter", prismAlongZ({centerX: reference.x, radius: cutterRadius, z0: reference.z, z1: cutterEnd, sides: slices}));
    if (shankEnd - cutterEnd > EPSILON) {
      push("shank", prismAlongZ({centerX: reference.x, radius: shankRadius, z0: cutterEnd, z1: shankEnd, sides: slices}));
    }
    const nose = NOMINAL_DRIVEN_HOLDER_DISPLAY;
    const noseStart = cutterEnd + (shankEnd - cutterEnd) * nose.shankGripFraction;
    const noseEnd = noseStart + nose.noseLengthMm;
    const bodyEnd = noseEnd + nose.bodyLengthMm;
    push("driven-holder", prismAlongZ({centerX: reference.x, radius: nose.noseDiameterMm / 2, z0: noseStart, z1: noseEnd, sides: slices}), {nominal: true});
    push("driven-holder", prismAlongZ({centerX: reference.x, radius: nose.bodyDiameterMm / 2, z0: noseEnd, z1: bodyEnd, sides: slices}), {nominal: true});
    turret = {centerX: reference.x + axialStationOffset, z0: bodyEnd, z1: bodyEnd + NOMINAL_TURRET_DISPLAY.thicknessMm};
  } else {
    const holderOutline = model.holder?.outline?.length >= 3 ? model.holder.outline : componentOutline(model, ["holder"]);
    const cutterOutline = componentOutline(model, ["insert", "cutter"]) || model.insert?.outline || model.cutter?.outline || null;
    const bounds = outlineBounds(holderOutline);
    if (!bounds) return result;
    const axialShank = assembly.mountingAxis === "program-z";
    if (axialShank) {
      // A bar parallel to program Z: the plan outline is given its round shank
      // diameter as a nominal square section centred on the cutting plane.
      const diameter = positive(assembly.holderShankDiameter) ? assembly.holderShankDiameter : Math.max(bounds.maxX - bounds.minX, 1);
      const thickness = positive(assembly.insertThickness) ? assembly.insertThickness : Math.min(NOMINAL_INSERT_THICKNESS_MM, diameter / 4);
      push("holder", extrudeOutline(holderOutline, -diameter / 2, diameter / 2), {nominal: !positive(assembly.holderShankDiameter), dashed: !mountingKnown});
      push("insert", extrudeOutline(cutterOutline, -thickness / 2, thickness / 2), {nominal: !positive(assembly.insertThickness), dashed: !mountingKnown});
      turret = {
        centerX: (bounds.minX + bounds.maxX) / 2 + axialStationOffset,
        z0: bounds.maxZ,
        z1: bounds.maxZ + NOMINAL_TURRET_DISPLAY.thicknessMm,
      };
    } else {
      // Square-shank OD tool: the shank stands on the cutting plane. Standard
      // (insert down, rear turret) puts the holder above the cutting edge in
      // machine +Y; a flipped mounting puts it below.
      const height = positive(assembly.holderShankHeight)
        ? assembly.holderShankHeight
        : (positive(assembly.holderShankWidth) ? assembly.holderShankWidth : NOMINAL_SHANK_HEIGHT_MM);
      const heightPublished = positive(assembly.holderShankHeight) || positive(assembly.holderShankWidth);
      const thickness = positive(assembly.insertThickness) ? assembly.insertThickness : Math.min(NOMINAL_INSERT_THICKNESS_MM, height / 4);
      const up = flipped ? -1 : 1;
      push("holder", extrudeOutline(holderOutline, 0, up * height), {nominal: !heightPublished, dashed: !mountingKnown});
      push(kind === "groove" ? "cutter" : "insert", extrudeOutline(cutterOutline, 0, up * thickness), {nominal: !positive(assembly.insertThickness), dashed: !mountingKnown});
      const centerZ = (bounds.minZ + bounds.maxZ) / 2;
      turret = {
        centerX: bounds.maxX + shankEndOffset,
        z0: centerZ - NOMINAL_TURRET_DISPLAY.thicknessMm / 2,
        z1: centerZ + NOMINAL_TURRET_DISPLAY.thicknessMm / 2,
      };
    }
  }

  if (includeTurret && turret) {
    push("turret", turretDisc({...turret, stations}), {nominal: true});
  }

  const cosine = Math.cos((Number(spindleAngleDegrees) || 0) * DEGREES);
  const sine = Math.sin((Number(spindleAngleDegrees) || 0) * DEGREES);
  const offset = finite(tangent) ? tangent : 0;
  result.bodies = local.map((body) => ({
    role: body.role,
    nominal: body.nominal,
    dashed: body.dashed,
    faces: body.faces.map((face) => ({
      points: face.points.map((point) => toWorld(point, sign, offset, cosine, sine)),
      normal: normalToWorld(face.normal, sign, cosine, sine),
    })),
  }));
  return result;
}

function clipAgainstHalfPlane(points, inside, intersect) {
  const output = [];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const previous = points[(index + points.length - 1) % points.length];
    const currentInside = inside(current);
    const previousInside = inside(previous);
    if (currentInside) {
      if (!previousInside) output.push(intersect(previous, current));
      output.push(current);
    } else if (previousInside) {
      output.push(intersect(previous, current));
    }
  }
  return output;
}

function clipToRectangle(points, minU, maxU, minV, maxV) {
  const lerp = (a, b, t) => ({u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t});
  let result = points;
  const edges = [
    [(point) => point.u >= minU, (a, b) => lerp(a, b, (minU - a.u) / (b.u - a.u))],
    [(point) => point.u <= maxU, (a, b) => lerp(a, b, (maxU - a.u) / (b.u - a.u))],
    [(point) => point.v >= minV, (a, b) => lerp(a, b, (minV - a.v) / (b.v - a.v))],
    [(point) => point.v <= maxV, (a, b) => lerp(a, b, (maxV - a.v) / (b.v - a.v))],
  ];
  for (const [inside, intersect] of edges) {
    if (result.length < 3) return [];
    result = clipAgainstHalfPlane(result, inside, intersect);
  }
  return result.length >= 3 ? result : [];
}

function planarArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    area += a.u * b.v - b.u * a.v;
  }
  return Math.abs(area) / 2;
}

/**
 * Split a planar world-frame polygon into pieces no larger than `cell` (mm)
 * so a painter's sort by piece depth orders it correctly against nearby
 * surfaces. The pieces keep the face normal. Non-convex polygons are clipped
 * with Sutherland–Hodgman against grid rectangles, which yields valid fill
 * regions for display.
 */
export function subdividePlanarPolygon(points, normal, cell) {
  if (!Array.isArray(points) || points.length < 3) return [];
  if (!finite(cell) || cell <= EPSILON) return [points];
  const length = Math.hypot(normal?.x || 0, normal?.y || 0, normal?.z || 0);
  if (length < EPSILON) return [points];
  const n = {x: normal.x / length, y: normal.y / length, z: normal.z / length};
  const helper = Math.abs(n.x) < 0.9 ? {x: 1, y: 0, z: 0} : {x: 0, y: 1, z: 0};
  const cross = (a, b) => ({x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x});
  const rawU = cross(n, helper);
  const uLength = Math.hypot(rawU.x, rawU.y, rawU.z) || 1;
  const U = {x: rawU.x / uLength, y: rawU.y / uLength, z: rawU.z / uLength};
  const V = cross(n, U);
  const origin = points[0];
  const planar = points.map((point) => ({
    u: (point.x - origin.x) * U.x + (point.y - origin.y) * U.y + (point.z - origin.z) * U.z,
    v: (point.x - origin.x) * V.x + (point.y - origin.y) * V.y + (point.z - origin.z) * V.z,
  }));
  const minU = Math.min(...planar.map((point) => point.u));
  const maxU = Math.max(...planar.map((point) => point.u));
  const minV = Math.min(...planar.map((point) => point.v));
  const maxV = Math.max(...planar.map((point) => point.v));
  if (maxU - minU <= cell + EPSILON && maxV - minV <= cell + EPSILON) return [points];
  const columns = Math.max(1, Math.ceil((maxU - minU) / cell));
  const rows = Math.max(1, Math.ceil((maxV - minV) / cell));
  if (columns * rows > 40000) return [points];
  const lift = (point) => ({
    x: origin.x + U.x * point.u + V.x * point.v,
    y: origin.y + U.y * point.u + V.y * point.v,
    z: origin.z + U.z * point.u + V.z * point.v,
  });
  const minimumArea = cell * cell * 1e-6;
  const pieces = [];
  for (let row = 0; row < rows; row += 1) {
    const v0 = minV + row * cell;
    const v1 = row === rows - 1 ? maxV : v0 + cell;
    const strip = clipToRectangle(planar, minU - 1, maxU + 1, v0, v1);
    if (strip.length < 3) continue;
    for (let column = 0; column < columns; column += 1) {
      const u0 = minU + column * cell;
      const u1 = column === columns - 1 ? maxU : u0 + cell;
      const piece = clipToRectangle(strip, u0, u1, v0 - 1, v1 + 1);
      if (piece.length < 3 || planarArea(piece) < minimumArea) continue;
      pieces.push(piece.map(lift));
    }
  }
  return pieces.length ? pieces : [points];
}
