import {stockContourPoints} from "./simulation.mjs";

const PATH_COLORS = {
  rapid: "#f59e0b",
  rough: "#22c55e",
  "cycle-profile": "#67e8f9",
  finish: "#e5eefc",
  linear: "#38bdf8",
  "arc-cw": "#a78bfa",
  "arc-ccw": "#a78bfa",
};

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function stockRadialProfile(stock) {
  if (stock?.profile) return Array.from(stock.profile);
  const profile = [];
  for (let axial = 0; axial < stock.columns; axial += 1) {
    let outside = -1;
    for (let radial = stock.rows - 1; radial >= 0; radial -= 1) {
      if (stock.cells[radial * stock.columns + axial]) {
        outside = radial;
        break;
      }
    }
    profile.push(outside < 0 ? 0 : (outside + 1) / stock.rows * stock.radius);
  }
  return profile;
}

export const stockProfileFromGrid = stockRadialProfile;

export function projectModelPoint(point, {
  center = {x: 0, y: 0, z: 0}, yaw = -Math.PI / 4, pitch = Math.asin(1 / Math.sqrt(3)),
  scale = 1, projection = "orthographic", perspectiveDistance = 100,
  width = 1, height = 1, panX = 0, panY = 0,
} = {}) {
  const x = point.x - center.x;
  const y = point.y - center.y;
  const z = point.z - center.z;
  const cosineYaw = Math.cos(yaw);
  const sineYaw = Math.sin(yaw);
  const yawX = x * cosineYaw - z * sineYaw;
  const yawZ = x * sineYaw + z * cosineYaw;
  const cosinePitch = Math.cos(pitch);
  const sinePitch = Math.sin(pitch);
  const pitchY = y * cosinePitch - yawZ * sinePitch;
  const depth = y * sinePitch + yawZ * cosinePitch;
  const perspective = projection === "perspective"
    ? perspectiveDistance / Math.max(perspectiveDistance * 0.3, perspectiveDistance - depth)
    : 1;
  return {
    x: width / 2 + panX + yawX * scale * perspective,
    y: height / 2 + panY - pitchY * scale * perspective,
    depth,
    perspective,
  };
}

// Compatibility alias for the current lathe renderer. The camera itself is model-format agnostic.
export const projectLathePoint = projectModelPoint;

export function standardCameraView(name, current = {}) {
  const views = {
    front: {x: 0, y: 0, z: 1},
    back: {x: 0, y: 0, z: -1},
    top: {x: 0, y: 1, z: 0},
    bottom: {x: 0, y: -1, z: 0},
    right: {x: -1, y: 0, z: 0},
    left: {x: 1, y: 0, z: 0},
  };
  return cameraViewForDirection(name === "iso" || !views[name] ? {x: -1, y: 1, z: 1} : views[name], current);
}

export function cameraViewForDirection(direction, current = {}) {
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  const normalized = {
    x: direction.x / length,
    y: direction.y / length,
    z: direction.z / length,
  };
  return {
    zoom: current.zoom ?? 1,
    panX: 0,
    panY: 0,
    yaw: Math.abs(normalized.x) + Math.abs(normalized.z) < 1e-8 ? 0 : Math.atan2(normalized.x, normalized.z),
    pitch: Math.asin(clamp(normalized.y, -1, 1)),
  };
}

export function navigationDragMode(button, pointerType = "mouse") {
  if (pointerType === "touch" || pointerType === "pen") return "orbit";
  if (button === 1) return "orbit";
  if (button === 0) return "pan";
  return null;
}

export function orbitCameraFromDrag(camera, deltaX, deltaY, sensitivity = 0.008) {
  return {
    ...camera,
    yaw: (Number(camera?.yaw) || 0) - deltaX * sensitivity,
    pitch: clamp((Number(camera?.pitch) || 0) - deltaY * sensitivity, -Math.PI / 2, Math.PI / 2),
  };
}

