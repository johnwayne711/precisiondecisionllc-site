import {cssUnitScaleMm, programmedSpindleRpm} from "./spindle-feed.mjs";

const TAU = 2 * Math.PI;
const finitePoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.z);
const isArc = segment => [segment.type, segment.sourceMotion].some(type => ["arc-cw", "arc-ccw"].includes(type));

// Native turning geometry only. Display points never establish length or CSS diameter.
export function latheMotionGeometry(segment, xScale) {
  const scale = segment.xCoordinateMode === "radius" ? 1 : xScale;
  if (![.5, 1].includes(scale) || !finitePoint(segment.start) || !finitePoint(segment.end)) return null;
  const startRadius = segment.start.x * scale;
  const endRadius = segment.end.x * scale;
  if (!isArc(segment)) {
    const length = Math.hypot(endRadius - startRadius, segment.end.z - segment.start.z,
      (segment.end.y ?? 0) - (segment.start.y ?? 0));
    return Number.isFinite(length) ? {length, startRadius, endRadius, scale, arc: false} : null;
  }
  const {center, radius, sweep} = segment;
  if (!finitePoint(center) || !(radius > 0) || !Number.isFinite(radius)
    || !Number.isFinite(sweep) || sweep === 0 || Math.abs(sweep) > TAU + 1e-12) return null;
  const angle = Math.atan2(startRadius - center.x, segment.start.z - center.z);
  const first = Math.min(angle, angle + sweep);
  const last = Math.max(angle, angle + sweep);
  const length = radius * (last - first);
  return Number.isFinite(length) ? {length, scale, startRadius, endRadius,
    arc: true, centerRadius: center.x, radius, first, last} : null;
}

function arcCrossings(curve, target) {
  const value = (target - curve.centerRadius) / curve.radius;
  if (!Number.isFinite(value) || Math.abs(value) > 1) return [];
  const angle = Math.asin(value);
  const points = [];
  // Start angle lies in [-pi,pi], and a native arc spans at most one revolution.
  for (const phase of [angle, Math.PI - angle]) {
    for (let turn = -2; turn <= 2; turn += 1) {
      const candidate = phase + turn * TAU;
      if (candidate >= curve.first && candidate <= curve.last) points.push(candidate);
    }
  }
  return points;
}

function sinc(value) {
  if (Math.abs(value) < 1e-4) {
    const square = value * value;
    return 1 - square / 6 + square * square / 120;
  }
  return Math.sin(value) / value;
}

// Integral of ds/(F*N), with N=min(S*unitScale/(2*pi*abs(r)), G50).
// Breakpoints make each interval entirely capped or an integral of signed radius.
export function latheCssSeconds(segment, curve, feedMmPerMinuteAtOneRpm) {
  if (!(feedMmPerMinuteAtOneRpm > 0) || !Number.isFinite(feedMmPerMinuteAtOneRpm)) return null;
  const probe = programmedSpindleRpm(segment, segment.start, curve.scale);
  if (!(probe.rpm > 0)) return null;
  const surfaceScale = cssUnitScaleMm(segment);
  if (!(surfaceScale > 0) || !(segment.spindleSpeed > 0) || !Number.isFinite(segment.spindleSpeed)) return null;
  const cap = Number.isFinite(segment.spindleLimit) && segment.spindleLimit > 0 ? segment.spindleLimit : null;
  // Source endpoints remain authoritative when an inverse trig root rounds
  // just outside the native angular interval.
  if (cap === null && Math.min(curve.startRadius, curve.endRadius) <= 0
    && Math.max(curve.startRadius, curve.endRadius) >= 0) return null;
  const capRadius = cap === null ? null : (segment.spindleSpeed / cap) * (surfaceScale / TAU);
  if (capRadius !== null && !Number.isFinite(capRadius)) return null;
  const targets = cap === null ? [0] : [0, -capRadius, capRadius];
  const breaks = curve.arc ? [curve.first, curve.last] : [0, 1];
  if (curve.arc) {
    const zeros = arcCrossings(curve, 0);
    if (cap === null && zeros.length) return null;
    for (const target of targets) breaks.push(...arcCrossings(curve, target));
  } else {
    const {startRadius, endRadius} = curve;
    if (cap === null && Math.min(startRadius, endRadius) <= 0 && Math.max(startRadius, endRadius) >= 0) return null;
    const delta = endRadius - startRadius;
    if (delta !== 0) {
      for (const target of targets) {
        const parameter = (target - startRadius) / delta;
        if (parameter > 0 && parameter < 1) breaks.push(parameter);
      }
    }
  }
  breaks.sort((a, b) => a - b);
  let seconds = 0;
  for (let index = 1; index < breaks.length; index += 1) {
    const first = breaks[index - 1], last = breaks[index];
    if (last <= first) continue;
    const midpoint = (first + last) / 2;
    const middleRadius = curve.arc ? curve.centerRadius + curve.radius * Math.sin(midpoint)
      : curve.startRadius + (curve.endRadius - curve.startRadius) * midpoint;
    const length = curve.arc ? curve.radius * (last - first) : curve.length * (last - first);
    let reciprocalRpm;
    if (cap !== null && Math.abs(middleRadius) <= capRadius) {
      reciprocalRpm = 1 / cap;
    } else {
      const meanRadius = curve.arc
        ? curve.centerRadius + curve.radius * Math.sin(midpoint) * sinc((last - first) / 2)
        : middleRadius;
      reciprocalRpm = (Math.abs(meanRadius) / segment.spindleSpeed) * (TAU / surfaceScale);
      if (!(reciprocalRpm > 0)) return null;
    }
    const duration = (length / feedMmPerMinuteAtOneRpm) * reciprocalRpm * 60;
    if (!Number.isFinite(duration) || duration < 0) return null;
    seconds += duration;
  }
  return Number.isFinite(seconds) ? seconds : null;
}
