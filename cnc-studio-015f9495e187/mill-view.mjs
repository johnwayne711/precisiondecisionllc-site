import {projectModelPoint} from "./view3d.mjs";
import {MILL_PARSE_LIMITS, millProgramBounds} from "./mill-gcode.mjs";

const DEFAULT_CAMERA = Object.freeze({
  yaw: -Math.PI / 4,
  pitch: Math.asin(1 / Math.sqrt(3)),
  zoom: 1,
  panX: 0,
  panY: 0,
});

export const MILL_RENDER_LIMITS = Object.freeze({
  maxSegments: MILL_PARSE_LIMITS.maxSegments,
  maxPoints: MILL_PARSE_LIMITS.maxPoints,
  maxGridLinesPerAxis: 25,
});

const PATH_COLORS = Object.freeze({
  rapid: "#f59e0b",
  linear: "#38bdf8",
  "arc-cw": "#a78bfa",
  "arc-ccw": "#a78bfa",
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finitePoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y) && Number.isFinite(point?.z);
}

function positiveFiniteOr(value, fallback = 1) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function fallbackBounds() {
  return {minX: -1, maxX: 1, minY: -1, maxY: 1, minZ: -1, maxZ: 1};
}

/** Preserve the canonical mill coordinate frame without lathe axis or diameter transforms. */
export function millWorldPoint(point) {
  return {x: point?.x, y: point?.y, z: point?.z};
}

export function millSegmentWorldPoints(segment) {
  if (!Array.isArray(segment?.points)) return [];
  return segment.points.map(millWorldPoint);
}

/**
 * Calculate geometry bounds from canonical millimetre XYZ points. Rendering can
 * include the work-frame origin for context, but this helper never quantizes or
 * tessellates the supplied geometry.
 */
export function millXyzBounds(segments = [], {includeOrigin = false} = {}) {
  if (!Array.isArray(segments)) throw new TypeError("Mill segments must be an array");
  for (const segment of segments) {
    if (!Array.isArray(segment?.points)) throw new TypeError("Each mill segment must provide a points array");
    if (segment.points.some((point) => !finitePoint(point))) throw new RangeError("Mill bounds require finite XYZ points");
  }
  const exact = millProgramBounds(segments);
  if (!exact) return fallbackBounds();
  let {minX, maxX, minY, maxY, minZ, maxZ} = exact;
  if (includeOrigin) {
    minX = Math.min(minX, 0);
    maxX = Math.max(maxX, 0);
    minY = Math.min(minY, 0);
    maxY = Math.max(maxY, 0);
    minZ = Math.min(minZ, 0);
    maxZ = Math.max(maxZ, 0);
  }
  return {minX, maxX, minY, maxY, minZ, maxZ};
}

/** Top view convention: +X is screen-right and +Y is screen-up. */
export function millTopProjector(bounds, width, height, padding = 36) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const safePadding = clamp(Number(padding) || 0, 0, Math.max(0, Math.min(safeWidth, safeHeight) / 2 - 0.5));
  const spanX = positiveFiniteOr(Number(bounds?.maxX) - Number(bounds?.minX));
  const spanY = positiveFiniteOr(Number(bounds?.maxY) - Number(bounds?.minY));
  const fittedScale = Math.min(
    Math.max(1, safeWidth - safePadding * 2) / spanX,
    Math.max(1, safeHeight - safePadding * 2) / spanY,
  );
  const scale = positiveFiniteOr(fittedScale);
  const centerX = (Number(bounds?.minX) + Number(bounds?.maxX)) / 2 || 0;
  const centerY = (Number(bounds?.minY) + Number(bounds?.maxY)) / 2 || 0;
  return (point) => ({
    x: safeWidth / 2 + (point.x - centerX) * scale,
    y: safeHeight / 2 - (point.y - centerY) * scale,
  });
}

