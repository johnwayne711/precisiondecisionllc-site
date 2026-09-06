/**
 * Orthographic STEP setup preview. All triangles, hit tests and sampled section
 * strokes in this module are DISPLAY ONLY. Picking returns a kernel face ID;
 * dimensions, setup coordinates and comparisons must use the analytic DTO.
 */
import {createSolidNavigation, SOLID_NAVIGATION_HELP} from "./solid-navigation.mjs";
import {createSolidMeshRenderer} from "./solid-mesh-renderer.mjs";

export const SOLID_PREVIEW_LIMITS = Object.freeze({maxFaces: 4096, maxTriangles: 100000, maxSectionEdges: 512, maxSectionPoints: 16384});

const AXES = ["x", "y", "z"];
const PLANES = [{axis: "z", label: "XY", color: "#78baff"}, {axis: "y", label: "XZ", color: "#c3a0fb"}, {axis: "x", label: "YZ", color: "#ffa987"}];
const VIEWS = {iso: [-Math.PI / 4, Math.asin(1 / Math.sqrt(3))], xy: [0, Math.PI / 2], xz: [0, 0], yz: [Math.PI / 2, 0]};
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finitePoint = (point) => AXES.every((axis) => Number.isFinite(point?.[axis]) && Math.abs(point[axis]) <= 1e12);
const subtract = (a, b) => ({x: a.x - b.x, y: a.y - b.y, z: a.z - b.z});
const cross = (a, b) => ({x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x});
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const vectorLength = (a) => Math.hypot(a.x, a.y, a.z);
const unit = (a) => { const length = vectorLength(a); return length > 0 ? {x: a.x / length, y: a.y / length, z: a.z / length} : {x: 0, y: 0, z: 1}; };

/** Preflight the ENTIRE display payload before allocating projected triangles. */
export function validateSolidPreviewModel(model) {
  if (model?.schemaVersion !== 1 || model?.displayOnly !== true) return {ok: false, reason: "Solid display data is unavailable."};
  if (!finitePoint(model.bounds?.min) || !finitePoint(model.bounds?.max)
    || AXES.some((axis) => model.bounds.min[axis] > model.bounds.max[axis])) return {ok: false, reason: "Solid display bounds are invalid."};
  if (!Array.isArray(model.faces) || !model.faces.length || model.faces.length > SOLID_PREVIEW_LIMITS.maxFaces) return {ok: false, reason: "Solid display exceeds its face limit or has no faces."};
  let triangleCount = 0;
  const ids = new Set();
  for (const face of model.faces) {
    if (typeof face?.id !== "string" || !face.id || ids.has(face.id)) return {ok: false, reason: "Solid display face identities are invalid."};
    ids.add(face.id);
    const values = face.triangles;
    if ((!Array.isArray(values) && !ArrayBuffer.isView(values)) || !Number.isSafeInteger(values.length) || values.length === 0 || values.length % 9 !== 0) return {ok: false, reason: "Solid display triangles are invalid."};
    triangleCount += values.length / 9;
    if (triangleCount > SOLID_PREVIEW_LIMITS.maxTriangles) return {ok: false, reason: "Solid display exceeds its triangle limit."};
  }
  if (!triangleCount) return {ok: false, reason: "No solid display triangles are available."};
  for (const face of model.faces) {
    for (const value of face.triangles) if (!Number.isFinite(value) || Math.abs(value) > 1e12) return {ok: false, reason: "Solid display contains invalid coordinates."};
  }
  return {ok: true, triangleCount};
}

/** Camera projection only; never a conversion into program coordinates. */
export function solidPreviewProjector({center = {x: 0, y: 0, z: 0}, yaw = VIEWS.iso[0], pitch = VIEWS.iso[1], scale = 1, width = 1, height = 1, panX = 0, panY = 0} = {}) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  return (point) => {
    const p = subtract(point, center);
    return {x: width / 2 + panX + (p.x * cy + p.y * sy) * scale, y: height / 2 + panY - (-p.x * sy * sp + p.y * cy * sp + p.z * cp) * scale, depth: p.x * sy * cp - p.y * cy * cp + p.z * sp};
  };
}