export function zoomCameraAt(camera, factor, anchor, viewport, {
  minimumZoom = 0.25, maximumZoom = 500,
} = {}) {
  const width = Math.max(1, Number(viewport?.width) || 1);
  const height = Math.max(1, Number(viewport?.height) || 1);
  const centerX = width / 2;
  const centerY = height / 2;
  const anchorX = Number.isFinite(anchor?.x) ? anchor.x : centerX;
  const anchorY = Number.isFinite(anchor?.y) ? anchor.y : centerY;
  const oldZoom = clamp(Number(camera?.zoom) || 1, minimumZoom, maximumZoom);
  const newZoom = clamp(oldZoom * factor, minimumZoom, maximumZoom);
  const appliedFactor = newZoom / oldZoom;
  const panX = Number(camera?.panX) || 0;
  const panY = Number(camera?.panY) || 0;
  return {
    ...camera,
    zoom: newZoom,
    panX: anchorX - centerX - (anchorX - centerX - panX) * appliedFactor,
    panY: anchorY - centerY - (anchorY - centerY - panY) * appliedFactor,
  };
}

function rotateForCube(point, camera) {
  const cosineYaw = Math.cos(camera.yaw);
  const sineYaw = Math.sin(camera.yaw);
  const yawX = point.x * cosineYaw - point.z * sineYaw;
  const yawZ = point.x * sineYaw + point.z * cosineYaw;
  const cosinePitch = Math.cos(camera.pitch);
  const sinePitch = Math.sin(camera.pitch);
  return {
    x: yawX,
    y: point.y * cosinePitch - yawZ * sinePitch,
    depth: point.y * sinePitch + yawZ * cosinePitch,
  };
}

function cardinalStockView(camera) {
  const cosinePitch = Math.cos(camera.pitch);
  const direction = {
    x: Math.sin(camera.yaw) * cosinePitch,
    y: Math.sin(camera.pitch),
    z: Math.cos(camera.yaw) * cosinePitch,
  };
  if (Math.abs(direction.z) > 1 - 1e-10) return "front-back";
  if (Math.abs(direction.y) > 1 - 1e-10) return "top-bottom";
  if (Math.abs(direction.x) > 1 - 1e-10) return "end";
  return null;
}

const CUBE_AXES = ["x", "y", "z"];
const CUBE_BEVEL = 0.58;

function cubePoint(values = {}) {
  return {x: values.x || 0, y: values.y || 0, z: values.z || 0};
}

function cubeDirectionLabel(direction) {
  const labels = [];
  if (direction.y > 0) labels.push("Top");
  if (direction.y < 0) labels.push("Bottom");
  if (direction.z > 0) labels.push("Front");
  if (direction.z < 0) labels.push("Back");
  if (direction.x > 0) labels.push("Left");
  if (direction.x < 0) labels.push("Right");
  return labels.join(" ");
}

function cubeZoneId(direction) {
  return CUBE_AXES.map((axis) => `${axis}${direction[axis] > 0 ? "+" : direction[axis] < 0 ? "-" : "0"}`).join("");
}

