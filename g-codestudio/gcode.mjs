import {extractProgramToolCalls} from "./program-tools.mjs";

const MOTION_CODES = new Map([[0, "rapid"], [1, "linear"], [2, "arc-cw"], [3, "arc-ccw"]]);
const EPSILON = 1e-9;

export function stripComments(line) {
  return line.replace(/\([^)]*\)/g, " ").replace(/;.*$/, " ").trim();
}

export function wordsFor(line) {
  const words = [];
  const clean = stripComments(line).toUpperCase();
  const pattern = /([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g;
  for (const match of clean.matchAll(pattern)) {
    words.push({letter: match[1], value: Number(match[2])});
  }
  return words;
}

function distance(a, b) {
  return Math.hypot(b.z - a.z, b.x - a.x);
}

function isKnownPoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.z);
}

function rapidPath(start, end, state, xMode) {
  if (state.rapidBehavior !== "dogleg") return [start, end];
  const xScale = xMode === "diameter" ? 0.5 : 1;
  const xRate = Number(state.rapidXMax);
  const zRate = Number(state.rapidZMax);
  if (!(xRate > 0) || !(zRate > 0)) return [start, end];
  const xTime = Math.abs(end.x - start.x) * xScale / xRate;
  const zTime = Math.abs(end.z - start.z) / zRate;
  const firstFinish = Math.min(xTime, zTime);
  if (firstFinish < EPSILON || Math.abs(xTime - zTime) < EPSILON) return [start, end];
  const midpoint = {
    x: start.x + (end.x - start.x) * Math.min(1, firstFinish / xTime),
    z: start.z + (end.z - start.z) * Math.min(1, firstFinish / zTime),
  };
  return [start, midpoint, end];
}

function normalizedSweep(startAngle, endAngle, clockwise) {
  let sweep = endAngle - startAngle;
  if (clockwise) {
    while (sweep >= 0) sweep -= Math.PI * 2;
  } else {
    while (sweep <= 0) sweep += Math.PI * 2;
  }
  return sweep;
}

function centerFromRadius(start, end, radius, clockwise) {
  const dz = end.z - start.z;
  const dx = end.x - start.x;
  const chord = Math.hypot(dz, dx);
  const magnitude = Math.abs(radius);
  if (chord < EPSILON || chord > magnitude * 2 + EPSILON) return null;
  const midpoint = {z: (start.z + end.z) / 2, x: (start.x + end.x) / 2};
  const offset = Math.sqrt(Math.max(0, magnitude * magnitude - chord * chord / 4));
  const perpendicular = {z: -dx / chord, x: dz / chord};
  const candidates = [
    {z: midpoint.z + perpendicular.z * offset, x: midpoint.x + perpendicular.x * offset},
    {z: midpoint.z - perpendicular.z * offset, x: midpoint.x - perpendicular.x * offset},
  ];
  const wantMajor = radius < 0;
  return candidates.find((center) => {
    const a0 = Math.atan2(start.x - center.x, start.z - center.z);
    const a1 = Math.atan2(end.x - center.x, end.z - center.z);
    const major = Math.abs(normalizedSweep(a0, a1, clockwise)) > Math.PI + EPSILON;
    return major === wantMajor;
  }) ?? candidates[0];
}

function arcGeometry(start, end, params, clockwise, xCoordinateScale, chordTolerance) {
  const geometryStart = {z: start.z, x: start.x * xCoordinateScale};
  const geometryEnd = {z: end.z, x: end.x * xCoordinateScale};
  let center = null;
  if (Number.isFinite(params.i) || Number.isFinite(params.k)) {
    // On common diameter-programmed controls X endpoints are diameters while I
    // remains a radial center offset. Keeping I unscaled matches that convention.
    center = {z: geometryStart.z + (params.k || 0), x: geometryStart.x + (params.i || 0)};
  } else if (Number.isFinite(params.r)) {
    center = centerFromRadius(geometryStart, geometryEnd, params.r, clockwise);
  }
  if (!center) return null;
  const radius = distance(center, geometryStart);
  if (radius < EPSILON) return null;
  const endRadius = distance(center, geometryEnd);
  if (Math.abs(radius - endRadius) > Math.max(0.02, radius * 0.01)) return null;
  const startAngle = Math.atan2(geometryStart.x - center.x, geometryStart.z - center.z);
  const endAngle = Math.atan2(geometryEnd.x - center.x, geometryEnd.z - center.z);
  const sweep = normalizedSweep(startAngle, endAngle, clockwise);
  const tolerance = Math.max(EPSILON, Number(chordTolerance) || 0.0254);
  const maximumAngle = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / radius)));
  const steps = Math.max(12, Math.min(4096, Math.ceil(Math.abs(sweep) / Math.max(maximumAngle, EPSILON))));
  const points = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = startAngle + sweep * index / steps;
    points.push({z: center.z + Math.cos(angle) * radius, x: (center.x + Math.sin(angle) * radius) / xCoordinateScale});
  }
  points[0] = {...start};
  points[points.length - 1] = {...end};
  return {center, radius, sweep, points};
}