export function projectMillTopPoint(point, {
  bounds = fallbackBounds(), width = 1, height = 1, padding = 36,
} = {}) {
  return millTopProjector(bounds, width, height, padding)(point);
}

export function millToolpathStyleForSegment(segment, {pending = false} = {}) {
  const rapid = segment?.type === "rapid";
  const blocked = Boolean(segment?.verificationBlocked);
  if (blocked) {
    return {
      color: pending ? "#7f1d1d" : "#fb7185",
      width: pending ? 1.4 : 2.8,
      dash: [2, 2],
      alpha: pending ? 0.5 : 0.98,
      glow: pending ? 0 : 7,
    };
  }
  return {
    color: pending ? "#64748b" : (PATH_COLORS[segment?.type] || "#94a3b8"),
    width: pending ? 1.1 : (rapid ? 1.4 : 2.2),
    dash: rapid ? [6, 5] : [],
    alpha: pending ? 0.3 : 0.98,
    glow: pending ? 0 : 5,
  };
}

function renderBudget(segments) {
  if (!Array.isArray(segments)) return {blocked: true, reason: "INVALID SEGMENT LIST", pointCount: 0};
  if (segments.length > MILL_RENDER_LIMITS.maxSegments) {
    return {blocked: true, reason: "SEGMENT LIMIT EXCEEDED", pointCount: 0};
  }
  let pointCount = 0;
  for (const segment of segments) {
    if (!Array.isArray(segment?.points)) {
      return {blocked: true, reason: "INVALID SEGMENT POINTS", pointCount};
    }
    pointCount += segment.points.length;
    if (pointCount > MILL_RENDER_LIMITS.maxPoints) {
      return {blocked: true, reason: "POINT LIMIT EXCEEDED", pointCount};
    }
    if (segment.points.some((point) => !finitePoint(point))) {
      return {blocked: true, reason: "NON-FINITE XYZ POINT", pointCount};
    }
  }
  return {blocked: false, reason: null, pointCount};
}

function normalizedVisibleCount(visibleCount, segmentCount) {
  const numeric = Number(visibleCount);
  if (!Number.isFinite(numeric)) return numeric === Infinity ? segmentCount : 0;
  return clamp(Math.trunc(numeric), 0, segmentCount);
}

function niceGridStep(span, targetLines = 10) {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const rough = span / Math.max(1, targetLines);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function axisGridValues(minimum, maximum, step) {
  if (![minimum, maximum, step].every(Number.isFinite) || !(step > 0)) return [];
  const start = Math.ceil(minimum / step) * step;
  const values = [];
  for (let value = start; value <= maximum + step * 1e-9 && values.length < MILL_RENDER_LIMITS.maxGridLinesPerAxis; value += step) {
    values.push(Math.abs(value) < step * 1e-12 ? 0 : value);
  }
  return values;
}

function drawPolyline(context, points, project, style) {
  if (points.length < 2) return;
  context.beginPath();
  points.forEach((point, index) => {
    const screen = project(point);
    if (index) context.lineTo(screen.x, screen.y); else context.moveTo(screen.x, screen.y);
  });
  context.strokeStyle = style.color;
  context.lineWidth = style.width;
  context.globalAlpha = style.alpha;
  context.setLineDash(style.dash);
  context.shadowColor = style.glow ? style.color : "transparent";
  context.shadowBlur = style.glow;
  context.stroke();
  context.setLineDash([]);
  context.globalAlpha = 1;
  context.shadowBlur = 0;
}

function drawBackground(context, width, height) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#061012";
  context.fillRect(0, 0, width, height);
}

function drawBlockedMessage(context, width, height, reason) {
  context.fillStyle = "#fb7185";
  context.font = '700 10px "Cascadia Code", Consolas, monospace';
  context.textAlign = "center";
  context.fillText("TOOLPATH DISPLAY BLOCKED", width / 2, height / 2 - 8);
  context.fillStyle = "rgba(251, 113, 133, .82)";
  context.font = '9px "Cascadia Code", Consolas, monospace';
  context.fillText(reason, width / 2, height / 2 + 10);
  context.textAlign = "left";
}

