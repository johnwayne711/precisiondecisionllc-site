const EPSILON = 1e-9;

export function lineGeometry({id, component, label, start, end, metadata = {}}) {
  return {
    id,
    component,
    label,
    type: "line",
    start: {z: Number(start.z), x: Number(start.x)},
    end: {z: Number(end.z), x: Number(end.x)},
    metadata,
  };
}

export function arcGeometry({id, component, label, center, radius, startAngle, sweep, metadata = {}}) {
  const entity = {
    id,
    component,
    label,
    type: "arc",
    center: {z: Number(center.z), x: Number(center.x)},
    radius: Math.abs(Number(radius)),
    startAngle: Number(startAngle),
    sweep: Number(sweep),
    metadata,
  };
  entity.start = geometryPointAt(entity, 0);
  entity.end = geometryPointAt(entity, 1);
  return entity;
}

export function motionGeometry({segment, id, component, label, xScale = 1, metadata = {}}) {
  const sourceMotion = segment.sourceMotion || segment.type;
  const start = {z: segment.start.z, x: segment.start.x * xScale};
  const end = {z: segment.end.z, x: segment.end.x * xScale};
  if ((sourceMotion === "arc-cw" || sourceMotion === "arc-ccw")
    && segment.center && Number.isFinite(segment.radius) && segment.radius > 0 && Number.isFinite(segment.sweep)) {
    const center = {z: segment.center.z, x: segment.center.x};
    return arcGeometry({
      id,
      component,
      label,
      center,
      radius: segment.radius,
      startAngle: Math.atan2(start.x - center.x, start.z - center.z),
      sweep: segment.sweep,
      metadata,
    });
  }
  if (sourceMotion === "linear" && segment.type !== "rapid") {
    return lineGeometry({id, component, label, start, end, metadata});
  }
  return null;
}

export function rectangleGeometry({id, component, minZ, maxZ, minX, maxX}) {
  const corners = {
    backBottom: {z: minZ, x: minX},
    backTop: {z: minZ, x: maxX},
    frontTop: {z: maxZ, x: maxX},
    frontBottom: {z: maxZ, x: minX},
  };
  return [
    lineGeometry({id: `${id}-back`, component, label: "Back face", start: corners.backBottom, end: corners.backTop}),
    lineGeometry({id: `${id}-top`, component, label: "Top edge", start: corners.backTop, end: corners.frontTop}),
    lineGeometry({id: `${id}-front`, component, label: "Front face", start: corners.frontTop, end: corners.frontBottom}),
    lineGeometry({id: `${id}-bottom`, component, label: "Bottom edge", start: corners.frontBottom, end: corners.backBottom}),
  ];
}

export function simplifyCollinear(points, tolerance = 1e-7) {
  if (points.length < 3) return points.map((point) => ({...point}));
  const simplified = [{...points[0]}];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified.at(-1);
    const current = points[index];
    const next = points[index + 1];
    const firstZ = current.z - previous.z;
    const firstX = current.x - previous.x;
    const secondZ = next.z - current.z;
    const secondX = next.x - current.x;
    const cross = firstZ * secondX - firstX * secondZ;
    const scale = Math.max(1, Math.hypot(firstZ, firstX) * Math.hypot(secondZ, secondX));
    if (Math.abs(cross) > tolerance * scale) simplified.push({...current});
  }
  simplified.push({...points.at(-1)});
  return simplified;
}

export function polylineGeometry({id, component, label, points, metadata = {}}) {
  const simplified = simplifyCollinear(points);
  const lines = [];
  for (let index = 1; index < simplified.length; index += 1) {
    const start = simplified[index - 1];
    const end = simplified[index];
    if (Math.hypot(end.z - start.z, end.x - start.x) <= EPSILON) continue;
    lines.push(lineGeometry({
      id: `${id}-${index}`,
      component,
      label,
      start,
      end,
      metadata: {...metadata, polylineId: id, segmentIndex: index - 1},
    }));
  }
  return lines;
}

export function lineMeasurement(entity) {
  const deltaZ = entity.end.z - entity.start.z;
  const deltaX = entity.end.x - entity.start.x;
  return {
    length: Math.hypot(deltaZ, deltaX),
    deltaZ,
    deltaX,
    midpoint: {
      z: (entity.start.z + entity.end.z) / 2,
      x: (entity.start.x + entity.end.x) / 2,
    },
  };
}