export function viewCubeZones() {
  const zones = [];
  for (const axis of CUBE_AXES) {
    const others = CUBE_AXES.filter((candidate) => candidate !== axis);
    for (const sign of [-1, 1]) {
      const direction = cubePoint({[axis]: sign});
      const points = [
        cubePoint({[axis]: sign, [others[0]]: -CUBE_BEVEL, [others[1]]: -CUBE_BEVEL}),
        cubePoint({[axis]: sign, [others[0]]: CUBE_BEVEL, [others[1]]: -CUBE_BEVEL}),
        cubePoint({[axis]: sign, [others[0]]: CUBE_BEVEL, [others[1]]: CUBE_BEVEL}),
        cubePoint({[axis]: sign, [others[0]]: -CUBE_BEVEL, [others[1]]: CUBE_BEVEL}),
      ];
      zones.push({id: `face-${cubeZoneId(direction)}`, kind: "face", label: cubeDirectionLabel(direction), direction, points});
    }
  }

  for (let firstIndex = 0; firstIndex < CUBE_AXES.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < CUBE_AXES.length; secondIndex += 1) {
      const first = CUBE_AXES[firstIndex];
      const second = CUBE_AXES[secondIndex];
      const remaining = CUBE_AXES.find((axis) => axis !== first && axis !== second);
      for (const firstSign of [-1, 1]) {
        for (const secondSign of [-1, 1]) {
          const direction = cubePoint({[first]: firstSign, [second]: secondSign});
          const points = [
            cubePoint({[first]: firstSign, [second]: secondSign * CUBE_BEVEL, [remaining]: -CUBE_BEVEL}),
            cubePoint({[first]: firstSign, [second]: secondSign * CUBE_BEVEL, [remaining]: CUBE_BEVEL}),
            cubePoint({[first]: firstSign * CUBE_BEVEL, [second]: secondSign, [remaining]: CUBE_BEVEL}),
            cubePoint({[first]: firstSign * CUBE_BEVEL, [second]: secondSign, [remaining]: -CUBE_BEVEL}),
          ];
          const label = `${cubeDirectionLabel(direction)} edge`;
          zones.push({id: `edge-${cubeZoneId(direction)}`, kind: "edge", label, direction, points});
        }
      }
    }
  }

  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        const direction = {x, y, z};
        const points = [
          {x, y: y * CUBE_BEVEL, z: z * CUBE_BEVEL},
          {x: x * CUBE_BEVEL, y, z: z * CUBE_BEVEL},
          {x: x * CUBE_BEVEL, y: y * CUBE_BEVEL, z},
        ];
        const label = `${cubeDirectionLabel(direction)} corner`;
        zones.push({id: `corner-${cubeZoneId(direction)}`, kind: "corner", label, direction, points});
      }
    }
  }
  return zones;
}

function polygonArea(points) {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);
}

function sortPolygonPoints(points) {
  const center = points.reduce((sum, point) => ({x: sum.x + point.x / points.length, y: sum.y + point.y / points.length}), {x: 0, y: 0});
  return [...points].sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
}

