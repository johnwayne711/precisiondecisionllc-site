const EPSILON = 1e-9;
export const LEGACY_RAPID_RATE_IPM = 400;
export const LEGACY_RAPID_RATE_MM_PER_MINUTE = LEGACY_RAPID_RATE_IPM * 25.4;

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

function rapidTiming(segment, {xScale, rapidXMax, rapidZMax, fallbackRapidRate}) {
  let minutes = 0;
  let assumedX = false;
  let assumedZ = false;
  for (const piece of pathPieces(segment, xScale)) {
    const xRate = rapidXMax > 0 ? rapidXMax : fallbackRapidRate;
    const zRate = rapidZMax > 0 ? rapidZMax : fallbackRapidRate;
    if (piece.dx > EPSILON && !(xRate > 0)) return null;
    if (piece.dz > EPSILON && !(zRate > 0)) return null;
    if (piece.dx > EPSILON && !(rapidXMax > 0)) assumedX = true;
    if (piece.dz > EPSILON && !(rapidZMax > 0)) assumedZ = true;
    const xMinutes = piece.dx > EPSILON ? piece.dx / xRate : 0;
    const zMinutes = piece.dz > EPSILON ? piece.dz / zRate : 0;
    minutes += Math.max(xMinutes, zMinutes);
  }
  return {seconds: minutes * 60, assumed: assumedX || assumedZ, assumedX, assumedZ};
}

function cssRpm(segment, point, xScale) {
  const diameterMm = Math.abs(point.x) * (xScale === 0.5 ? 1 : 2);
  if (!(diameterMm > EPSILON) || !(segment.spindleSpeed > 0)) return null;
  const rpm = segment.programUnits === "in"
    ? segment.spindleSpeed * 12 / (Math.PI * (diameterMm / 25.4))
    : segment.spindleSpeed * 1000 / (Math.PI * diameterMm);
  return segment.spindleLimit > 0 ? Math.min(rpm, segment.spindleLimit) : rpm;
}

function cuttingTiming(segment, xScale) {
  if (!(segment.feed > 0)) return null;
  const unitScale = segment.unitScale > 0 ? segment.unitScale : (segment.programUnits === "in" ? 25.4 : 1);
  let minutes = 0;
  let assumed = false;
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
      if (!(segment.spindleLimit > 0)) assumed = true;
    }
    if (!(rpm > 0)) return null;
    minutes += (piece.length / unitScale) / (segment.feed * rpm);
  }
  return {seconds: minutes * 60, assumed};
}

function qualityFor(untimedSegments, assumedSegments) {
  if (untimedSegments > 0) return "partial";
  if (assumedSegments > 0) return "assumed";
  return "calculated";
}

