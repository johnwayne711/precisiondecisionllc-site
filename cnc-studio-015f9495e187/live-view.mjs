import {rotarySectionOutline} from "./live-section-stock.mjs";

const EPSILON = 1e-9;

export function liveFacePoint(segment, point, xScale = 1) {
  if (segment?.coordinateMode === "g112-face") {
    return {x: Number(point?.x) || 0, y: Number(point?.y) || 0};
  }
  const radial = (Number(point?.x) || 0) * (segment?.xCoordinateMode === "radius" ? 1 : xScale);
  const tangent = Number(point?.y) || 0;
  const angle = (Number(point?.c) || 0) * Math.PI / 180;
  return {
    x: radial * Math.cos(angle) - tangent * Math.sin(angle),
    y: radial * Math.sin(angle) + tangent * Math.cos(angle),
  };
}

export function liveFaceSegmentPoints(segment, xScale = 1) {
  const points = Array.isArray(segment?.points) && segment.points.length
    ? segment.points
    : [segment?.start, segment?.end].filter(Boolean);
  return points.map((point) => liveFacePoint(segment, point, xScale));
}

const DEGREES = Math.PI / 180;

/**
 * Machine-frame display transform for the Face view. Canonical part-frame
 * face coordinates rotate by the current spindle angle (positive B/C is
 * counterclockwise viewed from the free end, the right-hand rule about +Z,
 * unless the profile declares otherwise) so the fixed tool stays on the
 * turret side while the part turns. A front-turret lathe has +X toward the
 * operator and +Y down, i.e. the rear-turret picture rotated 180 degrees.
 */
export function liveFaceFrame({spindleRotationDegrees = 0, turretSide = "rear"} = {}) {
  const rotation = (Number.isFinite(spindleRotationDegrees) ? spindleRotationDegrees : 0)
    + (turretSide === "front" ? 180 : 0);
  const cos = Math.cos(rotation * DEGREES);
  const sin = Math.sin(rotation * DEGREES);
  return (point) => {
    const x = Number(point?.x) || 0;
    const y = Number(point?.y) || 0;
    return {x: x * cos - y * sin, y: x * sin + y * cos};
  };
}

export function liveFaceBounds(segments, {xScale = 1, stockRadius = 0, frame = null} = {}) {
  const transform = typeof frame === "function" ? frame : (point) => point;
  const points = (segments || []).filter((segment) => segment?.liveTool || segment?.machiningMode === "live-tool")
    .flatMap((segment) => liveFaceSegmentPoints(segment, xScale)).map(transform);
  if (stockRadius > 0) points.push(
    {x: -stockRadius, y: -stockRadius},
    {x: stockRadius, y: stockRadius},
  );
  if (!points.length) return {minX: -1, maxX: 1, minY: -1, maxY: 1};
  let minX = Math.min(...points.map((point) => point.x));
  let maxX = Math.max(...points.map((point) => point.x));
  let minY = Math.min(...points.map((point) => point.y));
  let maxY = Math.max(...points.map((point) => point.y));
  if (maxX - minX < EPSILON) { minX -= 0.5; maxX += 0.5; }
  if (maxY - minY < EPSILON) { minY -= 0.5; maxY += 0.5; }
  return {minX, maxX, minY, maxY};
}

export function axialBoreDiameterLabel(bore, {
  lengthScale = 1,
  lengthUnit = "mm",
  lengthDecimals = 3,
} = {}) {
  const scale = Number(lengthScale);
  const diameter = Number(bore?.radius) * 2;
  const decimals = Math.max(0, Math.min(8, Math.trunc(Number(lengthDecimals) || 0)));
  const shown = Number.isFinite(diameter) && Number.isFinite(scale) && scale > 0 ? diameter / scale : 0;
  return `BORE Ø${shown.toFixed(decimals)} ${String(lengthUnit || "mm")}`;
}

/**
 * Screen projection of machine-frame face coordinates viewed from the free
 * end toward the chuck: +X (toward the turret on a rear-turret lathe) is
 * screen-right and +Y is screen-up, so +Z points at the viewer.
 */
export function liveFaceProjector(bounds, width, height, padding = 34) {
  const spanX = Math.max(EPSILON, bounds.maxX - bounds.minX);
  const spanY = Math.max(EPSILON, bounds.maxY - bounds.minY);
  const scale = Math.max(0.01, Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY));
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return (point) => ({
    x: width / 2 + (point.x - centerX) * scale,
    y: height / 2 - (point.y - centerY) * scale,
  });
}