function recordFor(raw, index) {
  const byLetter = new Map();
  for (const word of wordsFor(raw)) {
    if (!byLetter.has(word.letter)) byLetter.set(word.letter, []);
    byLetter.get(word.letter).push(word.value);
  }
  return {raw, index, line: index + 1, byLetter};
}

function lastWord(record, letter) {
  return record.byLetter.has(letter) ? record.byLetter.get(letter).at(-1) : undefined;
}

function hasG(record, wanted) {
  return (record.byLetter.get("G") || []).some((code) => Math.round(code * 10) / 10 === wanted);
}

function cloneState(state) {
  return {...state};
}

function applyRecordToolCall(record, state) {
  const call = record.toolCalls?.at(-1);
  if (!call) return;
  // This Fanuc-style parser applies a T word before any motion in the same
  // block. The exact address remains opaque: leading zeros are retained and
  // no station/offset split (or T0000 cancellation) is guessed here.
  state.activeToolKey = call.key;
  state.activeToolCallLine = call.line;
}

function timingSnapshot(state) {
  return {
    feed: state.feed ?? null,
    feedMode: state.feedMode ?? "unknown",
    spindleMode: state.spindleMode ?? "unknown",
    spindleSpeed: state.spindleSpeed ?? null,
    spindleLimit: state.spindleLimit ?? null,
    spindleRunning: state.spindleRunning ?? null,
    unitScale: state.unitScale ?? state.scale ?? 1,
    programUnits: state.programUnits ?? state.units ?? "mm",
  };
}

function updateModalState(record, state, warnings) {
  for (const code of record.byLetter.get("G") || []) {
    const rounded = Math.round(code * 10) / 10;
    if (MOTION_CODES.has(rounded)) state.motion = MOTION_CODES.get(rounded);
    else if (rounded === 18) state.sawPlane = true;
    else if (rounded === 20) { state.scale = 25.4; state.units = "in"; state.sawUnitMode = true; }
    else if (rounded === 21) { state.scale = 1; state.units = "mm"; state.sawUnitMode = true; }
    else if (rounded === 90) state.absolute = true;
    else if (rounded === 91) state.absolute = false;
    else if (rounded === 94 || rounded === 98) state.feedMode = "per-minute";
    else if (rounded === 95 || rounded === 99) state.feedMode = "per-revolution";
    else if (rounded === 96) state.spindleMode = "css";
    else if (rounded === 97) state.spindleMode = "rpm";
    else if (![4, 28, 40, 50, 54, 70, 71, 72, 80].includes(rounded)) {
      warnings.push({line: record.line, message: `G${code} is not modeled.`});
    }
  }

  if (record.byLetter.has("F")) state.feed = lastWord(record, "F");
  if (record.byLetter.has("S")) {
    if (hasG(record, 50)) state.spindleLimit = lastWord(record, "S");
    else state.spindleSpeed = lastWord(record, "S");
  }
  for (const code of record.byLetter.get("M") || []) {
    const rounded = Math.round(code);
    if (rounded === 3 || rounded === 4) state.spindleRunning = true;
    else if (rounded === 5) state.spindleRunning = false;
  }
}