function lastVisiblePoint(segments, visibleCount) {
  for (let index = visibleCount - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment?.verificationBlocked && finitePoint(segment.start)) return segment.start;
    const points = segment?.points;
    if (Array.isArray(points) && points.length) return points.at(-1);
  }
  return null;
}

function drawCurrentMarker(context, point, project) {
  if (!point) return;
  const screen = project(point);
  context.fillStyle = "#ffffff";
  context.shadowColor = "#56e39f";
  context.shadowBlur = 10;
  context.beginPath();
  context.arc(screen.x, screen.y, 3.5, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
}

function drawMillPaths(context, segments, visibleCount, project, currentPointOverride = undefined) {
  for (const segment of segments) {
    drawPolyline(context, millSegmentWorldPoints(segment), project, millToolpathStyleForSegment(segment, {pending: true}));
  }
  for (const segment of segments.slice(0, visibleCount)) {
    drawPolyline(context, millSegmentWorldPoints(segment), project, millToolpathStyleForSegment(segment));
  }
  const currentPoint = currentPointOverride === undefined
    ? lastVisiblePoint(segments, visibleCount)
    : currentPointOverride;
  drawCurrentMarker(context, currentPoint, project);
  return currentPoint;
}

function boundsIncludingPoint(bounds, point) {
  if (!finitePoint(point)) return bounds;
  return {
    minX: Math.min(bounds.minX, point.x), maxX: Math.max(bounds.maxX, point.x),
    minY: Math.min(bounds.minY, point.y), maxY: Math.max(bounds.maxY, point.y),
    minZ: Math.min(bounds.minZ, point.z), maxZ: Math.max(bounds.maxZ, point.z),
  };
}

function renderBounds(segments, currentPoint) {
  const bounds = segments.length
    ? millXyzBounds(segments)
    : (finitePoint(currentPoint)
      ? {minX: currentPoint.x, maxX: currentPoint.x, minY: currentPoint.y, maxY: currentPoint.y, minZ: currentPoint.z, maxZ: currentPoint.z}
      : fallbackBounds());
  return boundsIncludingPoint(bounds, currentPoint);
}

function unitLabel(lengthScale, lengthUnit) {
  const scale = Number(lengthScale);
  return Number.isFinite(scale) && scale > 0 ? String(lengthUnit || "mm") : "mm";
}

function drawTopGrid(context, bounds, project) {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
  const step = niceGridStep(span);
  context.beginPath();
  for (const x of axisGridValues(bounds.minX, bounds.maxX, step)) {
    const bottom = project({x, y: bounds.minY, z: 0});
    const top = project({x, y: bounds.maxY, z: 0});
    context.moveTo(bottom.x, bottom.y);
    context.lineTo(top.x, top.y);
  }
  for (const y of axisGridValues(bounds.minY, bounds.maxY, step)) {
    const left = project({x: bounds.minX, y, z: 0});
    const right = project({x: bounds.maxX, y, z: 0});
    context.moveTo(left.x, left.y);
    context.lineTo(right.x, right.y);
  }
  context.strokeStyle = "rgba(145, 166, 171, .16)";
  context.lineWidth = 1;
  context.setLineDash([]);
  context.stroke();

  const xEnd = project({x: bounds.maxX, y: 0, z: 0});
  const yEnd = project({x: 0, y: bounds.maxY, z: 0});
  drawPolyline(context, [{x: bounds.minX, y: 0, z: 0}, {x: bounds.maxX, y: 0, z: 0}], project, {color: "#fb7185", width: 1.3, dash: [], alpha: 0.72, glow: 0});
  drawPolyline(context, [{x: 0, y: bounds.minY, z: 0}, {x: 0, y: bounds.maxY, z: 0}], project, {color: "#56e39f", width: 1.3, dash: [], alpha: 0.72, glow: 0});
  context.font = '700 9px "Cascadia Code", Consolas, monospace';
  context.fillStyle = "#fb7185";
  context.fillText("X+", xEnd.x + 4, xEnd.y - 4);
  context.fillStyle = "#56e39f";
  context.fillText("Y+", yEnd.x + 4, yEnd.y - 4);
}

export function renderMillTop2d(context, {
  width,
  height,
  segments = [],
  visibleCount = 0,
  currentPoint = undefined,
  lengthScale = 1,
  lengthUnit = "mm",
} = {}) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  drawBackground(context, safeWidth, safeHeight);
  const budget = renderBudget(segments);
  if (budget.blocked) {
    drawBlockedMessage(context, safeWidth, safeHeight, budget.reason);
    return {displayBlocked: true, reason: budget.reason, pointCount: budget.pointCount, currentPoint: null};
  }

  const bounds = renderBounds(segments, currentPoint);
  const project = millTopProjector(bounds, safeWidth, safeHeight);
  drawTopGrid(context, bounds, project);
  const shownCount = normalizedVisibleCount(visibleCount, segments.length);
  const shownPoint = drawMillPaths(context, segments, shownCount, project, currentPoint);

  context.fillStyle = "rgba(180, 205, 208, .82)";
  context.font = '9px "Cascadia Code", Consolas, monospace';
  context.fillText(`TOP XY · TOOL CENTERLINE · PATH ONLY · ${unitLabel(lengthScale, lengthUnit)}`, 12, 18);
  return {displayBlocked: false, bounds, pointCount: budget.pointCount, visibleCount: shownCount, currentPoint: shownPoint, project};
}