function pointInPolygon(points, x, y) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const currentPoint = points[index];
    const previousPoint = points[previous];
    const crosses = (currentPoint.y > y) !== (previousPoint.y > y)
      && x < (previousPoint.x - currentPoint.x) * (y - currentPoint.y) / (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function viewCubeHitTarget(regions, x, y) {
  for (let index = regions.length - 1; index >= 0; index -= 1) {
    if (pointInPolygon(regions[index].points, x, y)) return regions[index];
  }
  return null;
}

export function renderViewCube(context, {
  width = 124, height = 116, camera = {yaw: -Math.PI / 4, pitch: Math.asin(1 / Math.sqrt(3))}, hoverTarget = null,
} = {}) {
  context.clearRect(0, 0, width, height);
  const center = {x: width * 0.58, y: height * 0.49};
  const scale = Math.min(width, height) * 0.265;
  const regions = viewCubeZones().map((zone) => {
    const normal = rotateForCube(zone.direction, camera);
    const rotatedPoints = zone.points.map((point) => rotateForCube(point, camera));
    const points = sortPolygonPoints(rotatedPoints.map((point) => ({
      x: center.x + point.x * scale,
      y: center.y - point.y * scale,
    })));
    return {
      ...zone,
      points,
      facing: normal.depth / Math.hypot(zone.direction.x, zone.direction.y, zone.direction.z),
      depth: rotatedPoints.reduce((sum, point) => sum + point.depth, 0) / rotatedPoints.length,
      area: polygonArea(points),
    };
  }).filter((zone) => zone.facing > 0.012 && zone.area > 1.5)
    .sort((a, b) => a.depth - b.depth);

  const tones = {
    face: "rgba(40, 117, 126, .94)",
    edge: "rgba(52, 151, 145, .96)",
    corner: "rgba(83, 190, 160, .98)",
  };
  for (const region of regions) {
    context.beginPath();
    region.points.forEach((point, vertexIndex) => {
      if (vertexIndex) context.lineTo(point.x, point.y); else context.moveTo(point.x, point.y);
    });
    context.closePath();
    const hovered = region.id === hoverTarget;
    context.fillStyle = hovered ? "#56e39f" : tones[region.kind];
    context.strokeStyle = hovered ? "#d8fff0" : "rgba(172, 230, 221, .72)";
    context.lineWidth = hovered ? 1.5 : 0.9;
    context.shadowColor = hovered ? "rgba(86, 227, 159, .8)" : "transparent";
    context.shadowBlur = hovered ? 8 : 0;
    context.fill();
    context.stroke();
    context.shadowBlur = 0;

    if (region.kind === "face" && region.area > 260) {
      const labelCenter = region.points.reduce((sum, point) => ({
        x: sum.x + point.x / region.points.length,
        y: sum.y + point.y / region.points.length,
      }), {x: 0, y: 0});
      context.fillStyle = hovered ? "#061411" : "rgba(224, 247, 242, .86)";
      context.font = '700 7px "Cascadia Code", Consolas, monospace';
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(region.label.toUpperCase(), labelCenter.x, labelCenter.y);
    }
  }

  const axisOrigin = {x: 16, y: height - 17};
  const axes = [
    {point: {x: 1, y: 0, z: 0}, label: "Z", color: "#f59e0b"},
    {point: {x: 0, y: 1, z: 0}, label: "X", color: "#56e39f"},
    {point: {x: 0, y: 0, z: 1}, label: "", color: "#38bdf8"},
  ];
  for (const axis of axes) {
    const rotated = rotateForCube(axis.point, camera);
    const end = {x: axisOrigin.x + rotated.x * 16, y: axisOrigin.y - rotated.y * 16};
    context.beginPath();
    context.moveTo(axisOrigin.x, axisOrigin.y);
    context.lineTo(end.x, end.y);
    context.strokeStyle = axis.color;
    context.lineWidth = 1.6;
    context.stroke();
    context.fillStyle = axis.color;
    context.font = '700 8px "Cascadia Code", Consolas, monospace';
    if (axis.label) context.fillText(axis.label, end.x + 2, end.y - 2);
  }
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  return regions;
}

function sceneBounds(segments, stock, xScale, orientationSign) {
  const points = segments.flatMap((segment) => segment.points || []).map((point) => ({
    x: point.z * orientationSign,
    y: point.x * xScale,
  }));
  if (stock?.length) {
    const [stockStart, stockEnd] = stockAxialExtent(stock, orientationSign);
    points.push(
      {x: stockStart, y: -stock.radius},
      {x: stockStart, y: stock.radius},
      {x: stockEnd, y: -stock.radius},
      {x: stockEnd, y: stock.radius},
    );
  }
  if (!points.length) points.push({x: -1, y: -1}, {x: 1, y: 1});
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return {minX, maxX, minY, maxY};
}

function sceneFitPoints(segments, stock, xScale, orientationSign, bounds) {
  const points = segments.flatMap((segment) => segmentWorldPoints(segment, xScale, orientationSign));
  if (stock?.radius && stock?.length) {
    for (const x of stockAxialExtent(stock, orientationSign)) {
      for (const y of [-stock.radius, stock.radius]) {
        for (const z of [-stock.radius, stock.radius]) points.push({x, y, z});
      }
    }
  }
  if (!points.length) points.push({x: bounds.minX, y: 0, z: 0}, {x: bounds.maxX, y: 0, z: 0});
  return points;
}

export function stockAxialExtent(stock, orientationSign = 1) {
  const startZ = Number.isFinite(Number(stock?.startZ))
    ? Number(stock.startZ)
    : Number(stock?.zPositions?.[0] ?? -Number(stock?.length || 0));
  const endZ = Number.isFinite(Number(stock?.materialEndZ))
    ? Number(stock.materialEndZ)
    : Number.isFinite(Number(stock?.endZ))
    ? Number(stock.endZ)
    : Number(stock?.zPositions?.[stock.zPositions.length - 1] ?? 0);
  return [startZ * orientationSign, endZ * orientationSign];
}

export function latheCameraTarget(bounds) {
  return {x: (bounds.minX + bounds.maxX) / 2, y: 0, z: 0};
}

function makeProjector({width, height, segments, stock, xScale, orientationSign, camera}) {
  const bounds = sceneBounds(segments, stock, xScale, orientationSign);
  const axialSpan = Math.max(bounds.maxX - bounds.minX, 1e-9);
  const radialSpan = Math.max(bounds.maxY - bounds.minY, stock?.radius ? stock.radius * 2 : 0, 1e-9);
  const sceneSize = Math.max(axialSpan, radialSpan, 1);
  const center = latheCameraTarget(bounds);
  const projectedFitPoints = sceneFitPoints(segments, stock, xScale, orientationSign, bounds).map((point) => rotateForCube({
    x: point.x - center.x,
    y: point.y,
    z: point.z,
  }, camera));
  const projectedWidth = Math.max(...projectedFitPoints.map((point) => point.x)) - Math.min(...projectedFitPoints.map((point) => point.x));
  const projectedHeight = Math.max(...projectedFitPoints.map((point) => point.y)) - Math.min(...projectedFitPoints.map((point) => point.y));
  const fitScales = [];
  if (projectedWidth > 1e-9) fitScales.push(Math.max(1, width - 70) / projectedWidth);
  if (projectedHeight > 1e-9) fitScales.push(Math.max(1, height - 70) / projectedHeight);
  const baseScale = (fitScales.length ? Math.min(...fitScales) : 1) * 0.9;
  const options = {
    center,
    yaw: camera.yaw,
    pitch: camera.pitch,
    scale: Math.max(0.01, baseScale) * camera.zoom,
    projection: "orthographic",
    perspectiveDistance: sceneSize * 5,
    width,
    height,
    panX: camera.panX,
    panY: camera.panY,
  };
  return {project: (point) => projectModelPoint(point, options), bounds, center, sceneSize};
}

function drawPolyline(context, points, project, {color, width = 1, dash = [], alpha = 1, glow = 0} = {}) {
  if (points.length < 2) return;
  context.beginPath();
  points.forEach((point, index) => {
    const screen = project(point);
    if (index) context.lineTo(screen.x, screen.y); else context.moveTo(screen.x, screen.y);
  });
  context.strokeStyle = color;
  context.lineWidth = width;
  context.globalAlpha = alpha;
  context.setLineDash(dash);
  context.shadowColor = glow ? color : "transparent";
  context.shadowBlur = glow;
  context.stroke();
  context.setLineDash([]);
  context.globalAlpha = 1;
  context.shadowBlur = 0;
}

function stockRings(stock, orientationSign, maximumRings = 70) {
  const contour = stockContourPoints(stock);
  if (!contour.length) return [];
  const step = Math.max(1, Math.ceil(contour.length / maximumRings));
  const rings = [];
  for (let index = 0; index < contour.length; index += step) {
    const point = contour[index];
    rings.push({x: point.z * orientationSign, radius: point.radius});
  }
  const face = contour.at(-1);
  const faceX = face.z * orientationSign;
  if (Math.abs((rings.at(-1)?.x ?? Infinity) - faceX) > 1e-12) rings.push({x: faceX, radius: face.radius});
  else rings[rings.length - 1] = {x: faceX, radius: face.radius};
  return rings;
}

function surfaceFacets(rings, radialSlices, project) {
  const facets = [];
  for (let ringIndex = 1; ringIndex < rings.length; ringIndex += 1) {
    const before = rings[ringIndex - 1];
    const after = rings[ringIndex];
    for (let slice = 0; slice < radialSlices; slice += 1) {
      const angle0 = slice / radialSlices * Math.PI * 2;
      const angle1 = (slice + 1) / radialSlices * Math.PI * 2;
      const world = [
        {x: before.x, y: before.radius * Math.cos(angle0), z: before.radius * Math.sin(angle0)},
        {x: after.x, y: after.radius * Math.cos(angle0), z: after.radius * Math.sin(angle0)},
        {x: after.x, y: after.radius * Math.cos(angle1), z: after.radius * Math.sin(angle1)},
        {x: before.x, y: before.radius * Math.cos(angle1), z: before.radius * Math.sin(angle1)},
      ];
      const screen = world.map(project);
      const averageAngle = (angle0 + angle1) / 2;
      facets.push({
        screen,
        depth: screen.reduce((sum, point) => sum + point.depth, 0) / screen.length,
        light: clamp(0.38 + Math.cos(averageAngle - 0.7) * 0.28 + Math.sin(averageAngle) * 0.12, 0.12, 0.82),
      });
    }
  }
  for (const [endIndex, ring] of [rings[0], rings.at(-1)].entries()) {
    for (let slice = 0; slice < radialSlices; slice += 1) {
      const angle0 = slice / radialSlices * Math.PI * 2;
      const angle1 = (slice + 1) / radialSlices * Math.PI * 2;
      const world = [
        {x: ring.x, y: 0, z: 0},
        {x: ring.x, y: ring.radius * Math.cos(angle0), z: ring.radius * Math.sin(angle0)},
        {x: ring.x, y: ring.radius * Math.cos(angle1), z: ring.radius * Math.sin(angle1)},
      ];
      const screen = world.map(project);
      facets.push({
        screen,
        depth: screen.reduce((sum, point) => sum + point.depth, 0) / screen.length,
        light: endIndex ? 0.62 : 0.45,
        cap: true,
      });
    }
  }
  return facets.sort((a, b) => a.depth - b.depth);
}

function projectedCircleGeometry(axial, radius, project) {
  const center = project({x: axial, y: 0, z: 0});
  const radialY = project({x: axial, y: radius, z: 0});
  const radialZ = project({x: axial, y: 0, z: radius});
  const ux = radialY.x - center.x;
  const uy = radialY.y - center.y;
  const vx = radialZ.x - center.x;
  const vy = radialZ.y - center.y;
  const covarianceX = ux * ux + vx * vx;
  const covarianceXY = ux * uy + vx * vy;
  const covarianceY = uy * uy + vy * vy;
  const trace = covarianceX + covarianceY;
  const discriminant = Math.sqrt(Math.max(0, (covarianceX - covarianceY) ** 2 + 4 * covarianceXY ** 2));
  const majorRadius = Math.sqrt(Math.max(0, (trace + discriminant) / 2));
  const minorRadius = Math.sqrt(Math.max(0, (trace - discriminant) / 2));
  const rotation = 0.5 * Math.atan2(2 * covarianceXY, covarianceX - covarianceY);
  return {center, majorRadius, minorRadius, rotation};
}

function traceProjectedCircle(context, geometry) {
  const {center, majorRadius, minorRadius, rotation} = geometry;
  context.beginPath();
  if (minorRadius < 0.01) {
    context.moveTo(center.x - Math.cos(rotation) * majorRadius, center.y - Math.sin(rotation) * majorRadius);
    context.lineTo(center.x + Math.cos(rotation) * majorRadius, center.y + Math.sin(rotation) * majorRadius);
  } else {
    context.ellipse(center.x, center.y, majorRadius, minorRadius, rotation, 0, Math.PI * 2);
  }
}

function drawProjectedCircle(context, axial, radius, project, {color, width = 1, dash = [], alpha = 1} = {}) {
  traceProjectedCircle(context, projectedCircleGeometry(axial, radius, project));
  context.strokeStyle = color;
  context.lineWidth = width;
  context.globalAlpha = alpha;
  context.setLineDash(dash);
  context.stroke();
  context.setLineDash([]);
  context.globalAlpha = 1;
}

function drawEndStock(context, rings, project, camera) {
  if (!rings.length) return;
  const cameraDirectionX = Math.sin(camera.yaw) * Math.cos(camera.pitch);
  const ordered = cameraDirectionX >= 0 ? rings : [...rings].reverse();
  const count = Math.max(1, ordered.length - 1);
  for (let index = 0; index < ordered.length; index += 1) {
    const ring = ordered[index];
    const depthRatio = index / count;
    traceProjectedCircle(context, projectedCircleGeometry(ring.x, ring.radius, project));
    const green = Math.round(116 + depthRatio * 34);
    const blue = Math.round(132 + depthRatio * 40);
    context.fillStyle = `rgb(32, ${green}, ${blue})`;
    context.fill();
  }

  const maximum = rings.reduce((largest, ring) => ring.radius > largest.radius ? ring : largest, rings[0]);
  const nearest = ordered.at(-1);
  drawProjectedCircle(context, maximum.x, maximum.radius, project, {color: "#6edbd1", width: 1.2, alpha: 0.9});
  if (Math.abs(nearest.radius - maximum.radius) > 1e-9) {
    drawProjectedCircle(context, nearest.x, nearest.radius, project, {color: "rgba(126, 225, 217, .78)", width: 1, alpha: 0.9});
  }
}

function drawCardinalStockSilhouette(context, rings, project, radialAxis) {
  const worldPoint = (ring, sign) => radialAxis === "y"
    ? {x: ring.x, y: sign * ring.radius, z: 0}
    : {x: ring.x, y: 0, z: sign * ring.radius};
  const upper = rings.map((ring) => worldPoint(ring, 1));
  const lower = rings.map((ring) => worldPoint(ring, -1));
  context.beginPath();
  [...upper, ...[...lower].reverse()].forEach((point, index) => {
    const screen = project(point);
    if (index) context.lineTo(screen.x, screen.y); else context.moveTo(screen.x, screen.y);
  });
  context.closePath();
  context.fillStyle = "rgba(38, 146, 161, .58)";
  context.fill();
  drawPolyline(context, upper, project, {color: "#6edbd1", width: 1.15, alpha: 0.82});
  drawPolyline(context, lower, project, {color: "#6edbd1", width: 1.15, alpha: 0.82});
  if (rings.length) {
    drawPolyline(context, [worldPoint(rings[0], 1), worldPoint(rings[0], -1)], project, {color: "#38bdf8", width: 1, alpha: 0.48});
    drawPolyline(context, [worldPoint(rings.at(-1), 1), worldPoint(rings.at(-1), -1)], project, {color: "#38bdf8", width: 1, alpha: 0.48});
  }
}

function drawStockSurface(context, stock, orientationSign, project, camera, quality) {
  if (!stock?.radius || !stock?.length) return;
  const cardinalView = cardinalStockView(camera);
  const rings = stockRings(stock, orientationSign, cardinalView === "front-back" || cardinalView === "top-bottom" ? quality.contourRings : quality.axialRings);
  if (!rings.length) return;
  if (cardinalView === "front-back" || cardinalView === "top-bottom") {
    drawCardinalStockSilhouette(context, rings, project, cardinalView === "front-back" ? "y" : "z");
    return;
  }
  if (cardinalView === "end") {
    drawEndStock(context, rings, project, camera);
    return;
  }

  for (const facet of surfaceFacets(rings, quality.radialSlices, project)) {
    context.beginPath();
    facet.screen.forEach((point, index) => {
      if (index) context.lineTo(point.x, point.y); else context.moveTo(point.x, point.y);
    });
    context.closePath();
    const green = Math.round(105 + facet.light * 55);
    const blue = Math.round(120 + facet.light * 72);
    context.fillStyle = `rgba(38, ${green}, ${blue}, .42)`;
    context.fill();
  }

  const ends = stockAxialExtent(stock, orientationSign);
  const startRadius = rings[0]?.radius ?? stock.radius;
  const endRadius = rings.at(-1)?.radius ?? stock.radius;
  drawProjectedCircle(context, ends[0], startRadius, project, {color: "#38bdf8", width: 1, dash: [4, 4], alpha: 0.42});
  drawProjectedCircle(context, ends[1], endRadius, project, {color: "#38bdf8", width: 1, dash: [4, 4], alpha: 0.42});
  for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    drawPolyline(context, [
      {x: ends[0], y: startRadius * Math.cos(angle), z: startRadius * Math.sin(angle)},
      {x: ends[1], y: endRadius * Math.cos(angle), z: endRadius * Math.sin(angle)},
    ], project, {
      color: "#38bdf8", width: 0.9, dash: [4, 4], alpha: 0.26,
    });
  }
}