function parseBasicRecord(record, state, xMode, warnings, {executeToolCall = true} = {}) {
  if (executeToolCall) applyRecordToolCall(record, state);
  if (!record.byLetter.size) return null;
  updateModalState(record, state, warnings);
  const hasX = record.byLetter.has("X");
  const hasZ = record.byLetter.has("Z");
  if (!hasX && !hasZ) return null;
  if (!state.sawUnitMode) state.assumedUnitsUsed = true;
  const start = {x: state.x, z: state.z};
  const xWord = hasX ? lastWord(record, "X") * state.scale : null;
  const zWord = hasZ ? lastWord(record, "Z") * state.scale : null;
  const end = {
    x: hasX ? (state.absolute ? xWord : (Number.isFinite(state.x) ? state.x + xWord : null)) : state.x,
    z: hasZ ? (state.absolute ? zWord : (Number.isFinite(state.z) ? state.z + zWord : null)) : state.z,
  };
  state.x = end.x;
  state.z = end.z;
  if (!isKnownPoint(end)) {
    warnings.push({line: record.line, info: true, message: "Motion is waiting for both X and Z to become known."});
    return null;
  }
  if (!isKnownPoint(start)) {
    warnings.push({line: record.line, info: true, message: `Position established at X${(end.x / state.scale).toFixed(4)} Z${(end.z / state.scale).toFixed(4)}; no invented approach was drawn.`});
    return null;
  }
  if (distance(start, end) < EPSILON) return null;

  const points = state.motion === "rapid" ? rapidPath(start, end, state, xMode) : [start, end];
  const segment = {
    type: state.motion, start, end, points, line: record.line, raw: record.raw.trim(), ...timingSnapshot(state),
    toolKey: state.activeToolKey, toolCallLine: state.activeToolCallLine,
  };
  if (state.motion === "arc-cw" || state.motion === "arc-ccw") {
    const params = {
      i: record.byLetter.has("I") ? lastWord(record, "I") * state.scale : NaN,
      k: record.byLetter.has("K") ? lastWord(record, "K") * state.scale : NaN,
      r: record.byLetter.has("R") ? lastWord(record, "R") * state.scale : NaN,
    };
    const arc = arcGeometry(start, end, params, state.motion === "arc-cw", xMode === "diameter" ? 0.5 : 1, state.arcChordTolerance);
    if (arc) Object.assign(segment, arc);
    else {
      segment.type = "linear";
      warnings.push({line: record.line, message: "Arc geometry is incomplete or inconsistent; shown as a line."});
    }
  }
  return segment;
}

function rapidSegment(start, end, record, state, xMode, stage) {
  return {
    type: "rapid", start: {...start}, end: {...end}, points: rapidPath(start, end, state, xMode),
    line: record.line, raw: record.raw.trim(), ...timingSnapshot(state), referenceReturn: true, referenceStage: stage,
    toolKey: state.activeToolKey, toolCallLine: state.activeToolCallLine,
  };
}

function parseReferenceReturn(record, state, xMode, warnings) {
  const reference = state.referencePosition;
  if (!isKnownPoint(reference)) {
    state.x = null;
    state.z = null;
    warnings.push({line: record.line, message: "G28 returns to machine reference, but its position cannot be placed in the part view without a plotted reference estimate."});
    return [];
  }

  const segments = [];
  const start = {x: state.x, z: state.z};
  let intermediate = null;
  if (isKnownPoint(start)) {
    intermediate = {
      x: start.x + (record.byLetter.has("U") ? lastWord(record, "U") * state.scale : 0),
      z: start.z + (record.byLetter.has("W") ? lastWord(record, "W") * state.scale : 0),
    };
    if (distance(start, intermediate) > EPSILON) segments.push(rapidSegment(start, intermediate, record, state, xMode, "intermediate"));
    if (distance(intermediate, reference) > EPSILON) segments.push(rapidSegment(intermediate, reference, record, state, xMode, "reference"));
  }

  state.x = reference.x;
  state.z = reference.z;
  const message = isKnownPoint(start)
    ? `G28 returned to the estimated machine reference at X${(reference.x / state.scale).toFixed(4)} Z${(reference.z / state.scale).toFixed(4)}.`
    : `G28 established the estimated machine reference at X${(reference.x / state.scale).toFixed(4)} Z${(reference.z / state.scale).toFixed(4)}; the unknown incoming move was not drawn.`;
  warnings.push({line: record.line, info: true, message});
  return segments;
}

function sequenceIndex(records, sequence) {
  const wanted = Math.round(sequence);
  return records.findIndex((record) => Math.round(lastWord(record, "N")) === wanted);
}