function boundsCorners(bounds) {
  const corners = [];
  for (const x of [bounds.minX, bounds.maxX]) {
    for (const y of [bounds.minY, bounds.maxY]) {
      for (const z of [bounds.minZ, bounds.maxZ]) corners.push({x, y, z});
    }
  }
  return corners;
}

export function mill3dProjector(bounds, width, height, camera = DEFAULT_CAMERA, {
  padding = 42,
  projection = null,
} = {}) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
  const sceneSize = Math.max(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
    1,
  );
  const yaw = Number.isFinite(camera?.yaw) ? camera.yaw : DEFAULT_CAMERA.yaw;
  const pitch = Number.isFinite(camera?.pitch) ? camera.pitch : DEFAULT_CAMERA.pitch;
  const requestedProjection = projection || camera?.projection;
  const projectionMode = requestedProjection === "perspective" ? "perspective" : "orthographic";
  const perspectiveDistance = sceneSize * 5;
  const unitOptions = {
    center, yaw, pitch, scale: 1, projection: projectionMode, perspectiveDistance,
    width: 0, height: 0, panX: 0, panY: 0,
  };
  const projectedCorners = boundsCorners(bounds).map((point) => projectModelPoint(point, unitOptions));
  const projectedWidth = Math.max(...projectedCorners.map((point) => point.x)) - Math.min(...projectedCorners.map((point) => point.x));
  const projectedHeight = Math.max(...projectedCorners.map((point) => point.y)) - Math.min(...projectedCorners.map((point) => point.y));
  const fitWidth = Math.max(1, safeWidth - padding * 2) / positiveFiniteOr(projectedWidth);
  const fitHeight = Math.max(1, safeHeight - padding * 2) / positiveFiniteOr(projectedHeight);
  const zoom = clamp(Number(camera?.zoom) || 1, 0.01, 500);
  const scale = positiveFiniteOr(Math.min(fitWidth, fitHeight)) * zoom;
  const options = {
    center,
    yaw,
    pitch,
    scale,
    projection: projectionMode,
    perspectiveDistance,
    width: safeWidth,
    height: safeHeight,
    panX: Number(camera?.panX) || 0,
    panY: Number(camera?.panY) || 0,
  };
  return {project: (point) => projectModelPoint(point, options), center, scale, sceneSize, projection: projectionMode};
}