function segmentWorldPoints(segment, xScale, orientationSign) {
  return (segment.points || []).map((point) => ({x: point.z * orientationSign, y: point.x * xScale, z: 0}));
}

function drawToolpaths(context, segments, visibleCount, xScale, orientationSign, project) {
  for (const segment of segments) {
    drawPolyline(context, segmentWorldPoints(segment, xScale, orientationSign), project, {
      color: "#64748b", width: 1.1, dash: segment.type === "rapid" ? [6, 5] : [], alpha: 0.28,
    });
  }
  for (const segment of segments.slice(0, visibleCount)) {
    const color = PATH_COLORS[segment.type] || "#94a3b8";
    drawPolyline(context, segmentWorldPoints(segment, xScale, orientationSign), project, {
      color, width: segment.type === "rapid" ? 1.35 : 2.1, dash: segment.type === "rapid" ? [6, 5] : [], alpha: 0.98, glow: 5,
    });
  }
  if (!visibleCount) return;
  const point = segments[Math.min(visibleCount, segments.length) - 1]?.end;
  if (!point) return;
  const marker = project({x: point.z * orientationSign, y: point.x * xScale, z: 0});
  context.fillStyle = "#ffffff";
  context.shadowColor = "#56e39f";
  context.shadowBlur = 10;
  context.beginPath();
  context.arc(marker.x, marker.y, 3.5, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
}

function drawAxes(context, project, bounds, stockRadius) {
  const length = Math.max(bounds.maxX - bounds.minX, 1);
  const radius = Math.max(stockRadius || 0, Math.abs(bounds.minY), Math.abs(bounds.maxY), length * 0.08);
  const origin = {x: 0, y: 0, z: 0};
  drawPolyline(context, [{x: bounds.minX - length * 0.05, y: 0, z: 0}, {x: bounds.maxX + length * 0.05, y: 0, z: 0}], project, {color: "#91a6ab", width: 1, alpha: 0.48});
  drawPolyline(context, [origin, {x: 0, y: radius * 1.25, z: 0}], project, {color: "#56e39f", width: 1.2, alpha: 0.7});
  const zLabel = project({x: bounds.maxX + length * 0.08, y: 0, z: 0});
  const xLabel = project({x: 0, y: radius * 1.35, z: 0});
  context.fillStyle = "rgba(180, 205, 208, .78)";
  context.font = '9px "Cascadia Code", Consolas, monospace';
  context.fillText("Z", zLabel.x, zLabel.y);
  context.fillStyle = "#56e39f";
  context.fillText("X", xLabel.x, xLabel.y);
}

export function renderLathe3d(context, {
  width, height, segments = [], visibleCount = 0, stock = null,
  xScale = 0.5, orientationSign = 1,
  showToolpaths = true,
  camera = {yaw: -Math.PI / 4, pitch: Math.asin(1 / Math.sqrt(3)), zoom: 1, panX: 0, panY: 0},
  quality = {contourRings: 720, axialRings: 320, radialSlices: 128},
} = {}) {
  context.clearRect(0, 0, width, height);
  const gradient = context.createRadialGradient(width * 0.5, height * 0.45, 0, width * 0.5, height * 0.45, Math.max(width, height) * 0.7);
  gradient.addColorStop(0, "#0c2021");
  gradient.addColorStop(1, "#061012");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const scene = makeProjector({width, height, segments, stock, xScale, orientationSign, camera});
  drawAxes(context, scene.project, scene.bounds, stock?.radius);
  drawStockSurface(context, stock, orientationSign, scene.project, camera, quality);
  if (showToolpaths) drawToolpaths(context, segments, Math.min(visibleCount, segments.length), xScale, orientationSign, scene.project);

  context.fillStyle = "rgba(145, 166, 171, .66)";
  context.font = '9px "Cascadia Code", Consolas, monospace';
  context.textAlign = "right";
  context.fillText("MIDDLE-DRAG ORBIT · LEFT-DRAG PAN · WHEEL ZOOM", width - 14, height - 14);
  context.textAlign = "left";
  return {hitPaths: []};
}