/** Pick the nearest projected triangle, not its average-depth painter order. */
export function pickSolidPreviewFace(triangles, point) {
  return pickSolidPreviewHit(triangles, point)?.faceId ?? null;
}

function pickSolidPreviewHit(triangles, point) {
  let result = null;
  let nearestDepth = -Infinity;
  for (const triangle of triangles) {
    const [a, b, c] = triangle.points;
    if (triangle.screenBounds && (point.x < triangle.screenBounds.minX || point.x > triangle.screenBounds.maxX
      || point.y < triangle.screenBounds.minY || point.y > triangle.screenBounds.maxY)) continue;
    const determinant = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(determinant) < 1e-9) continue;
    const u = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / determinant;
    const v = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / determinant;
    const w = 1 - u - v;
    if (Math.min(u, v, w) < -1e-8) continue;
    const depth = u * a.depth + v * b.depth + w * c.depth;
    if (depth > nearestDepth) {
      nearestDepth = depth;
      // Interpolation is for camera centering only; setup still receives the analytic face ID.
      const world = triangle.worldPoints;
      result = {faceId: triangle.faceId, point: world ? Object.fromEntries(AXES.map(axis =>
        [axis, u * world[0][axis] + v * world[1][axis] + w * world[2][axis]])) : null};
    }
  }
  return result;
}

/** Bounded visualization of exact section primitives; no tolerancing claim. */
export function solidPreviewSectionStrokes(dto) {
  if (!dto) return [];
  const section = dto.section || dto;
  const contours = section.contours;
  if (!Array.isArray(contours) || contours.length > SOLID_PREVIEW_LIMITS.maxSectionEdges) return [];
  let edgeCount = 0;
  for (const contour of contours) {
    if (!Array.isArray(contour?.edges)) return [];
    edgeCount += contour.edges.length;
    if (edgeCount > SOLID_PREVIEW_LIMITS.maxSectionEdges) return [];
  }
  const strokes = [];
  let pointsUsed = 0;
  for (const contour of contours) for (const edge of contour.edges) {
    if (!edge || typeof edge !== "object") return [];
    let points;
    if (edge.curveType === "GeomAbs_Line" || edge.curveType === 0 || edge.kind === "line") {
      if (!finitePoint(edge.start) || !finitePoint(edge.end)) return [];
      points = [{...edge.start}, {...edge.end}];
    } else if (edge.curveType === "GeomAbs_Circle" || edge.curveType === 1 || edge.kind === "circle") {
      const first = edge.parameters?.start;
      const last = edge.parameters?.end;
      if (!finitePoint(edge.center) || !finitePoint(edge.normal) || !finitePoint(edge.xDirection)
        || !Number.isFinite(edge.radiusMm) || edge.radiusMm <= 0 || !Number.isFinite(first) || !Number.isFinite(last)
        || Math.abs(last - first) > 2 * Math.PI + 1e-8) return [];
      const normal = unit(edge.normal), x = unit(edge.xDirection), y = cross(normal, x);
      if (Math.abs(dot(normal, x)) > 1e-6 || vectorLength(edge.normal) < 1e-12 || vectorLength(edge.xDirection) < 1e-12) return [];
      const count = Math.max(8, Math.ceil(Math.abs(last - first) / (Math.PI / 64)));
      points = Array.from({length: count + 1}, (_, index) => {
        const angle = first + (last - first) * index / count;
        const cosine = Math.cos(angle) * edge.radiusMm, sine = Math.sin(angle) * edge.radiusMm;
        return {x: edge.center.x + x.x * cosine + y.x * sine, y: edge.center.y + x.y * cosine + y.y * sine, z: edge.center.z + x.z * cosine + y.z * sine};
      });
      if (!points.every(finitePoint)) return [];
    } else return [];
    pointsUsed += points.length;
    if (pointsUsed > SOLID_PREVIEW_LIMITS.maxSectionPoints) return [];
    strokes.push({contourId: contour.id, points});
  }
  return strokes;
}

