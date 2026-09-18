import {geometryPointAt} from "./geometry-inspector.mjs";

/**
 * Pinned 2D lathe dimensions: readings, figures and label placement.
 *
 * A dimension is either an exact geometry entity (a programmed line or radius
 * on the current stock, a chuck edge) or a pair of exact snap points (corners
 * and midpoints of such entities). Every reading is computed from the retained
 * millimetre geometry, never from canvas pixels; the screen side of things is
 * limited to label boxes, which are pure rectangles the caller lays out.
 *
 * Model coordinates: `z` along the spindle axis, `x` the signed radius.
 */

const EPSILON = 1e-7;

export const DIMENSION_STYLES = Object.freeze({
  axial: Object.freeze(["length", "diameter"]),
  radial: Object.freeze(["extent", "position"]),
  taper: Object.freeze(["length", "deltas", "angle"]),
  arc: Object.freeze(["radius", "center"]),
  pair: Object.freeze(["aligned", "axial", "radial"]),
});

export function lineClass(entity, tolerance = EPSILON) {
  const deltaZ = Math.abs(entity.end.z - entity.start.z);
  const deltaX = Math.abs(entity.end.x - entity.start.x);
  if (deltaX <= tolerance) return "axial";
  if (deltaZ <= tolerance) return "radial";
  return "taper";
}

export function lineAngleDegrees(entity) {
  const deltaZ = Math.abs(entity.end.z - entity.start.z);
  const deltaX = Math.abs(entity.end.x - entity.start.x);
  return Math.atan2(deltaX, deltaZ) * 180 / Math.PI;
}

export function samePoint(first, second, tolerance = EPSILON) {
  return Math.abs(first.z - second.z) <= tolerance && Math.abs(first.x - second.x) <= tolerance;
}

export function isSnapHit(hit) {
  return hit?.kind === "corner" || hit?.kind === "midpoint";
}

/** Numeric bound carried by imported reference geometry (DXF profile or STEP section), or null. */
export function referenceBound(entity) {
  if (!entity?.metadata?.referenceGeometry) return null;
  return {
    format: entity.metadata.referenceFormat === "step" ? "STEP" : "DXF",
    uncertaintyMm: Number(entity.metadata.geometryUncertaintyMm) || 0,
  };
}

export function mergeReferenceBounds(first, second) {
  if (!first) return second || null;
  if (!second) return first;
  const format = [...new Set([first.format, second.format])].join("/");
  return {format, uncertaintyMm: Math.max(first.uncertaintyMm, second.uncertaintyMm)};
}

export function pairMeasurement(a, b) {
  const deltaZ = b.z - a.z;
  const deltaX = b.x - a.x;
  return {
    deltaZ,
    deltaX,
    distance: Math.hypot(deltaZ, deltaX),
    angleDegrees: Math.atan2(Math.abs(deltaX), Math.abs(deltaZ)) * 180 / Math.PI,
    midpoint: {z: (a.z + b.z) / 2, x: (a.x + b.x) / 2},
  };
}

export function dimensionKind(dimension) {
  if (dimension.kind === "pair") return "pair";
  return dimension.entity.type === "arc" ? "arc" : lineClass(dimension.entity);
}

export function dimensionStyles(dimension) {
  const kind = dimensionKind(dimension);
  const styles = [...DIMENSION_STYLES[kind]];
  if (kind === "radial" && Math.abs(dimension.entity.start.z) <= EPSILON) {
    return styles.filter((style) => style !== "position");
  }
  if (kind === "pair") {
    const measurement = pairMeasurement(dimension.a, dimension.b);
    return styles.filter((style) => (
      (style !== "axial" || Math.abs(measurement.deltaZ) > EPSILON)
      && (style !== "radial" || Math.abs(measurement.deltaX) > EPSILON)
    ));
  }
  return styles;
}

export function nextDimensionStyle(dimension) {
  const styles = dimensionStyles(dimension);
  const index = styles.indexOf(dimension.style);
  return styles[(index + 1) % styles.length];
}