function contourFor(records, startIndex, endIndex, state, xMode, warnings) {
  const localState = cloneState(state);
  const segments = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    // P-Q records describe contour geometry. A T word retained in one of those
    // records is metadata, not an executed modal tool change for the canned
    // cycle. G70/G71/G72 all use the tool active at their executing call.
    const segment = parseBasicRecord(records[index], localState, xMode, warnings, {executeToolCall: false});
    if (segment) segments.push(segment);
  }
  return {segments, state: localState};
}

function profileGeometry(contourSegments) {
  if (!contourSegments.length) return {points: [], segments: [], startLine: null};
  const first = contourSegments[0].end;
  const profileSegments = contourSegments.slice(1);
  const points = [{...first}];
  for (const segment of profileSegments) points.push(...segment.points.slice(1).map((point) => ({...point})));
  return {points, segments: profileSegments, startLine: contourSegments[0].line};
}

function directionReversals(points, key) {
  let direction = 0;
  let reversals = 0;
  for (let index = 1; index < points.length; index += 1) {
    const delta = points[index][key] - points[index - 1][key];
    if (Math.abs(delta) < EPSILON) continue;
    const next = Math.sign(delta);
    if (direction && next !== direction) reversals += 1;
    direction = next;
  }
  return reversals;
}

function shiftedProfile(geometry, offsetX, offsetZ, xCoordinateScale) {
  return {
    startLine: geometry.startLine,
    points: geometry.points.map((point) => ({x: point.x + offsetX, z: point.z + offsetZ})),
    segments: geometry.segments.map((segment) => ({
      ...segment,
      start: {x: segment.start.x + offsetX, z: segment.start.z + offsetZ},
      end: {x: segment.end.x + offsetX, z: segment.end.z + offsetZ},
      points: segment.points.map((point) => ({x: point.x + offsetX, z: point.z + offsetZ})),
      center: segment.center ? {
        x: segment.center.x + offsetX * xCoordinateScale,
        z: segment.center.z + offsetZ,
      } : undefined,
    })),
  };
}

function crossingPoint(points, level, key, outsideDirection) {
  if (!points.length) return null;
  const safe = (point) => (level - point[key]) * outsideDirection >= -EPSILON;
  if (!safe(points[0])) return {...points[0]};
  for (let index = 1; index < points.length; index += 1) {
    if (safe(points[index])) continue;
    const before = points[index - 1];
    const after = points[index];
    const denominator = after[key] - before[key];
    const ratio = Math.abs(denominator) < EPSILON ? 0 : (level - before[key]) / denominator;
    return {
      x: before.x + (after.x - before.x) * Math.max(0, Math.min(1, ratio)),
      z: before.z + (after.z - before.z) * Math.max(0, Math.min(1, ratio)),
    };
  }
  return {...points.at(-1)};
}

function generatedSegment(type, start, end, cycle, line, pass, points = null, rapidState = null, xMode = "diameter", geometry = null) {
  const path = points || (type === "rapid" && rapidState ? rapidPath(start, end, rapidState, xMode) : [{...start}, {...end}]);
  const timingSource = geometry && type !== "rapid" ? geometry : rapidState;
  const segment = {
    type, start: {...start}, end: {...end}, points: path,
    line, raw: `${cycle} generated ${type}${pass ? ` pass ${pass}` : ""}`,
    ...timingSnapshot(timingSource || {}), generated: true, cycle, pass,
    executionLine: line,
    sourceLine: Number.isInteger(geometry?.line) ? geometry.line : line,
    toolKey: rapidState?.activeToolKey ?? null,
    toolCallLine: rapidState?.activeToolCallLine ?? null,
  };
  if (geometry?.center && Number.isFinite(geometry.radius) && Number.isFinite(geometry.sweep)) {
    Object.assign(segment, {
      sourceMotion: geometry.type,
      center: {...geometry.center},
      radius: geometry.radius,
      sweep: geometry.sweep,
    });
  }
  return segment;
}

