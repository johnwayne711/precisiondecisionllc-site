const EPSILON = 1e-9;
export const LEGACY_RAPID_RATE_IPM = 400;
export const LEGACY_RAPID_RATE_MM_PER_MINUTE = LEGACY_RAPID_RATE_IPM * 25.4;

function pathPieces(segment, xScale) {
  const points = Array.isArray(segment?.points) ? segment.points : [];
  const pieces = [];
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    const effectiveXScale = segment?.xCoordinateMode === "radius" ? 1 : xScale;
    const dx = Math.abs(after.x - before.x) * effectiveXScale;
    const dy = Math.abs((after.y ?? 0) - (before.y ?? 0));
    const dz = Math.abs(after.z - before.z);
    const dc = Math.abs((after.c ?? 0) - (before.c ?? 0));
    pieces.push({before, after, dx, dy, dz, dc, length: Math.hypot(dx, dy, dz)});
  }
  return pieces;
}

function rapidTiming(segment, {xScale, rapidXMax, rapidYMax, rapidZMax, rapidCMax, fallbackRapidRate}) {
  if (segment?.verificationBlocked || segment?.liveToolBlocked) return null;
  // Haas G112 virtual X/Y is transformed into coordinated physical X/C
  // motion by the control. Cartesian display distance is not enough to infer
  // axis-limited rapid time, so keep that claim unresolved.
  if (segment?.coordinateMode === "g112-face") return null;
  let minutes = 0;
  let assumedX = false;
  let assumedZ = false;
  for (const piece of pathPieces(segment, xScale)) {
    const xRate = rapidXMax > 0 ? rapidXMax : fallbackRapidRate;
    const zRate = rapidZMax > 0 ? rapidZMax : fallbackRapidRate;
    if (piece.dx > EPSILON && !(xRate > 0)) return null;
    if (piece.dz > EPSILON && !(zRate > 0)) return null;
    if (piece.dy > EPSILON && !(rapidYMax > 0)) return null;
    if (piece.dc > EPSILON && !(rapidCMax > 0)) return null;
    if (piece.dx > EPSILON && !(rapidXMax > 0)) assumedX = true;
    if (piece.dz > EPSILON && !(rapidZMax > 0)) assumedZ = true;
    const xMinutes = piece.dx > EPSILON ? piece.dx / xRate : 0;
    const yMinutes = piece.dy > EPSILON ? piece.dy / rapidYMax : 0;
    const zMinutes = piece.dz > EPSILON ? piece.dz / zRate : 0;
    const cMinutes = piece.dc > EPSILON ? piece.dc / rapidCMax : 0;
    minutes += Math.max(xMinutes, yMinutes, zMinutes, cMinutes);
  }
  if (segment?.cAxisMotion) {
    const rawStart = segment.cAxisMotion.start;
    const rawEnd = segment.cAxisMotion.end;
    if (rawStart === null || rawStart === undefined || rawStart === ""
      || rawEnd === null || rawEnd === undefined || rawEnd === "") return null;
    const start = Number(rawStart);
    const end = Number(rawEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(rapidCMax > 0)) return null;
    minutes = Math.max(minutes, Math.abs(end - start) / rapidCMax);
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
  if (segment.verificationBlocked || segment.liveToolBlocked) return null;
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
    if (segment.feedMode !== "per-revolution" || segment.spindleRunning !== true) return null;
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
  rapidYMax = null,
  rapidZMax = null,
  rapidCMax = null,
  fallbackRapidRate = LEGACY_RAPID_RATE_MM_PER_MINUTE,
} = {}) {
  const segments = Array.isArray(parsed?.segments) ? parsed.segments : [];
  const blockedParserWarnings = (Array.isArray(parsed?.warnings) ? parsed.warnings : [])
    .filter((warning) => warning?.verificationBlocked);
  const limitations = new Set();
  const segmentSeconds = [];
  const segmentAssumed = [];
  const segmentBlocked = [];
  const cumulativeSeconds = [0];
  const cumulativeUntimedSegments = [0];
  const cumulativeAssumedSegments = [0];
  const cumulativeBlockedSegments = [0];
  let rapid = 0;
  let cutting = 0;
  let timedSegments = 0;
  let untimedSegments = 0;
  let assumedSegments = 0;
  let blockedSegments = 0;
  let fallbackRapidXUsed = false;
  let fallbackRapidZUsed = false;

  for (const segment of segments) {
    const blocked = Boolean(segment?.verificationBlocked || segment?.liveToolBlocked);
    const timing = segment.type === "rapid"
      ? rapidTiming(segment, {xScale, rapidXMax, rapidYMax, rapidZMax, rapidCMax, fallbackRapidRate})
      : cuttingTiming(segment, xScale);
    const seconds = timing?.seconds;
    const assumed = Boolean(timing?.assumed);
    segmentSeconds.push(Number.isFinite(seconds) ? seconds : null);
    segmentAssumed.push(assumed);
    segmentBlocked.push(blocked);
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
    } else if (!blocked) {
      untimedSegments += 1;
    }
    if (blocked) blockedSegments += 1;
    cumulativeSeconds.push(cumulativeSeconds.at(-1) + (Number.isFinite(seconds) ? seconds : 0));
    cumulativeUntimedSegments.push(cumulativeUntimedSegments.at(-1) + (!blocked && !Number.isFinite(seconds) ? 1 : 0));
    cumulativeAssumedSegments.push(cumulativeAssumedSegments.at(-1) + (assumed ? 1 : 0));
    cumulativeBlockedSegments.push(cumulativeBlockedSegments.at(-1) + (blocked ? 1 : 0));
  }

  const sourceTimingEvents = Array.isArray(parsed?.timingEvents) ? parsed.timingEvents : [];
  const cAxisTimingEvents = [];
  let untimedCAxisMotions = 0;
  let unknownStartCAxisMotions = 0;
  let blockedCAxisMotions = 0;
  for (const motion of Array.isArray(parsed?.cAxisMotions) ? parsed.cAxisMotions : []) {
    if (motion?.combinedWithLinearAxes) continue;
    const rawStart = motion?.start;
    const rawEnd = motion?.end;
    const startKnown = rawStart !== null && rawStart !== undefined && rawStart !== "" && Number.isFinite(Number(rawStart));
    const endKnown = rawEnd !== null && rawEnd !== undefined && rawEnd !== "" && Number.isFinite(Number(rawEnd));
    const start = startKnown ? Number(rawStart) : null;
    const end = endKnown ? Number(rawEnd) : null;
    let seconds = null;
    let reason = null;
    if (motion?.blocked) {
      reason = motion.reason || "blocked";
      blockedCAxisMotions += 1;
    } else if (!startKnown || !endKnown) {
      reason = "unknown-start";
      unknownStartCAxisMotions += 1;
    } else if (!(rapidCMax > 0)) {
      reason = "missing-rate";
    } else {
      seconds = Math.abs(end - start) / rapidCMax * 60;
      rapid += seconds;
      timedSegments += 1;
    }
    if (!Number.isFinite(seconds)) {
      untimedSegments += 1;
      untimedCAxisMotions += 1;
    }
    cAxisTimingEvents.push({
      type: "c-axis-index",
      line: motion?.line,
      seconds,
      untimed: !Number.isFinite(seconds),
      reason,
      start: Number.isFinite(start) ? start : null,
      end: Number.isFinite(end) ? end : null,
    });
  }
  const timingEvents = [...sourceTimingEvents, ...cAxisTimingEvents]
    .sort((before, after) => (Number(before?.line) || 0) - (Number(after?.line) || 0));
  const dwell = sourceTimingEvents.reduce((sum, event) => sum + (event.type === "dwell" ? Math.max(0, Number(event.seconds) || 0) : 0), 0);
  if (fallbackRapidXUsed || fallbackRapidZUsed) {
    const axes = fallbackRapidXUsed && fallbackRapidZUsed ? "X and Z" : (fallbackRapidXUsed ? "X" : "Z");
    limitations.add(`${axes} rapid timing assumes ${LEGACY_RAPID_RATE_IPM} IPM (${LEGACY_RAPID_RATE_MM_PER_MINUTE.toLocaleString("en-US")} mm/min), a conservative older-machine fallback.`);
  }
  if (unknownStartCAxisMotions) {
    limitations.add(`${unknownStartCAxisMotions} C-axis index block${unknownStartCAxisMotions === 1 ? " starts" : "s start"} from an unknown rotary position and is excluded from timing.`);
  }
  if (blockedCAxisMotions) {
    limitations.add(`${blockedCAxisMotions} blocked C-axis motion block${blockedCAxisMotions === 1 ? " is" : "s are"} excluded from cycle-time claims.`);
  }
  if (untimedCAxisMotions > unknownStartCAxisMotions + blockedCAxisMotions && !(rapidCMax > 0)) {
    limitations.add("C-axis rapid timing needs a confirmed machine C rapid rate.");
  }
  if (untimedSegments) limitations.add(`${untimedSegments} motion block${untimedSegments === 1 ? " is" : "s are"} missing feed, spindle, or rapid-rate data; a starting position may also be unresolved.`);
  if (blockedSegments) limitations.add(`${blockedSegments} verification-blocked motion block${blockedSegments === 1 ? " is" : "s are"} excluded from cycle-time claims.`);
  if (segments.some((segment) => segment.liveTool && segment.verificationBlocked)) {
    limitations.add("Blocked live-tool motion is excluded from cycle-time claims.");
  }
  if (segments.some((segment) => segment.type === "rapid" && segment.coordinateMode === "g112-face")) {
    limitations.add("G112 face rapid timing is unresolved because virtual X/Y motion requires controller-specific X/C kinematic limits.");
  }
  if (segments.some((segment) => segment.type === "rapid" && segment.cAxisMotion
    && (segment.cAxisMotion.start === null || segment.cAxisMotion.start === undefined))) {
    limitations.add("A coordinated C-axis rapid starts from an unknown rotary position and is excluded from timing.");
  }
  if (segments.some((segment) => segment.type === "rapid" && segment.coordinateMode !== "g112-face"
    && (segment.points || []).some((point, index, points) => index && Math.abs((point.y ?? 0) - (points[index - 1].y ?? 0)) > EPSILON)) && !(rapidYMax > 0)) {
    limitations.add("Y-axis rapid timing needs a confirmed machine Y rapid rate.");
  }
  if (segments.some((segment) => segment.type === "rapid"
    && (segment.points || []).some((point, index, points) => index && Math.abs((point.c ?? 0) - (points[index - 1].c ?? 0)) > EPSILON)) && !(rapidCMax > 0)) {
    limitations.add("C-axis rapid timing needs a confirmed machine C rapid rate.");
  }
  if (blockedParserWarnings.length) {
    limitations.add(`${blockedParserWarnings.length} verification-blocking parser warning${blockedParserWarnings.length === 1 ? " marks" : "s mark"} omitted or unresolved program behavior that is excluded from cycle-time claims.`);
  }
  const seconds = rapid + cutting + dwell;
  const quality = blockedParserWarnings.length || blockedSegments ? "partial" : qualityFor(untimedSegments, assumedSegments);
  return {
    seconds,
    rapidSeconds: rapid,
    cuttingSeconds: cutting,
    dwellSeconds: dwell,
    timedSegments,
    untimedSegments,
    blockedSegments,
    assumedSegments,
    quality,
    complete: quality === "calculated",
    hasEstimate: timedSegments > 0 || dwell > 0,
    limitations: [...limitations],
    segmentSeconds,
    segmentAssumed,
    segmentBlocked,
    cumulativeSeconds,
    cumulativeUntimedSegments,
    cumulativeAssumedSegments,
    cumulativeBlockedSegments,
    blockingWarningLines: blockedParserWarnings.map((warning) => Number.isFinite(Number(warning.line)) ? Number(warning.line) : null),
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
  const eventSecondsElapsed = (estimate?.timingEvents || []).reduce((sum, event) => (
    (event.type === "dwell" || event.type === "c-axis-index") && Number(event.line) <= line
      ? sum + Math.max(0, Number(event.seconds) || 0)
      : sum
  ), 0);
  const elapsed = Math.min(Number(estimate?.seconds) || 0, (estimate?.cumulativeSeconds?.[block] || 0) + eventSecondsElapsed);
  const remaining = Math.max(0, (Number(estimate?.seconds) || 0) - elapsed);
  const totalUntimed = Number(estimate?.untimedSegments) || 0;
  const elapsedUntimedEvents = (estimate?.timingEvents || []).filter((event) => (
    event.type === "c-axis-index" && event.untimed && Number(event.line) <= line
  )).length;
  const elapsedUntimed = (estimate?.cumulativeUntimedSegments?.[block] || 0) + elapsedUntimedEvents;
  const totalAssumed = Number(estimate?.assumedSegments) || 0;
  const elapsedAssumed = estimate?.cumulativeAssumedSegments?.[block] || 0;
  const totalBlocked = Number(estimate?.blockedSegments) || 0;
  const elapsedBlocked = estimate?.cumulativeBlockedSegments?.[block] || 0;
  const blockingWarningLines = Array.isArray(estimate?.blockingWarningLines) ? estimate.blockingWarningLines : [];
  const parserBlockReached = blockingWarningLines.some((warningLine) => warningLine === null || warningLine <= line);
  const parserProofUnresolved = blockingWarningLines.length > 0;
  const elapsedQuality = parserBlockReached || elapsedBlocked > 0
    ? "partial"
    : qualityFor(elapsedUntimed, elapsedAssumed);
  const remainingQuality = parserProofUnresolved || totalBlocked > elapsedBlocked
    ? "partial"
    : qualityFor(Math.max(0, totalUntimed - elapsedUntimed), Math.max(0, totalAssumed - elapsedAssumed));
  return {
    elapsedSeconds: elapsed,
    remainingSeconds: remaining,
    totalSeconds: Number(estimate?.seconds) || 0,
    elapsedQuality,
    remainingQuality,
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