export function entityDimensionKey(entity) {
  return entity.id;
}

function pointKey(point) {
  return `${point.z.toFixed(9)}:${point.x.toFixed(9)}`;
}

export function pairDimensionKey(a, b) {
  return `pair:${[pointKey(a), pointKey(b)].sort().join("|")}`;
}

export function entityDimension(entity) {
  const dimension = {
    key: entityDimensionKey(entity), kind: "entity", entity: JSON.parse(JSON.stringify(entity)), style: null,
    reference: referenceBound(entity),
  };
  dimension.style = dimensionStyles(dimension)[0];
  return dimension;
}

export function pairDimension(a, b) {
  return {
    key: pairDimensionKey(a, b),
    kind: "pair",
    a: {z: Number(a.z), x: Number(a.x)},
    b: {z: Number(b.z), x: Number(b.x)},
    style: "aligned",
    reference: mergeReferenceBounds(a.reference || null, b.reference || null),
  };
}

export function withoutDimension(dimensions, key) {
  return dimensions.filter((dimension) => dimension.key !== key);
}

export function withCycledDimension(dimensions, key) {
  return dimensions.map((dimension) => (
    dimension.key === key ? {...dimension, style: nextDimensionStyle(dimension)} : dimension
  ));
}

function signed(value, format) {
  const magnitude = format.length(Math.abs(value));
  if (Math.abs(value) <= EPSILON) return magnitude;
  return `${value < 0 ? "-" : "+"}${magnitude}`;
}

function radialDeltaLines(deltaX, format) {
  const radial = Math.abs(deltaX);
  return format.diameterMode
    ? [`ΔØ ${format.length(radial * 2)}`, `${format.length(radial)} radial`]
    : [`ΔX ${format.length(radial)}`, `ΔØ ${format.length(radial * 2)}`];
}

/**
 * Label text for a dimension: an array of labels, each an array of lines.
 * Most styles produce one label; `deltas` produces one per leg. Imported
 * reference geometry appends its numeric bound so the reading is never
 * mistaken for an exact programmed value.
 */
export function dimensionReadings(dimension, format) {
  const labels = baseReadings(dimension, format);
  if (dimension.reference) {
    const bound = (format.bound || format.length)(dimension.reference.uncertaintyMm);
    labels[0] = [...labels[0], `${dimension.reference.format} · bound ≤ ${bound}`];
  }
  return labels;
}

function baseReadings(dimension, format) {
  const kind = dimensionKind(dimension);
  const style = dimension.style;
  if (kind === "pair") {
    const measurement = pairMeasurement(dimension.a, dimension.b);
    const radial = radialDeltaLines(measurement.deltaX, format);
    if (style === "axial") return [[`ΔZ ${format.length(Math.abs(measurement.deltaZ))}`]];
    if (style === "radial") return [radial];
    return [[format.length(measurement.distance), `ΔZ ${format.length(Math.abs(measurement.deltaZ))} · ${radial[0]}`]];
  }
  const entity = dimension.entity;
  if (kind === "arc") {
    const radius = `R ${format.length(entity.radius)}`;
    if (style === "center") {
      return [[radius, `center Z ${signed(entity.center.z, format)} · X ${signed(entity.center.x, format)}`]];
    }
    return [[radius]];
  }
  const deltaZ = Math.abs(entity.end.z - entity.start.z);
  const deltaX = Math.abs(entity.end.x - entity.start.x);
  if (kind === "axial") {
    if (style === "diameter") return [[`Ø ${format.length(Math.abs(entity.start.x) * 2)}`]];
    return [[format.length(deltaZ)]];
  }
  if (kind === "radial") {
    if (style === "position") return [[`Z ${signed(entity.start.z, format)}`, "from Z0"]];
    const crossesAxis = entity.start.x * entity.end.x < -EPSILON;
    if (crossesAxis) {
      const diameters = [Math.abs(entity.start.x), Math.abs(entity.end.x)].map((radius) => `Ø ${format.length(radius * 2)}`);
      return [[`${format.length(deltaX)} across the axis`, diameters[0] === diameters[1] ? diameters[0] : diameters.join(" / ")]];
    }
    const [inner, outer] = [Math.abs(entity.start.x), Math.abs(entity.end.x)].sort((first, second) => first - second);
    return [[`${format.length(deltaX)} radial`, `Ø ${format.length(inner * 2)} → Ø ${format.length(outer * 2)}`]];
  }
  if (style === "deltas") {
    return [[`ΔZ ${format.length(deltaZ)}`], [radialDeltaLines(deltaX, format)[0]]];
  }
  if (style === "angle") return [[`${format.angle(lineAngleDegrees(entity))} to Z axis`]];
  return [[format.length(Math.hypot(deltaZ, deltaX))]];
}