/**
 * Convert an already-authorized canonical lathe profile back into model space
 * for display over the solid. This is a one-way visualization only: the
 * original analytic profile remains the dimensional authority.
 */
export function solidPreviewMappedProfileStrokes(mapped, mapping) {
  const primitives = mapped?.authorized === true && Array.isArray(mapped.primitives) ? mapped.primitives : [];
  const axes = [mapping?.axialAxis, mapping?.radialAxis, mapping?.normalAxis];
  if (primitives.length > SOLID_PREVIEW_LIMITS.maxSectionEdges
    || new Set(axes).size !== 3 || axes.some((axis) => !AXES.includes(axis))
    || ![mapping?.planeOffsetMm, mapping?.axialOriginMm, mapping?.radialOriginMm].every(Number.isFinite)
    || ![mapping?.axialDirection, mapping?.radialDirection].every((value) => value === 1 || value === -1)) return [];
  const modelPoint = (point) => ({
    [mapping.normalAxis]: mapping.planeOffsetMm,
    [mapping.axialAxis]: mapping.axialOriginMm + point.z / mapping.axialDirection,
    [mapping.radialAxis]: mapping.radialOriginMm + point.x / mapping.radialDirection,
  });
  const strokes = [];
  let pointCount = 0;
  for (const primitive of primitives) {
    let points = [];
    if (primitive?.type === "line" && Number.isFinite(primitive.start?.z) && Number.isFinite(primitive.start?.x)
      && Number.isFinite(primitive.end?.z) && Number.isFinite(primitive.end?.x)) {
      points = [modelPoint(primitive.start), modelPoint(primitive.end)];
    } else if ((primitive?.type === "arc" || primitive?.type === "circle")
      && Number.isFinite(primitive.center?.z) && Number.isFinite(primitive.center?.x)
      && Number.isFinite(primitive.radius) && primitive.radius > 0) {
      const startAngle = primitive.type === "circle" ? 0 : primitive.startAngle;
      const sweep = primitive.type === "circle" ? Math.PI * 2 : primitive.sweep;
      if (!Number.isFinite(startAngle) || !Number.isFinite(sweep) || sweep === 0 || Math.abs(sweep) > Math.PI * 2 + 1e-12) return [];
      const segments = Math.max(2, Math.min(128, Math.ceil(Math.abs(sweep) / (Math.PI / 32))));
      points = Array.from({length: segments + 1}, (_, index) => {
        const angle = startAngle + sweep * index / segments;
        return modelPoint({z: primitive.center.z + Math.cos(angle) * primitive.radius, x: primitive.center.x + Math.sin(angle) * primitive.radius});
      });
    } else return [];
    pointCount += points.length;
    if (pointCount > SOLID_PREVIEW_LIMITS.maxSectionPoints || points.some((point) => !finitePoint(point))) return [];
    strokes.push({points});
  }
  return strokes;
}

function displayTriangles(model) {
  const result = [];
  for (const face of model.faces) {
    const triangles = [];
    const edgeCounts = new Map();
    const key = (point) => `${point.x},${point.y},${point.z}`;
    for (let i = 0; i < face.triangles.length; i += 9) {
      const points = [0, 3, 6].map((j) => ({x: face.triangles[i + j], y: face.triangles[i + j + 1], z: face.triangles[i + j + 2]}));
      const edgeKeys = points.map((point, j) => [key(point), key(points[(j + 1) % 3])].sort().join("|"));
      for (const edge of edgeKeys) edgeCounts.set(edge, (edgeCounts.get(edge) || 0) + 1);
      triangles.push({faceId: face.id, points, edgeKeys, normal: unit(cross(subtract(points[1], points[0]), subtract(points[2], points[0])))});
    }
    for (const triangle of triangles) {
      triangle.boundary = triangle.edgeKeys.map((key) => edgeCounts.get(key) === 1);
      delete triangle.edgeKeys;
      result.push(triangle);
    }
  }
  return result;
}