export function geometryPointAt(entity, fraction) {
  const amount = Math.max(0, Math.min(1, Number(fraction) || 0));
  if (entity.type === "arc") {
    const angle = entity.startAngle + entity.sweep * amount;
    return {
      z: entity.center.z + Math.cos(angle) * entity.radius,
      x: entity.center.x + Math.sin(angle) * entity.radius,
    };
  }
  return {
    z: entity.start.z + (entity.end.z - entity.start.z) * amount,
    x: entity.start.x + (entity.end.x - entity.start.x) * amount,
  };
}

export function geometryMeasurement(entity) {
  if (entity.type === "arc") {
    return {
      radius: entity.radius,
      arcLength: Math.abs(entity.sweep) * entity.radius,
      center: {...entity.center},
      midpoint: geometryPointAt(entity, 0.5),
      start: {...entity.start},
      end: {...entity.end},
    };
  }
  return {...lineMeasurement(entity), center: null, start: {...entity.start}, end: {...entity.end}};
}

export function geometrySampleSegmentCount(entity, maximumSegments = 96) {
  if (entity.type !== "arc") return 1;
  return Math.max(8, Math.min(maximumSegments, Math.ceil(Math.abs(entity.sweep) / (Math.PI / 48))));
}

export function geometrySamplePointCount(entity, maximumSegments = 96) {
  return geometrySampleSegmentCount(entity, maximumSegments) + 1;
}

export function sampleGeometryEntity(entity, maximumSegments = 96) {
  if (entity.type !== "arc") return [{...entity.start}, {...entity.end}];
  const count = geometrySampleSegmentCount(entity, maximumSegments);
  return Array.from({length: count + 1}, (_, index) => geometryPointAt(entity, index / count));
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function nearestPointOnScreenLine(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const denominator = dx * dx + dy * dy;
  const fraction = denominator <= EPSILON
    ? 0
    : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator));
  return {x: start.x + fraction * dx, y: start.y + fraction * dy, fraction};
}

function projectedEntity(entity, project) {
  const points = sampleGeometryEntity(entity).map(project);
  return {
    entity,
    points,
    start: points[0],
    end: points.at(-1),
    midpoint: project(geometryPointAt(entity, 0.5)),
  };
}

function inspectionPriority(entity) {
  if (entity.type === "arc" && entity.metadata?.exact) return 0;
  if (entity.metadata?.exact) return 1;
  if (entity.metadata?.sampledContour) return 3;
  return 2;
}

export function geometryHitAt(entities, project, screenPoint, {snapRadius = 9, lineRadius = 7} = {}) {
  const projected = entities.map((entity) => projectedEntity(entity, project));
  let bestSnap = null;
  for (const item of projected) {
    const candidates = item.entity.metadata?.sampledContour ? [] : [
      {kind: "corner", point: item.start, modelPoint: item.entity.start, fraction: 0},
      {kind: "corner", point: item.end, modelPoint: item.entity.end, fraction: 1},
      {kind: "midpoint", point: item.midpoint, modelPoint: geometryPointAt(item.entity, 0.5), fraction: 0.5},
    ];
    for (const candidate of candidates) {
      const candidateDistance = distance(screenPoint, candidate.point);
      if (candidateDistance > snapRadius || (bestSnap && bestSnap.distance <= candidateDistance)) continue;
      bestSnap = {...candidate, entity: item.entity, screenPoint: candidate.point, distance: candidateDistance};
    }
  }
  if (bestSnap) return bestSnap;

  let bestLine = null;
  for (const item of projected) {
    for (let index = 1; index < item.points.length; index += 1) {
      const nearest = nearestPointOnScreenLine(screenPoint, item.points[index - 1], item.points[index]);
      const candidateDistance = distance(screenPoint, nearest);
      const localFraction = (index - 1 + nearest.fraction) / (item.points.length - 1);
      const candidatePriority = inspectionPriority(item.entity);
      const currentPriority = bestLine ? inspectionPriority(bestLine.entity) : Number.POSITIVE_INFINITY;
      const meaningfullyCloser = !bestLine || candidateDistance < bestLine.distance - 0.75;
      const higherPriority = bestLine && candidatePriority < currentPriority;
      const samePriorityButCloser = bestLine && candidatePriority === currentPriority && candidateDistance < bestLine.distance;
      if (candidateDistance > lineRadius || (!meaningfullyCloser && !higherPriority && !samePriorityButCloser)) continue;
      if (bestLine && candidatePriority > currentPriority) continue;
      bestLine = {
        kind: item.entity.type === "arc" ? "arc" : "line",
        entity: item.entity,
        modelPoint: geometryPointAt(item.entity, localFraction),
        screenPoint: {x: nearest.x, y: nearest.y},
        fraction: localFraction,
        distance: candidateDistance,
      };
    }
  }
  return bestLine;
}