/** Model-space drawing figure for a dimension at its current style. */
export function dimensionFigure(dimension) {
  const kind = dimensionKind(dimension);
  const style = dimension.style;
  if (kind === "pair") {
    if (style === "axial") return {type: "horizontal", from: dimension.a, to: dimension.b};
    if (style === "radial") return {type: "vertical", from: dimension.a, to: dimension.b};
    return {type: "aligned", from: dimension.a, to: dimension.b};
  }
  const entity = dimension.entity;
  if (kind === "arc") {
    return {type: "radius", center: {...entity.center}, midpoint: geometryPointAt(entity, 0.5), radius: entity.radius};
  }
  const start = {...entity.start};
  const end = {...entity.end};
  if (kind === "axial") {
    if (style === "diameter") {
      const z = (start.z + end.z) / 2;
      const radius = Math.abs(start.x);
      return {type: "diameter", from: {z, x: -radius}, to: {z, x: radius}};
    }
    return {type: "aligned", from: start, to: end};
  }
  if (kind === "radial") {
    if (style === "position") {
      const outer = Math.abs(start.x) >= Math.abs(end.x) ? start : end;
      return {type: "horizontal", from: {z: 0, x: outer.x}, to: {z: outer.z, x: outer.x}, datum: true};
    }
    return {type: "vertical", from: start, to: end};
  }
  if (style === "deltas") return {type: "deltas", from: start, corner: {z: end.z, x: start.x}, to: end};
  if (style === "angle") return {type: "angle", vertex: start, toward: end, degrees: lineAngleDegrees(entity)};
  return {type: "aligned", from: start, to: end};
}

export function rectsOverlap(first, second, gap = 2) {
  return first.x < second.x + second.width + gap
    && second.x < first.x + first.width + gap
    && first.y < second.y + second.height + gap
    && second.y < first.y + first.height + gap;
}

/**
 * Nudge a label rectangle along (stepX, stepY) until it clears every placed
 * rectangle, then clamp it inside the canvas bounds. Returns a new rectangle.
 */
export function placeLabelRect(rect, placed, {stepX = 0, stepY = -12, maxSteps = 8, bounds = null} = {}) {
  let candidate = {...rect};
  for (let step = 0; step < maxSteps; step += 1) {
    if (!placed.some((other) => rectsOverlap(candidate, other))) break;
    candidate = {...candidate, x: candidate.x + stepX, y: candidate.y + stepY};
  }
  if (bounds) {
    const margin = bounds.margin ?? 4;
    candidate.x = Math.max(margin, Math.min(bounds.width - candidate.width - margin, candidate.x));
    candidate.y = Math.max(margin, Math.min(bounds.height - candidate.height - margin, candidate.y));
  }
  return candidate;
}

function inRect(rect, point) {
  return Boolean(rect) && point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/** Topmost pinned-label region under a screen point: `{key, close}` or null. */
export function labelRegionAt(regions, point) {
  for (let index = regions.length - 1; index >= 0; index -= 1) {
    const region = regions[index];
    if (inRect(region.closeRect, point)) return {key: region.key, close: true};
    if (inRect(region.rect, point)) return {key: region.key, close: false};
  }
  return null;
}