function projectedRadius(project, center, radius) {
  const screenCenter = project(center);
  const screenEdge = project({x: center.x + radius, y: center.y});
  return Math.hypot(screenEdge.x - screenCenter.x, screenEdge.y - screenCenter.y);
}

function strokePath(context, points, project, {color, width, dash, alpha}) {
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
  context.stroke();
  context.globalAlpha = 1;
  context.setLineDash([]);
}

export function renderLiveFace2d(context, {
  width,
  height,
  segments = [],
  visibleCount = 0,
  xScale = 1,
  stockRadius = 0,
  stockFaceIntervals = null,
  axialBores = [],
  rotarySections = [],
  sectionFaceZ = null,
  cutterRadius = 0,
  cutterCenter = null,
  spindleRotationDegrees = 0,
  referenceB = null,
  turretSide = "rear",
  rotarySenseKnown = true,
  lengthScale = 1,
  lengthUnit = "mm",
  lengthDecimals = 3,
} = {}) {
  const liveSegments = segments.filter((segment) => segment?.liveTool || segment?.machiningMode === "live-tool");
  const frame = liveFaceFrame({spindleRotationDegrees, turretSide});
  const bounds = liveFaceBounds(liveSegments, {xScale, stockRadius, frame});
  const projectFrame = liveFaceProjector(bounds, width, height);
  const project = (point) => projectFrame(frame(point));
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#061012";
  context.fillRect(0, 0, width, height);

  const origin = project({x: 0, y: 0});
  context.strokeStyle = "rgba(145, 166, 171, .28)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, origin.y); context.lineTo(width, origin.y);
  context.moveTo(origin.x, 0); context.lineTo(origin.x, height);
  context.stroke();

  if (stockRadius > 0) {
    const radius = projectedRadius(project, {x: 0, y: 0}, stockRadius);
    context.beginPath();
    context.arc(origin.x, origin.y, radius, 0, Math.PI * 2);
    context.fillStyle = "rgba(56, 189, 248, .10)";
    if (!stockFaceIntervals) context.fill();
    context.strokeStyle = "rgba(86, 204, 220, .58)";
    context.setLineDash([5, 4]);
    context.stroke();
    context.setLineDash([]);
    for (const [innerRadius, outerRadius] of stockFaceIntervals || []) {
      context.beginPath();
      context.arc(origin.x, origin.y, projectedRadius(project, {x: 0, y: 0}, outerRadius), 0, Math.PI * 2);
      if (innerRadius > 0) {
        context.moveTo(origin.x + projectedRadius(project, {x: 0, y: 0}, innerRadius), origin.y);
        context.arc(origin.x, origin.y, projectedRadius(project, {x: 0, y: 0}, innerRadius), 0, Math.PI * 2, true);
      }
      context.fill("evenodd"); context.stroke();
    }
  }

  // Rotary-indexed side-milling sections: the section reaching the free face
  // replaces the plain stock disk; deeper sections are outlined with their Z.
  const faceSection = (rotarySections || []).find((section) => (
    Number.isFinite(sectionFaceZ) && section.endZ >= sectionFaceZ - EPSILON
  )) || null;
  for (const section of rotarySections || []) {
    const outline = rotarySectionOutline(section, {maximumPoints: 1440});
    if (outline.length < 3) continue;
    const atFace = section === faceSection;
    if (atFace && stockRadius > 0) {
      const radius = projectedRadius(project, {x: 0, y: 0}, stockRadius);
      context.beginPath();
      context.arc(origin.x, origin.y, radius, 0, Math.PI * 2);
      outline.forEach((point, index) => {
        const screen = project(point);
        if (index) context.lineTo(screen.x, screen.y); else context.moveTo(screen.x, screen.y);
      });
      context.closePath();
      context.fillStyle = "#061012";
      context.fill("evenodd");
    }
    context.beginPath();
    outline.forEach((point, index) => {
      const screen = project(point);
      if (index) context.lineTo(screen.x, screen.y); else context.moveTo(screen.x, screen.y);
    });
    context.closePath();
    context.strokeStyle = atFace ? "#7ce5dc" : "rgba(124, 229, 220, .55)";
    context.lineWidth = atFace ? 1.6 : 1;
    context.setLineDash(atFace ? [] : [4, 3]);
    context.stroke();
    context.setLineDash([]);
    if (!atFace) {
      context.fillStyle = "rgba(180, 229, 226, .8)";
      context.font = '8px "Cascadia Code", Consolas, monospace';
      const label = project(outline[0]);
      context.fillText(`SECTION Z${(section.startZ / lengthScale).toFixed(lengthDecimals)}…${(section.endZ / lengthScale).toFixed(lengthDecimals)} ${lengthUnit}`, label.x + 4, label.y - 4);
    }
  }
  if (cutterRadius > 0 && cutterCenter && Number.isFinite(cutterCenter.x) && Number.isFinite(cutterCenter.y)) {
    const center = project(cutterCenter);
    const radius = projectedRadius(project, cutterCenter, cutterRadius);
    context.beginPath();
    context.arc(center.x, center.y, radius, 0, Math.PI * 2);
    context.strokeStyle = "#f9a8d4";
    context.lineWidth = 1.2;
    context.setLineDash([2, 3]);
    context.stroke();
    context.setLineDash([]);
  }

  for (const bore of axialBores || []) {
    const physicalCenter = {x: Number(bore.centerX) || 0, y: Number(bore.centerY) || 0};
    const center = project(physicalCenter);
    const radius = projectedRadius(project, physicalCenter, Number(bore.radius) || 0);
    if (!(radius > 0)) continue;
    context.beginPath();
    context.arc(center.x, center.y, radius, 0, Math.PI * 2);
    context.fillStyle = "rgba(2, 11, 14, .96)";
    context.fill();
    context.strokeStyle = "#7ce5dc";
    context.lineWidth = 1.4;
    context.stroke();
    context.fillStyle = "rgba(180, 229, 226, .9)";
    context.font = '8px "Cascadia Code", Consolas, monospace';
    context.fillText(
      axialBoreDiameterLabel(bore, {lengthScale, lengthUnit, lengthDecimals}),
      center.x + radius + 5,
      center.y - 4,
    );
  }

  for (const segment of liveSegments) {
    strokePath(context, liveFaceSegmentPoints(segment, xScale), project, {
      color: "#80506e", width: 1.2, dash: [3, 3], alpha: 0.38,
    });
  }
  const visibleSet = new Set(segments.slice(0, visibleCount));
  for (const segment of liveSegments.filter((candidate) => visibleSet.has(candidate))) {
    const rapid = segment.type === "rapid" || segment.type === "live-rapid";
    const blocked = segment.verificationBlocked || segment.liveToolBlocked;
    strokePath(context, liveFaceSegmentPoints(segment, xScale), project, {
      color: blocked ? "#fb7185" : "#f472b6",
      width: rapid ? 1.4 : 2.2,
      dash: rapid ? [7, 4, 2, 4] : [3, 2],
      alpha: 0.98,
    });
  }

  // Machine axes stay fixed on screen while the part-frame geometry above
  // rotates with the spindle: +X toward the turret, +Y up, viewed from the
  // free end. A front turret puts +X on the left and +Y down.
  const front = turretSide === "front";
  const turretLabel = turretSide === "rear" ? "TURRET REAR" : front ? "TURRET FRONT" : "TURRET SIDE UNKNOWN · DRAWN AS REAR";
  const rotationLabel = Number.isFinite(referenceB)
    ? ` · PART FIXED AT B${referenceB.toFixed(2)}${rotarySenseKnown ? "" : " (+B CCW ASSUMED)"}`
    : "";
  context.fillStyle = "rgba(180, 205, 208, .76)";
  context.font = '9px "Cascadia Code", Consolas, monospace';
  context.fillText(`FACE VIEW · FROM FREE END · +X ${front ? "LEFT" : "RIGHT"} · +Y ${front ? "DOWN" : "UP"} · ${turretLabel}${rotationLabel}`, 12, 18);
  context.fillStyle = "#56e39f";
  context.fillText("X+", front ? 12 : width - 22, origin.y - 5);
  context.fillStyle = "#f472b6";
  context.fillText("Y+", origin.x + 5, front ? height - 8 : 12);
  if (!liveSegments.length) {
    context.fillStyle = "rgba(145, 166, 171, .82)";
    context.textAlign = "center";
    context.fillText("NO LIVE-TOOL PATHS", width / 2, height / 2);
    context.textAlign = "left";
  }
  return {liveSegments, bounds};
}