export function createSolidPreview(canvas, {onFacePick = () => {}, onPlanePick = () => {}} = {}) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Solid preview requires a canvas 2D context.");
  let model = null, triangles = [], projected = [], sectionStrokes = [], selection = {}, plane = null, displayUnits = "mm";
  let message = "Import a STEP solid to begin", destroyed = false, pending = null;
  let width = 1, height = 1, projectionKey = null, project = null;
  let center = {x: 0, y: 0, z: 0}, span = 1, labels = [], hoverFace = null;
  let hoverPoint = null, redrawRequested = false;
  const pointers = new Map();
  let gesture = null;
  const originalTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = "none";
  if (!canvas.hasAttribute("tabindex")) canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `STEP solid setup preview. ${SOLID_NAVIGATION_HELP}. Left click selects. Ctrl-left-drag rotates; Shift-left-drag pans. Touch: one finger rotates, two fingers pan and pinch. Arrow keys rotate; plus/minus zoom; F fits; 1 is isometric, 2 XY, 3 XZ, 4 YZ.`);
  canvas.title = SOLID_NAVIGATION_HELP;
  const requestFrame = globalThis.requestAnimationFrame?.bind(globalThis) || ((callback) => setTimeout(callback, 0));
  const cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) || clearTimeout;
  const navigation = createSolidNavigation(canvas, schedule);
  const meshRenderer = createSolidMeshRenderer(canvas, schedule);
  function hit(point) {
    if (meshRenderer?.available()) return meshRenderer.pick(point, width, height, navigation.camera);
    return pickSolidPreviewHit(projected, point);
  }
  function schedule(hoverOnly = false) {
    if (destroyed) return;
    if (hoverOnly !== true) redrawRequested = true;
    if (pending === null) pending = requestFrame(() => {
      pending = null;
      updateProjection();
      if (hoverPoint) {
        const nextHover = hit(hoverPoint)?.faceId ?? null;
        if (nextHover !== hoverFace) { hoverFace = nextHover; redrawRequested = true; }
      }
      if (redrawRequested) { redrawRequested = false; render(); }
    });
  }
  function path(points, close = false) { ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); if (close) ctx.closePath(); }
  function text(textValue, x, y, color = "#b9ccd9") { ctx.fillStyle = color; ctx.fillText(textValue, x, y); }
  function formatCoordinate(mm) {
    const inch = displayUnits === "inch";
    return `${(mm / (inch ? 25.4 : 1)).toFixed(inch ? 5 : 4)} ${inch ? "in" : "mm"}`;
  }
  function planePoints(axis, offset) {
    const other = AXES.filter((item) => item !== axis), padding = span * 0.16;
    return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([a, b]) => ({[axis]: offset,
      [other[0]]: model.bounds[a ? "max" : "min"][other[0]] + (a ? padding : -padding),
      [other[1]]: model.bounds[b ? "max" : "min"][other[1]] + (b ? padding : -padding)}));
  }
  function renderPlane(project, axis, offset, color, selected = false) {
    path(planePoints(axis, offset).map(project), true);
    ctx.fillStyle = color; ctx.globalAlpha = selected ? 0.09 : 0.035; ctx.fill();
    ctx.globalAlpha = selected ? 0.85 : 0.38; ctx.strokeStyle = color; ctx.lineWidth = selected ? 1.5 : 1; ctx.setLineDash(selected ? [7, 4] : [3, 5]); ctx.stroke();
    ctx.globalAlpha = 1; ctx.setLineDash([]);
  }
  function updateProjection() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    navigation.resize(width, height);
    if (!model) { projected = []; project = null; return; }
    project = navigation.projector();
    const nextKey = JSON.stringify([width, height, navigation.snapshot(), !!meshRenderer?.available()]);
    if (nextKey === projectionKey) return;
    projectionKey = nextKey;
    // The GPU handles triangle visibility/depth during navigation. CPU projection
    // is retained only for browsers without WebGL or after context loss.
    if (meshRenderer?.available()) { projected = []; return; }
    projected = [];
    for (const triangle of triangles) {
      const points = triangle.points.map(project), [a, b, c] = points;
      if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) >= -1e-9) continue;
      projected.push({...triangle, points, worldPoints: triangle.points, depth: a.depth + b.depth + c.depth,
        screenBounds: {minX: Math.min(a.x, b.x, c.x), maxX: Math.max(a.x, b.x, c.x), minY: Math.min(a.y, b.y, c.y), maxY: Math.max(a.y, b.y, c.y)}});
    }
    projected.sort((a, b) => a.depth - b.depth);
  }
  function render() {
    if (destroyed) return;
    const pixelRatio = clamp(globalThis.devicePixelRatio || 1, 1, 2);
    const pixelWidth = Math.round(width * pixelRatio), pixelHeight = Math.round(height * pixelRatio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!meshRenderer?.available()) { ctx.fillStyle = "#08171c"; ctx.fillRect(0, 0, width, height); }
    ctx.font = '11px "Segoe UI", sans-serif'; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    labels = [];
    if (!model) { ctx.textAlign = "center"; text(message, width / 2, height / 2); ctx.textAlign = "left"; return; }
    meshRenderer?.render(navigation.camera, width, height, selection.faceId, hoverFace);
    for (const entry of PLANES) renderPlane(project, entry.axis, 0, entry.color);
    for (const triangle of projected) {
      const active = triangle.faceId === selection.faceId, hovered = triangle.faceId === hoverFace;
      const light = 0.53 + 0.47 * Math.abs(dot(triangle.normal, {x: -0.3, y: -0.4, z: 0.866}));
      const color = active ? `rgb(${Math.round(55 * light)},${Math.round(214 * light)},${Math.round(173 * light)})` : hovered ? `rgb(${Math.round(138 * light)},${Math.round(195 * light)},${Math.round(222 * light)})` : `rgb(${Math.round(137 * light)},${Math.round(163 * light)},${Math.round(182 * light)})`;
      path(triangle.points, true); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 0.65; ctx.stroke();
      ctx.strokeStyle = active ? "#97f9d5" : "#28434f"; ctx.lineWidth = active ? 1.4 : 0.8;
      triangle.boundary.forEach((boundary, i) => { if (boundary) { path([triangle.points[i], triangle.points[(i + 1) % 3]]); ctx.stroke(); } });
    }
    if (plane) renderPlane(project, plane.normalAxis, plane.offsetMm, "#68ecc4", true);
    if (AXES.includes(selection.axis)) {
      const origin = finitePoint(selection.origin) ? selection.origin : {x: 0, y: 0, z: 0};
      const start = {...origin, [selection.axis]: model.bounds.min[selection.axis] - span * 0.25};
      const end = {...origin, [selection.axis]: model.bounds.max[selection.axis] + span * 0.25};
      path([project(start), project(end)]); ctx.strokeStyle = "#f6cd72"; ctx.lineWidth = 1.5; ctx.setLineDash([10, 4, 2, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const stroke of sectionStrokes) {
      const points = stroke.points.map(project); path(points); ctx.strokeStyle = "#091b1c"; ctx.lineWidth = 5; ctx.stroke();
      path(points); ctx.strokeStyle = "#69f3c7"; ctx.lineWidth = 2.5; ctx.stroke();
    }
    if (finitePoint(selection.origin)) { const origin = project(selection.origin); ctx.strokeStyle = "#f6cd72"; ctx.lineWidth = 2; path([{x: origin.x - 6, y: origin.y}, {x: origin.x + 6, y: origin.y}]); ctx.stroke(); path([{x: origin.x, y: origin.y - 6}, {x: origin.x, y: origin.y + 6}]); ctx.stroke(); }
    // Fixed labels stay usable even when the source origin is far from the part.
    PLANES.forEach((entry, i) => {
      const x = 14 + i * 62, y = 14, active = plane?.normalAxis === entry.axis;
      ctx.fillStyle = active ? "#164538" : "#142a34"; ctx.fillRect(x, y, 54, 28); ctx.strokeStyle = active ? "#68ecc4" : "#345260"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, 53, 27);
      text(entry.label, x + 17, y + 14, active ? "#92ffda" : entry.color); labels.push({x, y, width: 54, height: 28, axis: entry.axis});
    });
    text("REFERENCE PLANES", 15, 54, "#819ca9");
    const triadProject = navigation.projector({directionOnly: true, scale: 31});
    const triadOrigin = {x: width - 51, y: height - 53};
    AXES.forEach((axis, i) => {
      const end = triadProject({x: 0, y: 0, z: 0, [axis]: 1}); const point = {x: triadOrigin.x + end.x, y: triadOrigin.y + end.y};
      path([triadOrigin, point]); ctx.strokeStyle = ["#ffa987", "#9fd895", "#8ebdff"][i]; ctx.lineWidth = 2; ctx.stroke(); text(axis.toUpperCase(), point.x + 4, point.y - 4, ctx.strokeStyle);
    });
    text(width < 350 ? "MMB rotate · Ctrl+MMB pan · Wheel zoom" : "Middle-drag rotate · Ctrl+middle pan · Shift+middle zoom", 14, height - 47, "#b9ccd9");
    text("Click selects · Double-click face to center · F fits", 14, height - 31, "#b9ccd9");
    text("Display mesh only · Exact CAD used for setup", 14, height - 13, "#718e9c");
    if (plane) text(`${PLANES.find((entry) => entry.axis === plane.normalAxis).label} section · ${plane.normalAxis.toUpperCase()} = ${formatCoordinate(plane.offsetMm)}`, 15, 73, "#79eec8");
  }
  function local(event) { const rect = canvas.getBoundingClientRect(); return {x: event.clientX - rect.left, y: event.clientY - rect.top}; }
  function down(event) {
    if (![0, 1].includes(event.button) && event.pointerType !== "touch") return;
    if (pointers.size >= 2) return;
    event.preventDefault?.(); canvas.focus({preventScroll: true});
    canvas.setPointerCapture?.(event.pointerId);
    const point = local(event); pointers.set(event.pointerId, point);
    hoverPoint = null;
    if (hoverFace !== null) { hoverFace = null; schedule(); }
    gesture = pointers.size > 1 ? {moved: true, canPick: false}
      : {start: point, moved: false, canPick: event.button === 0 && !event.ctrlKey && !event.shiftKey && !event.metaKey};
  }
  function move(event) {
    const point = local(event);
    if (!pointers.has(event.pointerId)) {
      if (!pointers.size && event.pointerType !== "touch") { hoverPoint = point; schedule(true); }
      return;
    }
    pointers.set(event.pointerId, point);
    if (pointers.size > 1 || !gesture.start || Math.hypot(point.x-gesture.start.x, point.y-gesture.start.y) > 4) gesture.moved = true;
    if (event.ctrlKey || event.shiftKey || event.metaKey) gesture.canPick = false;
  }
  function up(event, cancelled = false) {
    const point = local(event); const wasActive = pointers.has(event.pointerId);
    if (!wasActive) return;
    pointers.delete(event.pointerId);
    if (!cancelled && gesture?.canPick && !gesture.moved && pointers.size === 0
      && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) <= 4) {
      updateProjection();
      const label = labels.find((item) => point.x >= item.x && point.x <= item.x + item.width && point.y >= item.y && point.y <= item.y + item.height);
      if (label) onPlanePick(label.axis);
      else { const picked = hit(point); if (picked) onFacePick(picked.faceId); }
    }
    if (pointers.size === 0) gesture = null;
    else { const remaining = [...pointers.values()][0]; gesture = {start: remaining, moved: true, canPick: false}; }
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  function key(event) { navigation.key(event); }
  function doubleClick(event) {
    if (event.button !== 0 || event.ctrlKey || event.shiftKey) return;
    updateProjection();
    const picked = hit(local(event));
    if (picked?.point) { navigation.focus(picked.point); event.preventDefault(); }
  }
  function leave() { hoverPoint = null; if (!pointers.size && hoverFace !== null) { hoverFace = null; schedule(); } }
  const cancel = (event) => { if (pointers.has(event.pointerId)) { up(event, true); navigation.cancel(); } };
  const blur = () => { pointers.clear(); gesture = null; leave(); };
  globalThis.window.addEventListener("blur", blur);
  const events = {pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel, lostpointercapture: cancel, pointerleave: leave, keydown: key, dblclick: doubleClick};
  for (const [event, handler] of Object.entries(events)) canvas.addEventListener(event, handler, event === "wheel" ? {passive: false} : undefined);
  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
  observer?.observe(canvas); globalThis.addEventListener?.("resize", schedule);
  schedule();
  return {
    setModel(dto) {
      const validation = validateSolidPreviewModel(dto); model = null; triangles = []; projected = []; sectionStrokes = []; selection = {}; plane = null; hoverFace = null; hoverPoint = null; projectionKey = null; labels = [];
      pointers.clear(); gesture = null;
      message = dto === null ? "Import a STEP solid to begin" : validation.reason;
      if (validation.ok) {
        model = dto; triangles = displayTriangles(dto);
        center = Object.fromEntries(AXES.map((axis) => [axis, (dto.bounds.min[axis] + dto.bounds.max[axis]) / 2]));
        span = Math.max(1e-9, ...AXES.map((axis) => dto.bounds.max[axis] - dto.bounds.min[axis]));
      }
      meshRenderer?.setModel(triangles, center);
      navigation.setBounds(model?.bounds ?? null); schedule(); return validation;
    },
    setPlane(value) { plane = AXES.includes(value?.normalAxis) && Number.isFinite(value.offsetMm) && Math.abs(value.offsetMm) <= 1e12 ? {...value} : null; schedule(); },
    setSelection(value = {}) { selection = {...value}; schedule(); },
    setSection(value) { sectionStrokes = solidPreviewSectionStrokes(value); schedule(); },
    setMappedProfile(value, mapping) { sectionStrokes = solidPreviewMappedProfileStrokes(value, mapping); schedule(); },
    setDisplayUnits(value) { const next = value === "inch" ? "inch" : "mm"; if (next !== displayUnits) { displayUnits = next; schedule(); } },
    fit() { navigation.fit(); },
    setView(value) { navigation.setView(value); },
    getNavigationState: navigation.snapshot,
    getRenderStats: () => meshRenderer?.statistics() ?? {renderer: "canvas2d", triangles: triangles.length},
    redraw: schedule,
    destroy() { destroyed = true; navigation.destroy(); meshRenderer?.destroy(); if (pending !== null) cancelFrame(pending); observer?.disconnect(); globalThis.removeEventListener?.("resize", schedule); globalThis.window.removeEventListener("blur", blur); for (const [event, handler] of Object.entries(events)) canvas.removeEventListener(event, handler); canvas.style.touchAction = originalTouchAction; pointers.clear(); model = null; triangles = []; projected = []; sectionStrokes = []; selection = {}; plane = null; ctx.clearRect(0, 0, canvas.width, canvas.height); },
  };
}