function draw3dGridAndAxes(context, bounds, project) {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, Math.max(spanX, spanY) * 0.25, 1);
  const step = niceGridStep(Math.max(spanX, spanY));

  for (const x of axisGridValues(bounds.minX, bounds.maxX, step)) {
    drawPolyline(context, [{x, y: bounds.minY, z: 0}, {x, y: bounds.maxY, z: 0}], project, {
      color: "rgba(145, 166, 171, .16)", width: 1, dash: [], alpha: 1, glow: 0,
    });
  }
  for (const y of axisGridValues(bounds.minY, bounds.maxY, step)) {
    drawPolyline(context, [{x: bounds.minX, y, z: 0}, {x: bounds.maxX, y, z: 0}], project, {
      color: "rgba(145, 166, 171, .16)", width: 1, dash: [], alpha: 1, glow: 0,
    });
  }

  const zMinimum = Math.min(bounds.minZ, -spanZ * 0.08);
  const zMaximum = Math.max(bounds.maxZ, spanZ * 0.35);
  const axes = [
    {label: "X", color: "#fb7185", points: [{x: bounds.minX, y: 0, z: 0}, {x: bounds.maxX, y: 0, z: 0}]},
    {label: "Y", color: "#56e39f", points: [{x: 0, y: bounds.minY, z: 0}, {x: 0, y: bounds.maxY, z: 0}]},
    {label: "Z", color: "#38bdf8", points: [{x: 0, y: 0, z: zMinimum}, {x: 0, y: 0, z: zMaximum}]},
  ];
  for (const axis of axes) {
    drawPolyline(context, axis.points, project, {color: axis.color, width: 1.4, dash: [], alpha: 0.78, glow: 0});
    const label = project(axis.points.at(-1));
    context.fillStyle = axis.color;
    context.font = '700 9px "Cascadia Code", Consolas, monospace';
    context.fillText(`${axis.label}+`, label.x + 4, label.y - 4);
  }
}

export function renderMill3d(context, {
  width,
  height,
  segments = [],
  visibleCount = 0,
  currentPoint = undefined,
  lengthScale = 1,
  lengthUnit = "mm",
  camera = DEFAULT_CAMERA,
  projection = null,
} = {}) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  drawBackground(context, safeWidth, safeHeight);
  const budget = renderBudget(segments);
  if (budget.blocked) {
    drawBlockedMessage(context, safeWidth, safeHeight, budget.reason);
    return {displayBlocked: true, reason: budget.reason, pointCount: budget.pointCount, currentPoint: null};
  }

  const bounds = renderBounds(segments, currentPoint);
  const scene = mill3dProjector(bounds, safeWidth, safeHeight, camera, {projection});
  draw3dGridAndAxes(context, bounds, scene.project);
  const shownCount = normalizedVisibleCount(visibleCount, segments.length);
  const shownPoint = drawMillPaths(context, segments, shownCount, scene.project, currentPoint);

  context.fillStyle = "rgba(180, 205, 208, .82)";
  context.font = '9px "Cascadia Code", Consolas, monospace';
  context.fillText(`XYZ TOOL CENTERLINE · PATH ONLY · ${unitLabel(lengthScale, lengthUnit)}`, 12, 18);
  context.fillStyle = "rgba(145, 166, 171, .66)";
  context.textAlign = "right";
  context.fillText("MIDDLE-DRAG ORBIT · LEFT-DRAG PAN · WHEEL ZOOM", safeWidth - 14, safeHeight - 14);
  context.textAlign = "left";
  return {
    displayBlocked: false,
    bounds,
    pointCount: budget.pointCount,
    visibleCount: shownCount,
    currentPoint: shownPoint,
    project: scene.project,
    projection: scene.projection,
  };
}