function expandCycle({code, start, geometry, depth, retract, finishU, finishW, xMode, line, p, q, rapidState}) {
  const warnings = [];
  const segments = [];
  const xCoordinateScale = xMode === "diameter" ? 0.5 : 1;
  const points = geometry.points;
  if (points.length < 2) return {segments, warnings: [{line, message: `${code} P${p}/Q${q} does not define a usable profile.`}], passes: 0, type: "I"};

  const averageX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const averageZ = points.reduce((sum, point) => sum + point.z, 0) / points.length;
  const outsideX = Math.sign(start.x - averageX) || 1;
  const outsideZ = Math.sign(start.z - averageZ) || 1;
  const profile = shiftedProfile(geometry, outsideX * Math.abs(finishU), outsideZ * Math.abs(finishW), xCoordinateScale);
  const typeII = code === "G71" ? directionReversals(points, "x") > 0 : directionReversals(points, "z") > 0;
  const invalidReversal = code === "G71" ? directionReversals(points, "z") > 0 : directionReversals(points, "x") > 0;
  if (typeII) warnings.push({line, message: `${code} Type II pockets are shown using the profile envelope; verify nested trough sequencing at the control.`});
  if (invalidReversal) warnings.push({line, message: `${code} profile reverses its cutting axis and may be invalid for this cycle.`});

  let current = {...start};
  let passCount = 0;
  const push = (type, end, pass = null, customPoints = null, geometrySource = null) => {
    if (distance(current, end) < EPSILON && !customPoints) return;
    const segment = generatedSegment(type, current, end, code, line, pass, customPoints, rapidState, xMode, geometrySource);
    segments.push(segment);
    current = {...end};
  };

  if (code === "G71") {
    const step = Math.max(EPSILON, Math.abs(depth) / xCoordinateScale);
    const target = outsideX > 0 ? Math.min(...profile.points.map((point) => point.x)) : Math.max(...profile.points.map((point) => point.x));
    const travelZ = Math.sign(profile.points.at(-1).z - profile.points[0].z) || -1;
    let level = start.x;
    while ((level - target) * outsideX > EPSILON && passCount < 250) {
      level += -outsideX * Math.min(step, Math.abs(level - target));
      const hit = crossingPoint(profile.points, level, "x", outsideX);
      passCount += 1;
      push("rapid", {x: level, z: start.z}, passCount);
      if (hit && Math.abs(hit.z - start.z) > EPSILON) push("rough", {x: level, z: hit.z}, passCount);
      const retractPoint = {x: level + outsideX * Math.abs(retract) / xCoordinateScale, z: (hit?.z ?? start.z) - travelZ * Math.abs(retract)};
      push("rapid", retractPoint, passCount);
      push("rapid", {x: retractPoint.x, z: start.z}, passCount);
    }
  } else {
    const step = Math.max(EPSILON, Math.abs(depth));
    const target = outsideZ > 0 ? Math.min(...profile.points.map((point) => point.z)) : Math.max(...profile.points.map((point) => point.z));
    const travelX = Math.sign(profile.points.at(-1).x - profile.points[0].x) || -1;
    let level = start.z;
    while ((level - target) * outsideZ > EPSILON && passCount < 250) {
      level += -outsideZ * Math.min(step, Math.abs(level - target));
      const hit = crossingPoint(profile.points, level, "z", outsideZ);
      passCount += 1;
      push("rapid", {x: start.x, z: level}, passCount);
      if (hit && Math.abs(hit.x - start.x) > EPSILON) push("rough", {x: hit.x, z: level}, passCount);
      const retractPoint = {x: (hit?.x ?? start.x) - travelX * Math.abs(retract) / xCoordinateScale, z: level + outsideZ * Math.abs(retract)};
      push("rapid", retractPoint, passCount);
      push("rapid", {x: start.x, z: retractPoint.z}, passCount);
    }
  }

  if (passCount >= 250) warnings.push({line, message: `${code} expansion stopped at 250 passes; check the depth-of-cut value.`});
  if (profile.points.length) {
    push("rapid", profile.points[0], null, null, {line: profile.startLine});
    for (const profileSegment of profile.segments) {
      const end = profileSegment.end;
      const type = profileSegment.type === "rapid" ? "rapid" : "cycle-profile";
      const customPoints = profileSegment.points.map((point) => ({...point}));
      if (customPoints.length) customPoints[0] = {...current};
      push(type, end, null, customPoints, profileSegment);
    }
  }
  push("rapid", start);
  return {segments, warnings, passes: passCount, type: typeII ? "II" : "I"};
}