export function estimateCycleTime(parsed, {
  xScale = 1,
  rapidXMax = null,
  rapidZMax = null,
  fallbackRapidRate = LEGACY_RAPID_RATE_MM_PER_MINUTE,
} = {}) {
  const segments = Array.isArray(parsed?.segments) ? parsed.segments : [];
  const limitations = new Set();
  const segmentSeconds = [];
  const segmentAssumed = [];
  const cumulativeSeconds = [0];
  const cumulativeUntimedSegments = [0];
  const cumulativeAssumedSegments = [0];
  let rapid = 0;
  let cutting = 0;
  let timedSegments = 0;
  let untimedSegments = 0;
  let assumedSegments = 0;
  let fallbackRapidXUsed = false;
  let fallbackRapidZUsed = false;

  for (const segment of segments) {
    const timing = segment.type === "rapid"
      ? rapidTiming(segment, {xScale, rapidXMax, rapidZMax, fallbackRapidRate})
      : cuttingTiming(segment, xScale);
    const seconds = timing?.seconds;
    const assumed = Boolean(timing?.assumed);
    segmentSeconds.push(Number.isFinite(seconds) ? seconds : null);
    segmentAssumed.push(assumed);
    if (Number.isFinite(seconds)) {
      if (segment.type === "rapid") {
        rapid += seconds;
        fallbackRapidXUsed ||= Boolean(timing.assumedX);
        fallbackRapidZUsed ||= Boolean(timing.assumedZ);
      } else {
        cutting += seconds;
        if (assumed) limitations.add("G96 CSS has no G50 maximum RPM; CSS timing uses the programmed surface speed without a machine RPM cap.");
      }
      timedSegments += 1;
      if (assumed) assumedSegments += 1;
    } else {
      untimedSegments += 1;
    }
    cumulativeSeconds.push(cumulativeSeconds.at(-1) + (Number.isFinite(seconds) ? seconds : 0));
    cumulativeUntimedSegments.push(cumulativeUntimedSegments.at(-1) + (Number.isFinite(seconds) ? 0 : 1));
    cumulativeAssumedSegments.push(cumulativeAssumedSegments.at(-1) + (assumed ? 1 : 0));
  }

  const timingEvents = Array.isArray(parsed?.timingEvents) ? parsed.timingEvents : [];
  const dwell = timingEvents.reduce((sum, event) => sum + (event.type === "dwell" ? Math.max(0, Number(event.seconds) || 0) : 0), 0);
  if (fallbackRapidXUsed || fallbackRapidZUsed) {
    const axes = fallbackRapidXUsed && fallbackRapidZUsed ? "X and Z" : (fallbackRapidXUsed ? "X" : "Z");
    limitations.add(`${axes} rapid timing assumes ${LEGACY_RAPID_RATE_IPM} IPM (${LEGACY_RAPID_RATE_MM_PER_MINUTE.toLocaleString("en-US")} mm/min), a conservative older-machine fallback.`);
  }
  if (untimedSegments) limitations.add(`${untimedSegments} motion block${untimedSegments === 1 ? " is" : "s are"} missing feed, spindle, or rapid-rate data.`);
  const seconds = rapid + cutting + dwell;
  const quality = qualityFor(untimedSegments, assumedSegments);
  return {
    seconds,
    rapidSeconds: rapid,
    cuttingSeconds: cutting,
    dwellSeconds: dwell,
    timedSegments,
    untimedSegments,
    assumedSegments,
    quality,
    complete: quality === "calculated",
    hasEstimate: timedSegments > 0 || dwell > 0,
    limitations: [...limitations],
    segmentSeconds,
    segmentAssumed,
    cumulativeSeconds,
    cumulativeUntimedSegments,
    cumulativeAssumedSegments,
    timingEvents,
    fallbackRapidRate,
    fallbackRapidXUsed,
    fallbackRapidZUsed,
  };
}

export function cycleTimeAtPosition(estimate, {visibleBlocks = 0, sourceLine = 0} = {}) {
  const segmentCount = estimate?.segmentSeconds?.length || 0;
  const block = Math.max(0, Math.min(segmentCount, Math.trunc(Number(visibleBlocks) || 0)));
  const line = Math.max(0, Math.trunc(Number(sourceLine) || 0));
  const dwellElapsed = (estimate?.timingEvents || []).reduce((sum, event) => (
    event.type === "dwell" && Number(event.line) <= line ? sum + Math.max(0, Number(event.seconds) || 0) : sum
  ), 0);
  const elapsed = Math.min(Number(estimate?.seconds) || 0, (estimate?.cumulativeSeconds?.[block] || 0) + dwellElapsed);
  const remaining = Math.max(0, (Number(estimate?.seconds) || 0) - elapsed);
  const totalUntimed = Number(estimate?.untimedSegments) || 0;
  const elapsedUntimed = estimate?.cumulativeUntimedSegments?.[block] || 0;
  const totalAssumed = Number(estimate?.assumedSegments) || 0;
  const elapsedAssumed = estimate?.cumulativeAssumedSegments?.[block] || 0;
  return {
    elapsedSeconds: elapsed,
    remainingSeconds: remaining,
    totalSeconds: Number(estimate?.seconds) || 0,
    elapsedQuality: qualityFor(elapsedUntimed, elapsedAssumed),
    remainingQuality: qualityFor(Math.max(0, totalUntimed - elapsedUntimed), Math.max(0, totalAssumed - elapsedAssumed)),
    totalQuality: estimate?.quality || "partial",
  };
}

export function formatCycleTime(seconds, {tenths = false} = {}) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const totalTenths = Math.round(seconds * (tenths ? 10 : 1));
  const total = tenths ? Math.floor(totalTenths / 10) : totalTenths;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  const fraction = tenths ? `.${totalTenths % 10}` : "";
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}${fraction}`;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}${fraction}`;
}
