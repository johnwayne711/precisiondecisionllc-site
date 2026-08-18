const EPSILON = 1e-9;

function pathPieces(segment, xScale) {
  const points = Array.isArray(segment?.points) ? segment.points : [];
  const pieces = [];
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    const dx = Math.abs(after.x - before.x) * xScale;
    const dz = Math.abs(after.z - before.z);
    pieces.push({before, after, dx, dz, length: Math.hypot(dx, dz)});
  }
  return pieces;
}

function rapidSeconds(segment, {xScale, rapidXMax, rapidZMax}) {
  let minutes = 0;
  for (const piece of pathPieces(segment, xScale)) {
    if (piece.dx > EPSILON && !(rapidXMax > 0)) return null;
    if (piece.dz > EPSILON && !(rapidZMax > 0)) return null;
    const xMinutes = piece.dx > EPSILON ? piece.dx / rapidXMax : 0;
    const zMinutes = piece.dz > EPSILON ? piece.dz / rapidZMax : 0;
    minutes += Math.max(xMinutes, zMinutes);
  }
  return minutes * 60;
}

function cssRpm(segment, point, xScale) {
  const diameterMm = Math.abs(point.x) * (xScale === 0.5 ? 1 : 2);
  if (!(diameterMm > EPSILON) || !(segment.spindleSpeed > 0)) return null;
  const rpm = segment.programUnits === "in"
    ? segment.spindleSpeed * 12 / (Math.PI * (diameterMm / 25.4))
    : segment.spindleSpeed * 1000 / (Math.PI * diameterMm);
  return segment.spindleLimit > 0 ? Math.min(rpm, segment.spindleLimit) : rpm;
}

function cuttingSeconds(segment, xScale, limitations) {
  if (!(segment.feed > 0)) return null;
  const unitScale = segment.unitScale > 0 ? segment.unitScale : (segment.programUnits === "in" ? 25.4 : 1);
  let minutes = 0;
  for (const piece of pathPieces(segment, xScale)) {
    if (piece.length <= EPSILON) continue;
    if (segment.feedMode === "per-minute") {
      minutes += (piece.length / unitScale) / segment.feed;
      continue;
    }
    if (segment.feedMode !== "per-revolution" || segment.spindleRunning === false) return null;
    let rpm = null;
    if (segment.spindleMode === "rpm") rpm = segment.spindleSpeed;
    else if (segment.spindleMode === "css") {
      const midpoint = {x: (piece.before.x + piece.after.x) / 2, z: (piece.before.z + piece.after.z) / 2};
      rpm = cssRpm(segment, midpoint, xScale);
      if (!(segment.spindleLimit > 0)) limitations.add("G96 CSS has no G50 maximum RPM; CSS motion is an optimistic estimate.");
    }
    if (!(rpm > 0)) return null;
    minutes += (piece.length / unitScale) / (segment.feed * rpm);
  }
  return minutes * 60;
}

export function estimateCycleTime(parsed, {
  xScale = 1,
  rapidXMax = null,
  rapidZMax = null,
} = {}) {
  const segments = Array.isArray(parsed?.segments) ? parsed.segments : [];
  const limitations = new Set();
  let rapid = 0;
  let cutting = 0;
  let timedSegments = 0;
  let untimedSegments = 0;

  for (const segment of segments) {
    const seconds = segment.type === "rapid"
      ? rapidSeconds(segment, {xScale, rapidXMax, rapidZMax})
      : cuttingSeconds(segment, xScale, limitations);
    if (Number.isFinite(seconds)) {
      if (segment.type === "rapid") rapid += seconds;
      else cutting += seconds;
      timedSegments += 1;
    } else {
      untimedSegments += 1;
    }
  }

  const dwell = Math.max(0, Number(parsed?.dwellSeconds) || 0);
  if (untimedSegments) limitations.add(`${untimedSegments} motion block${untimedSegments === 1 ? " is" : "s are"} missing feed, spindle, or rapid-rate data.`);
  const seconds = rapid + cutting + dwell;
  return {
    seconds,
    rapidSeconds: rapid,
    cuttingSeconds: cutting,
    dwellSeconds: dwell,
    timedSegments,
    untimedSegments,
    complete: untimedSegments === 0 && limitations.size === 0,
    hasEstimate: timedSegments > 0 || dwell > 0,
    limitations: [...limitations],
  };
}

export function formatCycleTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}