function cycleCall(record, pending, state) {
  const code = hasG(record, 71) ? "G71" : "G72";
  const first = pending?.code === code ? pending.record : null;
  const scale = state.scale;
  const depthRaw = code === "G71" ? lastWord(first || record, first ? "U" : "D") : lastWord(first || record, first ? "W" : "D");
  return {
    code,
    p: lastWord(record, "P"), q: lastWord(record, "Q"),
    depth: Number.isFinite(depthRaw) ? depthRaw * scale : NaN,
    retract: (lastWord(first || record, "R") ?? 1) * scale,
    finishU: (lastWord(record, "U") ?? 0) * scale,
    finishW: (lastWord(record, "W") ?? 0) * scale,
    feed: lastWord(record, "F"),
  };
}

export function parseGcode(source, {
  xMode = "diameter", initialPosition = {x: 0, z: 0}, referencePosition = null,
  rapidBehavior = "linear", rapidXMax = null, rapidZMax = null, arcChordTolerance = 0.0254,
  defaultUnits = "mm", warnOnAssumedUnits = false,
} = {}) {
  const lines = source.replace(/\r/g, "").split("\n");
  const records = lines.map(recordFor);
  const extractedToolCalls = extractProgramToolCalls(source);
  const normalizedDefaultUnits = defaultUnits === "inch" || defaultUnits === "in" ? "in" : "mm";
  const state = {
    x: Number.isFinite(initialPosition?.x) ? initialPosition.x : null,
    z: Number.isFinite(initialPosition?.z) ? initialPosition.z : null,
    referencePosition: isKnownPoint(referencePosition) ? {...referencePosition} : null,
    rapidBehavior, rapidXMax, rapidZMax, arcChordTolerance,
    absolute: true, scale: normalizedDefaultUnits === "in" ? 25.4 : 1, units: normalizedDefaultUnits,
    motion: "rapid", feed: null, feedMode: "unknown", spindleMode: "unknown", spindleSpeed: null,
    spindleLimit: null, spindleRunning: null, sawPlane: false, sawUnitMode: false, assumedUnitsUsed: false,
    activeToolKey: null, activeToolCallLine: null,
  };
  const segments = [];
  const warnings = [];
  const cycles = [];
  const timingEvents = [];
  const definitionIndexes = new Set();

  for (const record of records) {
    if (!(hasG(record, 70) || hasG(record, 71) || hasG(record, 72))
      || !Number.isFinite(lastWord(record, "P"))
      || !Number.isFinite(lastWord(record, "Q"))) continue;
    const startIndex = sequenceIndex(records, lastWord(record, "P"));
    const endIndex = sequenceIndex(records, lastWord(record, "Q"));
    if (startIndex >= 0 && endIndex >= startIndex) {
      for (let index = startIndex; index <= endIndex; index += 1) definitionIndexes.add(index);
    }
  }

  const toolCalls = extractedToolCalls.map((call) => {
    const definitionOnly = definitionIndexes.has(call.line - 1);
    return {
      ...call,
      executable: !definitionOnly,
      definitionOnly,
      executionContext: definitionOnly ? "cycle-definition" : "main",
    };
  });
  const executableToolCalls = toolCalls.filter((call) => call.executable);
  const toolCallsByLine = new Map();
  for (const call of toolCalls) {
    if (!toolCallsByLine.has(call.line)) toolCallsByLine.set(call.line, []);
    toolCallsByLine.get(call.line).push(call);
  }
  for (const record of records) record.toolCalls = toolCallsByLine.get(record.line) || [];

  let pending = null;
  for (const record of records) {
    if (!record.byLetter.size || definitionIndexes.has(record.index)) continue;
    applyRecordToolCall(record, state);
    if (hasG(record, 4)) {
      updateModalState(record, state, warnings);
      const secondsWord = lastWord(record, "X") ?? lastWord(record, "U");
      const millisecondsWord = lastWord(record, "P");
      const seconds = Number.isFinite(secondsWord) ? secondsWord : (Number.isFinite(millisecondsWord) ? millisecondsWord / 1000 : NaN);
      if (seconds >= 0) timingEvents.push({type: "dwell", line: record.line, seconds});
      else warnings.push({line: record.line, message: "G04 dwell needs X/U seconds or P milliseconds for cycle-time estimation."});
      continue;
    }
    if (hasG(record, 28)) {
      updateModalState(record, state, warnings);
      segments.push(...parseReferenceReturn(record, state, xMode, warnings));
      continue;
    }
    if (hasG(record, 71) || hasG(record, 72)) {
      updateModalState(record, state, warnings);
      const code = hasG(record, 71) ? "G71" : "G72";
      const p = lastWord(record, "P");
      const q = lastWord(record, "Q");
      if (!Number.isFinite(p) || !Number.isFinite(q)) {
        pending = {code, record};
        continue;
      }
      const call = cycleCall(record, pending, state);
      pending = null;
      const startIndex = sequenceIndex(records, p);
      const endIndex = sequenceIndex(records, q);
      if (startIndex < 0 || endIndex < startIndex) {
        warnings.push({line: record.line, message: `${code} cannot find contour blocks P${p} through Q${q}.`});
        continue;
      }
      if (!Number.isFinite(call.depth) || call.depth <= 0) {
        warnings.push({line: record.line, message: `${code} needs a positive depth of cut (${code === "G71" ? "U or D" : "W or D"}).`});
        continue;
      }
      if (!isKnownPoint(state)) {
        warnings.push({line: record.line, message: `${code} cannot be expanded until the current X/Z position is known.`});
        continue;
      }
      if (Number.isFinite(call.feed)) state.feed = call.feed;
      const contour = contourFor(records, startIndex, endIndex, state, xMode, warnings);
      const geometry = profileGeometry(contour.segments);
      const expanded = expandCycle({
        code, start: {x: state.x, z: state.z}, geometry,
        depth: call.depth, retract: call.retract, finishU: call.finishU, finishW: call.finishW,
        xMode, line: record.line, p, q, rapidState: state,
      });
      segments.push(...expanded.segments);
      warnings.push(...expanded.warnings);
      cycles.push({code, line: record.line, p, q, passes: expanded.passes, type: expanded.type});
      continue;
    }

    if (hasG(record, 70)) {
      updateModalState(record, state, warnings);
      const p = lastWord(record, "P");
      const q = lastWord(record, "Q");
      const startIndex = sequenceIndex(records, p);
      const endIndex = sequenceIndex(records, q);
      if (startIndex < 0 || endIndex < startIndex) {
        warnings.push({line: record.line, message: `G70 cannot find contour blocks P${p} through Q${q}.`});
        continue;
      }
      const contour = contourFor(records, startIndex, endIndex, state, xMode, warnings);
      for (const segment of contour.segments) {
        segments.push({
          ...segment,
          sourceMotion: segment.type,
          type: segment.type === "rapid" ? "rapid" : "finish",
          generated: true,
          cycle: "G70",
          executionLine: record.line,
          toolKey: state.activeToolKey,
          toolCallLine: state.activeToolCallLine,
        });
      }
      state.x = contour.state.x;
      state.z = contour.state.z;
      cycles.push({code: "G70", line: record.line, p, q, passes: 1, type: "finish"});
      continue;
    }

    const segment = parseBasicRecord(record, state, xMode, warnings);
    if (segment) segments.push(segment);
  }

  if (pending) warnings.push({line: pending.record.line, message: `${pending.code} first block has no matching P/Q cycle block.`});
  if (warnOnAssumedUnits && state.assumedUnitsUsed) {
    const label = normalizedDefaultUnits === "in" ? "inches" : "millimeters";
    warnings.unshift({line: null, info: true, message: `No G20/G21 was found before motion; Program units are assuming ${label}.`});
  }
  if (!state.sawPlane && segments.some((segment) => segment.type.startsWith("arc"))) {
    warnings.unshift({line: null, message: "G18 was not present; arcs are assumed to use the lathe X/Z plane."});
  }
  return {
    segments, warnings, cycles, toolCalls, executableToolCalls, units: state.units, sourceLines: lines.length,
    timingEvents, dwellSeconds: timingEvents.reduce((sum, event) => sum + event.seconds, 0),
    unitsSource: state.assumedUnitsUsed ? "assumed" : "program",
  };
}

export function segmentLength(segment, xScale = 1) {
  let total = 0;
  for (let index = 1; index < segment.points.length; index += 1) {
    const before = {z: segment.points[index - 1].z, x: segment.points[index - 1].x * xScale};
    const after = {z: segment.points[index].z, x: segment.points[index].x * xScale};
    total += distance(before, after);
  }
  return total;
}

export function programBounds(segments, xScale = 1) {
  const points = segments.flatMap((segment) => segment.points);
  if (!points.length) return null;
  const xs = points.map((point) => point.x * xScale);
  const zs = points.map((point) => point.z);
  return {minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs)};
}
