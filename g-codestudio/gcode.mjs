import {extractProgramToolCalls} from "./program-tools.mjs";
import {
  axisCapability as normalizeAxisCapability,
  cAxisEngagement as normalizeCAxisEngagement,
  liveToolCapability as normalizeLiveToolCapability,
  liveToolDialect as resolveLiveToolDialect,
} from "./machine-semantics.mjs";

const MOTION_CODES = new Map([[0, "rapid"], [1, "linear"], [2, "arc-cw"], [3, "arc-ccw"]]);
const CONTROL_FLOW_M_CODES = new Set([96, 97, 98, 99]);
const COMMON_MODELED_M_CODES = new Set([2, 3, 4, 5, 8, 9, 30, ...CONTROL_FLOW_M_CODES]);
const GENERIC_MODELED_M_CODES = new Set([...COMMON_MODELED_M_CODES, 133, 134, 135, 154, 155]);
const HAAS_MODELED_M_CODES = new Set([...COMMON_MODELED_M_CODES, 133, 134, 135, 154, 155]);
const HAAS_UNSUPPORTED_GROUP_01_MOTIONS = new Set([32, 90, 92, 94]);
const HAAS_UNSUPPORTED_GROUP_09_CYCLES = new Set([81, 82, 83, 84, 85, 86, 87, 88, 89, 95]);
const HAAS_DEFAULT_TO_FLOAT_ADDRESSES = new Set(["X", "Y", "Z", "A", "B", "C", "D", "E", "I", "J", "K", "U", "W"]);
const HAAS_INTEGER_FEED_SCALES = new Set(["default", "integer", ".1", ".01", ".001", ".0001"]);
const MODELED_PROGRAM_ADDRESSES = new Set([
  "N", "O", "G", "M", "T", "S", "F",
  "X", "Y", "Z", "U", "W", "C", "H",
  "I", "J", "K", "R", "D", "P", "Q",
]);
const GENERIC_MODAL_GROUPS = Object.freeze([
  {name: "motion", codes: new Set([0, 1, 2, 3, 70, 71, 72])},
  {name: "plane", codes: new Set([17, 18, 19])},
  {name: "positioning", codes: new Set([90, 91])},
  {name: "feed", codes: new Set([94, 95])},
  {name: "units", codes: new Set([20, 21])},
  {name: "cutter compensation", codes: new Set([40, 41, 42])},
  {name: "spindle speed", codes: new Set([96, 97])},
]);
const HAAS_MODAL_GROUPS = Object.freeze([
  {name: "Group 01 motion", codes: new Set([0, 1, 2, 3, 32, 90, 92, 94])},
  {name: "Group 02 plane", codes: new Set([17, 18, 19])},
  {name: "Group 03 positioning", codes: new Set([390, 391])},
  {name: "Group 05 feed", codes: new Set([98, 99])},
  {name: "Group 06 units", codes: new Set([20, 21])},
  {name: "Group 07 cutter compensation", codes: new Set([40, 41, 42])},
  {name: "Group 09 canned cycle", codes: new Set([80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 95])},
  {name: "Group 12 spindle speed", codes: new Set([96, 97])},
  {name: "G112 interpolation", codes: new Set([112, 113])},
]);
const EPSILON = 1e-9;
const PROFILE_NUMERICAL_BUDGET_MM = 0.00127;
const POSITION_INPUT_ULPS = 8;
const POSITION_OPERATION_ULPS = 8;
const CENTER_ARC_DERIVATION_ULPS = 2;
const RADIUS_ARC_INPUT_ULPS = 16;
const RADIUS_ARC_DERIVATION_ULPS = 64;

function boundedUncertaintySum(...terms) {
  const total = terms.reduce((sum, term) => sum + Math.max(0, Number(term) || 0), 0);
  return Number.isFinite(total) ? total : Number.MAX_VALUE;
}

function numericUncertainty(value, ulps = POSITION_INPUT_ULPS) {
  if (!Number.isFinite(value)) return Number.MAX_VALUE;
  const uncertainty = Number.EPSILON * ulps * Math.max(1, Math.abs(value));
  return Number.isFinite(uncertainty) ? uncertainty : Number.MAX_VALUE;
}

function arithmeticUncertainty(...values) {
  const result = values.at(-1);
  return numericUncertainty(result, POSITION_OPERATION_ULPS);
}

function physicalPointUncertaintyMm(axisUncertainty, xCoordinateScale = 1) {
  const x = Math.max(0, Number(axisUncertainty?.x) || 0) * Math.abs(xCoordinateScale);
  const z = Math.max(0, Number(axisUncertainty?.z) || 0);
  const uncertainty = Math.hypot(x, z);
  return Number.isFinite(uncertainty) ? uncertainty : Number.MAX_VALUE;
}

function requiredUncertainty(value) {
  const uncertainty = Number(value);
  return Number.isFinite(uncertainty) && uncertainty >= 0 ? uncertainty : Number.MAX_VALUE;
}

function facePointUncertaintyMm(axisUncertainty) {
  const uncertainty = Math.hypot(
    requiredUncertainty(axisUncertainty?.x),
    requiredUncertainty(axisUncertainty?.y),
    requiredUncertainty(axisUncertainty?.z),
  );
  return Number.isFinite(uncertainty) ? uncertainty : Number.MAX_VALUE;
}

export function stripComments(line) {
  return line.replace(/\([^)]*\)/g, " ").replace(/;.*$/, " ").trim();
}

function wordTokensFor(line) {
  const tokens = [];
  const clean = stripComments(line).toUpperCase();
  const pattern = /([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g;
  for (const match of clean.matchAll(pattern)) {
    tokens.push({letter: match[1], value: Number(match[2]), lexeme: match[2]});
  }
  return tokens;
}

function hasMalformedAddressText(line) {
  const clean = stripComments(line).toUpperCase();
  let index = 0;
  while (index < clean.length) {
    if (/\s/.test(clean[index]) || clean[index] === "%") {
      index += 1;
      continue;
    }
    if (clean[index] === "/") {
      index += 1;
      while (index < clean.length && /\d/.test(clean[index])) index += 1;
      continue;
    }
    if (/[A-Z]/.test(clean[index])) {
      index += 1;
      while (index < clean.length && /\s/.test(clean[index])) index += 1;
      const match = clean.slice(index).match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)/);
      if (!match || !Number.isFinite(Number(match[0]))) return true;
      index += match[0].length;
      continue;
    }
    return true;
  }
  return false;
}

export function wordsFor(line) {
  return wordTokensFor(line).map(({letter, value}) => ({letter, value}));
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

function radiusArcInputUncertainty(value) {
  return Number.EPSILON * RADIUS_ARC_INPUT_ULPS * Math.max(1, Math.abs(value));
}

function radiusArcPointUncertainty(point, positionUncertaintyMm) {
  if (Number.isFinite(positionUncertaintyMm) && positionUncertaintyMm >= 0) {
    return positionUncertaintyMm;
  }
  return Math.hypot(
    radiusArcInputUncertainty(point.z),
    radiusArcInputUncertainty(point.x),
  );
}

function radiusArcDerivationUncertainty(
  start,
  end,
  radius,
  chord,
  discriminant,
  offset,
  {startUncertaintyMm = 0, endUncertaintyMm = 0, radiusUncertaintyMm = 0} = {},
) {
  const magnitude = Math.abs(radius);
  const dz = end.z - start.z;
  const dx = end.x - start.x;
  const startUncertainty = radiusArcPointUncertainty(start, startUncertaintyMm);
  const endUncertainty = radiusArcPointUncertainty(end, endUncertaintyMm);
  const deltaRoundoff = Math.hypot(
    radiusArcInputUncertainty(dz),
    radiusArcInputUncertainty(dx),
  );
  const chordUncertainty = startUncertainty
    + endUncertainty
    + deltaRoundoff
    + radiusArcInputUncertainty(chord);
  const radiusUncertainty = boundedUncertaintySum(
    radiusArcInputUncertainty(magnitude),
    radiusUncertaintyMm,
  );
  const radiusSquared = magnitude * magnitude;
  const halfChordSquared = chord * chord / 4;
  const discriminantRoundoff = Number.EPSILON
    * RADIUS_ARC_DERIVATION_ULPS
    * Math.max(1, Math.abs(radiusSquared), Math.abs(halfChordSquared));
  const discriminantUncertainty = (2 * magnitude + radiusUncertainty) * radiusUncertainty
    + (2 * chord + chordUncertainty) * chordUncertainty / 4
    + discriminantRoundoff;
  if (![chordUncertainty, radiusUncertainty, discriminant, discriminantUncertainty]
    .every(Number.isFinite)) return Number.POSITIVE_INFINITY;

  const minimumOffset = Math.sqrt(Math.max(0, discriminant - discriminantUncertainty));
  const maximumOffset = Math.sqrt(Math.max(0, discriminant + discriminantUncertainty));
  const offsetUncertainty = Math.max(
    Math.abs(offset - minimumOffset),
    Math.abs(maximumOffset - offset),
  );
  if (!Number.isFinite(offsetUncertainty) || chord <= chordUncertainty) {
    return Number.POSITIVE_INFINITY;
  }

  // Normalizing the chord vector amplifies endpoint uncertainty by 1/chord.
  // This term bounds the resulting displacement of the perpendicular center
  // offset. It becomes intentionally fail-closed for tiny/ill-resolved chords.
  const directionUncertainty = Math.min(2, 2 * chordUncertainty / (chord - chordUncertainty));
  const directionDisplacement = maximumOffset * directionUncertainty;
  const midpointUncertainty = (startUncertainty + endUncertainty) / 2;
  const derivedMagnitude = Math.max(
    1,
    magnitude,
    offset,
    Math.abs(start.z),
    Math.abs(start.x),
    Math.abs(end.z),
    Math.abs(end.x),
  );
  const constructionRoundoff = Number.EPSILON
    * RADIUS_ARC_DERIVATION_ULPS
    * derivedMagnitude;
  const total = midpointUncertainty
    + offsetUncertainty
    + directionDisplacement
    + radiusUncertainty
    + constructionRoundoff;
  return Number.isFinite(total) ? total : Number.POSITIVE_INFINITY;
}

function centerDefinedArcDerivationUncertainty(
  start,
  end,
  center,
  radius,
  sweep,
  params,
  {startMm = 0, endMm = 0} = {},
) {
  const startUncertainty = radiusArcPointUncertainty(start, startMm);
  const endUncertainty = radiusArcPointUncertainty(end, endMm);
  const offsetUncertainty = Math.hypot(
    Math.max(0, Number(params.iUncertaintyMm) || 0),
    Math.max(0, Number(params.kUncertaintyMm) || 0),
  );
  const centerRoundoff = Math.hypot(
    arithmeticUncertainty(start.x, params.i || 0, center.x),
    arithmeticUncertainty(start.z, params.k || 0, center.z),
  );
  const centerUncertainty = boundedUncertaintySum(
    startUncertainty,
    offsetUncertainty,
    centerRoundoff,
  );
  const startVectorLength = distance(center, start);
  const endVectorLength = distance(center, end);
  const startVectorUncertainty = boundedUncertaintySum(
    startUncertainty,
    centerUncertainty,
    arithmeticUncertainty(start.x, center.x, start.x - center.x),
    arithmeticUncertainty(start.z, center.z, start.z - center.z),
  );
  const endVectorUncertainty = boundedUncertaintySum(
    endUncertainty,
    centerUncertainty,
    arithmeticUncertainty(end.x, center.x, end.x - center.x),
    arithmeticUncertainty(end.z, center.z, end.z - center.z),
  );
  if (startVectorLength <= startVectorUncertainty || endVectorLength <= endVectorUncertainty) {
    return Number.POSITIVE_INFINITY;
  }
  const startAngularUncertainty = Math.asin(Math.min(
    1,
    startVectorUncertainty / (startVectorLength - startVectorUncertainty),
  ));
  const endAngularUncertainty = Math.asin(Math.min(
    1,
    endVectorUncertainty / (endVectorLength - endVectorUncertainty),
  ));
  const angularRoundoff = numericUncertainty(sweep, CENTER_ARC_DERIVATION_ULPS);
  const topologyUncertainty = startAngularUncertainty
    + endAngularUncertainty
    + angularRoundoff;
  const sweepMagnitude = Math.abs(sweep);
  const topologyMargin = Math.min(sweepMagnitude, Math.PI * 2 - sweepMagnitude);
  if (!Number.isFinite(topologyUncertainty) || topologyMargin <= topologyUncertainty) {
    return Number.POSITIVE_INFINITY;
  }
  const radiusUncertainty = boundedUncertaintySum(
    offsetUncertainty,
    numericUncertainty(radius, CENTER_ARC_DERIVATION_ULPS),
  );
  const angularDisplacement = (radius + radiusUncertainty) * (
    Math.max(startAngularUncertainty, endAngularUncertainty) + angularRoundoff
  );
  const constructionRoundoff = numericUncertainty(Math.max(
    1,
    radius,
    Math.abs(center.x),
    Math.abs(center.z),
  ), CENTER_ARC_DERIVATION_ULPS);
  const total = boundedUncertaintySum(
    centerUncertainty,
    radiusUncertainty,
    angularDisplacement,
    constructionRoundoff,
  );
  return Number.isFinite(total) ? total : Number.POSITIVE_INFINITY;
}

function centerFromRadius(start, end, radius, clockwise, inputUncertainty = {}) {
  const dz = end.z - start.z;
  const dx = end.x - start.x;
  const chord = Math.hypot(dz, dx);
  const magnitude = Math.abs(radius);
  if (chord < EPSILON || chord > magnitude * 2 + EPSILON) return null;
  const midpoint = {z: (start.z + end.z) / 2, x: (start.x + end.x) / 2};
  const halfChord = chord / 2;
  const discriminant = (magnitude - halfChord) * (magnitude + halfChord);
  const offset = Math.sqrt(Math.max(0, discriminant));
  const perpendicular = {z: -dx / chord, x: dz / chord};
  const candidates = [
    {z: midpoint.z + perpendicular.z * offset, x: midpoint.x + perpendicular.x * offset},
    {z: midpoint.z - perpendicular.z * offset, x: midpoint.x - perpendicular.x * offset},
  ];
  const wantMajor = radius < 0;
  const center = candidates.find((candidate) => {
    const a0 = Math.atan2(start.x - candidate.x, start.z - candidate.z);
    const a1 = Math.atan2(end.x - candidate.x, end.z - candidate.z);
    const major = Math.abs(normalizedSweep(a0, a1, clockwise)) > Math.PI + EPSILON;
    return major === wantMajor;
  }) ?? candidates[0];
  return {
    center,
    geometryUncertaintyMm: radiusArcDerivationUncertainty(
      start,
      end,
      radius,
      chord,
      discriminant,
      offset,
      inputUncertainty,
    ),
  };
}

function arcGeometry(
  start,
  end,
  params,
  clockwise,
  xCoordinateScale,
  chordTolerance,
  positionUncertainty = {},
) {
  const geometryStart = {z: start.z, x: start.x * xCoordinateScale};
  const geometryEnd = {z: end.z, x: end.x * xCoordinateScale};
  let center = null;
  let geometryUncertaintyMm = 0;
  let centerDefined = false;
  if (Number.isFinite(params.i) || Number.isFinite(params.k)) {
    // On common diameter-programmed controls X endpoints are diameters while I
    // remains a radial center offset. Keeping I unscaled matches that convention.
    center = {z: geometryStart.z + (params.k || 0), x: geometryStart.x + (params.i || 0)};
    centerDefined = true;
  } else if (Number.isFinite(params.r)) {
    const solution = centerFromRadius(geometryStart, geometryEnd, params.r, clockwise, {
      startUncertaintyMm: positionUncertainty.startMm,
      endUncertaintyMm: positionUncertainty.endMm,
      radiusUncertaintyMm: params.rUncertaintyMm,
    });
    center = solution?.center ?? null;
    geometryUncertaintyMm = solution?.geometryUncertaintyMm ?? Number.POSITIVE_INFINITY;
  }
  if (!center) return null;
  if (!Number.isFinite(geometryUncertaintyMm)
    || geometryUncertaintyMm > PROFILE_NUMERICAL_BUDGET_MM) {
    return {numericalResolutionBlocked: true, geometryUncertaintyMm};
  }
  const radius = distance(center, geometryStart);
  if (radius < EPSILON) return null;
  const endRadius = distance(center, geometryEnd);
  if (Math.abs(radius - endRadius) > Math.max(0.02, radius * 0.01)) return null;
  const startAngle = Math.atan2(geometryStart.x - center.x, geometryStart.z - center.z);
  const endAngle = Math.atan2(geometryEnd.x - center.x, geometryEnd.z - center.z);
  const sweep = normalizedSweep(startAngle, endAngle, clockwise);
  if (centerDefined) {
    geometryUncertaintyMm = centerDefinedArcDerivationUncertainty(
      geometryStart,
      geometryEnd,
      center,
      radius,
      sweep,
      params,
      positionUncertainty,
    );
    if (!Number.isFinite(geometryUncertaintyMm)
      || geometryUncertaintyMm > PROFILE_NUMERICAL_BUDGET_MM) {
      return {numericalResolutionBlocked: true, geometryUncertaintyMm};
    }
  }
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
  return {center, radius, sweep, points, geometryUncertaintyMm};
}

function recordFor(raw, index) {
  const byLetter = new Map();
  const lexemesByLetter = new Map();
  for (const word of wordTokensFor(raw)) {
    if (!byLetter.has(word.letter)) byLetter.set(word.letter, []);
    if (!lexemesByLetter.has(word.letter)) lexemesByLetter.set(word.letter, []);
    byLetter.get(word.letter).push(word.value);
    lexemesByLetter.get(word.letter).push(word.lexeme);
  }
  return {raw, index, line: index + 1, byLetter, lexemesByLetter};
}

function lastWord(record, letter) {
  return record.byLetter.has(letter) ? record.byLetter.get(letter).at(-1) : undefined;
}

function lastWordLexeme(record, letter) {
  return record.lexemesByLetter?.has(letter) ? record.lexemesByLetter.get(letter).at(-1) : undefined;
}

function isUnsignedIntegerWord(record, letter) {
  const lexeme = lastWordLexeme(record, letter);
  const value = lastWord(record, letter);
  return /^\d+$/.test(lexeme || "") && Number.isSafeInteger(value) && value >= 0;
}

function interpretedHaasAddressValue(record, letter, state) {
  let value = lastWord(record, letter);
  const lexeme = lastWordLexeme(record, letter);
  if (state.liveToolDialect === "haas-lathe-ngc" && haasDefaultToFloatApplies(record, letter)
    && lexeme && !lexeme.includes(".")
    && value !== 0 && state.haasDefaultToFloat === "off") {
    const recordUnits = hasG(record, 20) ? "in" : (hasG(record, 21) ? "mm" : state.units);
    value *= recordUnits === "in" ? 0.0001 : 0.001;
  }
  return value;
}

function scaledPositionAddress(record, letter, state) {
  const sourceValue = interpretedHaasAddressValue(record, letter, state);
  const value = sourceValue * state.scale;
  const lexeme = lastWordLexeme(record, letter);
  const exactSafeInteger = state.scale === 1
    && /^[+-]?\d+$/.test(lexeme || "")
    && Number.isSafeInteger(sourceValue);
  const scaleUncertainty = state.scale === 1 ? 0 : numericUncertainty(state.scale);
  return {
    value,
    uncertaintyMm: exactSafeInteger ? 0 : boundedUncertaintySum(
        numericUncertainty(sourceValue) * Math.abs(state.scale),
        scaleUncertainty * Math.abs(sourceValue),
        numericUncertainty(value),
      ),
  };
}

function rotaryPositionAddress(record, letter, state) {
  const value = interpretedHaasAddressValue(record, letter, state);
  const lexeme = lastWordLexeme(record, letter);
  const exactSafeInteger = /^[+-]?\d+$/.test(lexeme || "") && Number.isSafeInteger(value);
  return {
    value,
    uncertaintyDegrees: exactSafeInteger ? 0 : numericUncertainty(value),
  };
}

function resolvedPositionCoordinate(current, currentUncertaintyMm, address, absolute) {
  if (!address) return {value: current, uncertaintyMm: currentUncertaintyMm};
  if (!Number.isFinite(address.value)) return {value: null, uncertaintyMm: null};
  if (absolute) return {value: address.value, uncertaintyMm: address.uncertaintyMm};
  if (!Number.isFinite(current)) return {value: null, uncertaintyMm: null};
  const value = current + address.value;
  return {
    value,
    uncertaintyMm: boundedUncertaintySum(
      requiredUncertainty(currentUncertaintyMm),
      address.uncertaintyMm,
      arithmeticUncertainty(current, address.value, value),
    ),
  };
}

function interpretedHaasFeedValue(record, state) {
  const value = lastWord(record, "F");
  const lexeme = lastWordLexeme(record, "F");
  if (state.liveToolDialect !== "haas-lathe-ngc" || !lexeme || lexeme.includes(".")) return value;
  if (!HAAS_INTEGER_FEED_SCALES.has(state.haasIntegerFeedScale)) return NaN;
  if (state.haasIntegerFeedScale === "integer") return value;
  const recordUnits = hasG(record, 20) ? "in" : (hasG(record, 21) ? "mm" : state.units);
  const multiplier = state.haasIntegerFeedScale === "default"
    ? (recordUnits === "in" ? 0.0001 : 0.001)
    : Number(state.haasIntegerFeedScale);
  return value * multiplier;
}

function haasDefaultToFloatApplies(record, letter) {
  return HAAS_DEFAULT_TO_FLOAT_ADDRESSES.has(letter) && (letter !== "D" || !hasG(record, 73));
}

function ambiguousHaasIntegerAddresses(record, state, letters) {
  if (state.liveToolDialect !== "haas-lathe-ngc" || state.haasDefaultToFloat !== "unknown") return [];
  return letters.filter((letter) => {
    if (!haasDefaultToFloatApplies(record, letter)) return false;
    if (!record.byLetter.has(letter)) return false;
    const lexeme = lastWordLexeme(record, letter);
    return lexeme && !lexeme.includes(".") && lastWord(record, letter) !== 0;
  });
}

function duplicateHaasAddress(record) {
  return [...record.byLetter.entries()].find(([letter, values]) => !["G", "M"].includes(letter) && values.length > 1)?.[0] || null;
}

function validateHaasRecordAddresses(record, state, warnings, {stopExecution = false} = {}) {
  const clean = stripComments(record.raw);
  const unsupportedExpression = /[#[\]]/.test(clean);
  const optionalBlockDelete = /^\s*\/\d*/.test(clean);
  const malformedAddressText = !unsupportedExpression && hasMalformedAddressText(record.raw);
  if (unsupportedExpression || optionalBlockDelete || malformedAddressText) {
    if (unsupportedExpression) {
      warningOnce(warnings, {
        line: record.line,
        code: "macro-expression-unsupported",
        verificationBlocked: true,
        message: "Macro variables and bracket expressions are not evaluated; execution is blocked instead of dropping expression-valued words.",
      });
    } else if (optionalBlockDelete) {
      warningOnce(warnings, {
        line: record.line,
        code: "block-delete-state-required",
        verificationBlocked: true,
        message: "Optional/block-delete execution depends on machine state that is not configured; execution is blocked instead of assuming this line runs.",
      });
    } else {
      warningOnce(warnings, {
        line: record.line,
        code: state.liveToolDialect === "haas-lathe-ngc" ? "malformed-haas-address" : "malformed-program-address",
        verificationBlocked: true,
        message: "The program block contains malformed or unrecognized address text; execution is blocked instead of silently dropping it.",
      });
    }
    if (stopExecution) invalidateExecutionState(state);
    return false;
  }
  const unsupportedAddresses = [...record.byLetter.keys()].filter((letter) => (
    !MODELED_PROGRAM_ADDRESSES.has(letter)
    && !(state.liveToolDialect === "haas-lathe-ngc" && ["A", "B", "E", "V"].includes(letter))
  ));
  if (unsupportedAddresses.length) {
    warningOnce(warnings, {
      line: record.line,
      code: "unsupported-program-address",
      verificationBlocked: true,
      message: `${unsupportedAddresses.join("/")} address semantics are not modeled; execution is blocked instead of dropping the word.`,
    });
    if (stopExecution) invalidateExecutionState(state);
    return false;
  }
  const duplicateAddress = duplicateHaasAddress(record);
  const genericModalConflict = state.liveToolDialect === "haas-lathe-ngc"
    ? null
    : conflictingGenericModalGroup(record);
  if (state.liveToolDialect !== "haas-lathe-ngc" && (duplicateAddress || genericModalConflict)) {
    warningOnce(warnings, {
      line: record.line,
      code: duplicateAddress ? "duplicate-program-address" : "multiple-modal-codes",
      verificationBlocked: true,
      message: duplicateAddress
        ? `The program block contains more than one ${duplicateAddress} address; execution is blocked instead of selecting one value.`
        : `The program block selects more than one ${genericModalConflict.name} code; execution is blocked instead of guessing precedence.`,
    });
    if (stopExecution) invalidateExecutionState(state);
    return false;
  }
  const mCodes = record.byLetter.get("M") || [];
  const nonIntegerMCode = mCodes.find((code) => !Number.isInteger(code));
  if (nonIntegerMCode !== undefined) {
    warningOnce(warnings, {
      line: record.line,
      code: "non-integer-m-code",
      verificationBlocked: true,
      message: `M${nonIntegerMCode} is not an exact supported M code and was not executed by the model.`,
    });
    if (stopExecution) invalidateExecutionState(state);
    return false;
  }
  const modeledMCodes = state.liveToolDialect === "haas-lathe-ngc"
    ? HAAS_MODELED_M_CODES
    : GENERIC_MODELED_M_CODES;
  const unsupportedMCode = mCodes.find((code) => !modeledMCodes.has(code));
  if (unsupportedMCode !== undefined) {
    const liveSpecific = state.liveToolDialect === "haas-lathe-ngc"
      ? [14, 15, 19].includes(unsupportedMCode)
      : [133, 134, 135, 154, 155].includes(unsupportedMCode);
    warningOnce(warnings, {
      line: record.line,
      code: liveSpecific
        ? (state.liveToolDialect === "haas-lathe-ngc" ? "unsupported-live-m-code" : "live-tool-dialect-required")
        : (state.liveToolDialect === "haas-lathe-ngc" ? "unsupported-haas-m-code" : "unsupported-m-code"),
      verificationBlocked: true,
      message: liveSpecific && state.liveToolDialect !== "haas-lathe-ngc"
        ? `M${unsupportedMCode} is machine-builder-specific and cannot be interpreted until a live-tool controller dialect is configured.`
        : `M${unsupportedMCode} is not modeled for the selected controller; its machine-state or control-flow effects are unknown, so execution is blocked.`,
    });
    if (stopExecution) invalidateExecutionState(state);
    return false;
  }
  if (state.liveToolDialect !== "haas-lathe-ngc") return true;
  const unsupportedAxes = ["A", "B", "E", "V"].filter((letter) => record.byLetter.has(letter));
  const invalidToolAddress = (record.lexemesByLetter?.get("T") || []).find((lexeme) => !/^\d{1,4}$/.test(lexeme));
  const invalidSequenceAddress = record.byLetter.has("N") && !isUnsignedIntegerWord(record, "N");
  const isContourCycle = hasG(record, 70) || hasG(record, 71) || hasG(record, 72);
  const hasContourReference = record.byLetter.has("P") || record.byLetter.has("Q");
  const requiresContourReference = hasG(record, 70) || (isContourCycle && hasContourReference);
  const invalidContourReference = requiresContourReference
    && (!record.byLetter.has("P") || !record.byLetter.has("Q")
      || !isUnsignedIntegerWord(record, "P") || !isUnsignedIntegerWord(record, "Q"));
  const feedLexeme = lastWordLexeme(record, "F");
  const feedValue = lastWord(record, "F");
  const invalidFeedAddress = record.byLetter.has("F") && (!(feedValue > 0) || !Number.isFinite(feedValue));
  const integerFeedAmbiguous = record.byLetter.has("F") && !invalidFeedAddress
    && feedLexeme && !feedLexeme.includes(".") && state.haasIntegerFeedScale === "unknown";
  const ambiguousAddresses = ambiguousHaasIntegerAddresses(record, state, [...HAAS_DEFAULT_TO_FLOAT_ADDRESSES]);
  if (!unsupportedAxes.length && !duplicateAddress
    && invalidToolAddress === undefined && !invalidSequenceAddress && !invalidContourReference
    && !invalidFeedAddress && !integerFeedAmbiguous && !ambiguousAddresses.length) return true;
  if (unsupportedAxes.length) {
    warningOnce(warnings, {
      line: record.line,
      code: "unsupported-auxiliary-axis",
      verificationBlocked: true,
      message: `${unsupportedAxes.join("/")} auxiliary-axis motion is not modeled for the bounded Haas lathe dialect; execution is blocked instead of dropping it.`,
    });
  } else if (duplicateAddress) {
    warningOnce(warnings, {
      line: record.line,
      code: "duplicate-haas-address",
      verificationBlocked: true,
      message: `Haas block contains more than one ${duplicateAddress} address; execution is blocked instead of selecting one value.`,
    });
  } else if (invalidToolAddress !== undefined) {
    warningOnce(warnings, {
      line: record.line,
      code: "invalid-haas-tool-address",
      verificationBlocked: true,
      message: `Haas lathe T address "T${invalidToolAddress}" is not an unsigned one-to-four-digit Txxyy value; execution is blocked before tool selection.`,
    });
  } else if (invalidSequenceAddress) {
    warningOnce(warnings, {
      line: record.line,
      code: "invalid-haas-sequence-address",
      verificationBlocked: true,
      message: "Haas N sequence identifiers must be unsigned integers; execution is blocked instead of rounding a label.",
    });
  } else if (invalidContourReference) {
    warningOnce(warnings, {
      line: record.line,
      code: "invalid-cycle-contour-reference",
      verificationBlocked: true,
      message: "Haas G70/G71/G72 P and Q contour references must both be unsigned integer sequence identifiers; execution is blocked instead of rounding or guessing a contour.",
    });
  } else if (invalidFeedAddress) {
    warningOnce(warnings, {
      line: record.line,
      code: "invalid-haas-feed-address",
      verificationBlocked: true,
      message: "Haas F feedrate must be a positive finite value; execution is blocked.",
    });
  } else if (integerFeedAmbiguous) {
    warningOnce(warnings, {
      line: record.line,
      code: "haas-integer-feed-ambiguous",
      verificationBlocked: true,
      message: "Integer Haas F input depends on Setting 77 (Scale Integer F). Include an explicit decimal point so feedrate, runtime, and motion can be verified.",
    });
  } else {
    warningOnce(warnings, {
      line: record.line,
      code: "haas-integer-axis-ambiguous",
      verificationBlocked: true,
      message: `${ambiguousAddresses.join("/")} integer input depends on Haas Setting 162 (Default To Float). Configure that setting or include an explicit decimal point.`,
    });
  }
  if (stopExecution) invalidateExecutionState(state);
  return false;
}

function hasG(record, wanted) {
  return (record.byLetter.get("G") || []).some((code) => code === wanted);
}

function hasProgramEnd(record) {
  return (record.byLetter.get("M") || []).some((code) => code === 2 || code === 30);
}

function hasExecutionBoundary(record, liveToolDialect) {
  const mCodes = record.byLetter.get("M") || [];
  return mCodes.some((code) => CONTROL_FLOW_M_CODES.has(code))
    || (liveToolDialect === "haas-lathe-ngc" && (hasG(record, 65) || mCodes.length > 1));
}

function cloneState(state) {
  return {
    ...state,
    liveToolAttempts: new Map(state.liveToolAttempts || []),
  };
}

function warningOnce(warnings, warning) {
  if (warnings.some((existing) => existing.line === warning.line && existing.code === warning.code)) return;
  warnings.push(warning);
}

function activeUnsupportedMotionMode(state) {
  return state.unsupportedGroup09MotionMode || state.unsupportedGroup01MotionMode || null;
}

function activeMotionBlocker(state) {
  return activeUnsupportedMotionMode(state)
    || state.cutterCompMode
    || state.unsupportedCoordinateTransform
    || null;
}

function conflictingHaasModalGroup(record) {
  const codes = record.byLetter.get("G") || [];
  return HAAS_MODAL_GROUPS.find((group) => codes.filter((code) => group.codes.has(code)).length > 1) || null;
}

function conflictingGenericModalGroup(record) {
  const codes = record.byLetter.get("G") || [];
  return GENERIC_MODAL_GROUPS.find((group) => codes.filter((code) => group.codes.has(code)).length > 1) || null;
}

function invalidateExecutionState(state) {
  state.spindleRunning = null;
  state.liveToolRunning = null;
  state.cAxisEngaged = null;
  state.cAxisPosition = null;
  state.cAxisPositionUncertaintyDegrees = null;
  state.faceX = null;
  state.faceY = null;
  state.faceZ = null;
  state.faceXUncertaintyMm = null;
  state.faceYUncertaintyMm = null;
  state.faceZUncertaintyMm = null;
  state.g112PathTainted = true;
  state.turningMode = "unknown";
  state.executionBlocked = true;
}

function noteLiveToolAttempt(record, state, motion = state.motion) {
  if (!["X", "Y", "Z", "U", "W", "C", "H"].some((letter) => record.byLetter.has(letter))) return;
  const explicitMotion = (record.byLetter.get("G") || []).find((code) => MOTION_CODES.has(code));
  const resolvedMotion = explicitMotion === undefined ? motion : MOTION_CODES.get(explicitMotion);
  const exactSupportedMotion = resolvedMotion === "rapid" || resolvedMotion === "linear";
  const blockedSemantics = state.blockCurrentMotionLine === record.line
    || Boolean(activeMotionBlocker(state))
    || !exactSupportedMotion;
  const existing = state.liveToolAttempts.get(record.line);
  state.liveToolAttempts.set(record.line, {
    ...(existing || {}),
    line: record.line,
    raw: record.raw.trim(),
    motion: resolvedMotion,
    rapid: blockedSemantics ? null : resolvedMotion === "rapid",
  });
}

function invalidateUnsupportedPosition(record, state) {
  if (record.byLetter.has("X") || record.byLetter.has("Y")) {
    state.x = null;
    state.xUncertaintyMm = null;
  }
  if (record.byLetter.has("Z")) {
    state.z = null;
    state.zUncertaintyMm = null;
  }
  if (record.byLetter.has("C") || record.byLetter.has("H")) {
    state.cAxisPosition = null;
    state.cAxisPositionUncertaintyDegrees = null;
  }
  state.faceX = null;
  state.faceY = null;
  state.faceZ = null;
  state.faceXUncertaintyMm = null;
  state.faceYUncertaintyMm = null;
  state.faceZUncertaintyMm = null;
  state.g112PathTainted = true;
}

function applyRecordToolCall(record, state, liveToolEvents = null) {
  const call = record.toolCalls?.at(-1);
  if (!call || state.activeToolCallLine === call.line) return;
  // This Fanuc-style parser applies a T word before any motion in the same
  // block. The exact address remains opaque: leading zeros are retained and
  // no station/offset split (or T0000 cancellation) is guessed here.
  state.activeToolKey = call.key;
  state.activeToolCallLine = call.line;
  // Haas documents that a tool change stops the live-tool drive. Apply that
  // before any motion in the tool-change block, while retaining the last
  // commanded direction and speed just as a stopped main spindle does.
  if (state.liveToolDialect === "haas-lathe-ngc" && state.liveToolRunning !== false) {
    state.liveToolRunning = false;
    liveToolEvents?.push({
      line: record.line,
      direction: state.liveToolDirection,
      running: false,
      speed: state.liveToolSpeed,
      phase: "before-block",
      reason: "tool-change",
      toolKey: call.key,
    });
  }
}

function timingSnapshot(state) {
  return {
    feed: state.feed ?? null,
    feedMode: state.feedMode ?? "unknown",
    spindleMode: state.spindleMode ?? "unknown",
    spindleSpeed: state.spindleSpeed ?? null,
    spindleLimit: state.spindleLimit ?? null,
    spindleRunning: state.spindleRunning ?? null,
    spindleDirection: state.spindleDirection ?? "unknown",
    liveToolRunning: state.liveToolRunning ?? null,
    liveToolDirection: state.liveToolDirection ?? "unknown",
    liveToolSpeed: state.liveToolSpeed ?? null,
    cAxisEngaged: state.cAxisEngaged ?? null,
    cAxisPosition: state.cAxisPosition ?? null,
    plane: state.plane ?? "G18",
    unitScale: state.unitScale ?? state.scale ?? 1,
    programUnits: state.programUnits ?? state.units ?? "mm",
  };
}

function polarFaceComponentUncertaintyMm(radius, radiusUncertaintyMm, trigValue, angleUncertaintyRadians, component) {
  return boundedUncertaintySum(
    radiusUncertaintyMm,
    (Math.abs(radius) + requiredUncertainty(radiusUncertaintyMm)) * requiredUncertainty(angleUncertaintyRadians),
    numericUncertainty(trigValue, POSITION_OPERATION_ULPS) * Math.abs(radius),
    numericUncertainty(component, POSITION_OPERATION_ULPS),
  );
}

function updateG112Mode(record, state) {
  if (state.liveToolDialect !== "haas-lathe-ngc") return;
  for (const code of record.byLetter.get("G") || []) {
    if (code === 112) {
      if (!state.g112Active) {
        const radiusCoordinateScale = state.xMode === "diameter" ? 0.5 : 1;
        const radius = Number.isFinite(state.x)
          ? state.x * radiusCoordinateScale
          : null;
        const radiusUncertaintyMm = Number.isFinite(radius)
          ? boundedUncertaintySum(
            requiredUncertainty(state.xUncertaintyMm) * radiusCoordinateScale,
            arithmeticUncertainty(state.x, radiusCoordinateScale, radius),
          )
          : null;
        const angle = Number.isFinite(state.cAxisPosition)
          ? state.cAxisPosition * Math.PI / 180
          : null;
        const angleUncertaintyRadians = Number.isFinite(angle)
          ? boundedUncertaintySum(
            requiredUncertainty(state.cAxisPositionUncertaintyDegrees) * Math.PI / 180,
            arithmeticUncertainty(state.cAxisPosition, Math.PI, 180, angle),
          )
          : null;
        state.faceX = Number.isFinite(radius) && Number.isFinite(angle) ? radius * Math.cos(angle) : null;
        state.faceY = Number.isFinite(radius) && Number.isFinite(angle) ? radius * Math.sin(angle) : null;
        state.faceZ = state.z;
        state.faceXUncertaintyMm = Number.isFinite(state.faceX)
          ? polarFaceComponentUncertaintyMm(
            radius,
            radiusUncertaintyMm,
            Math.cos(angle),
            angleUncertaintyRadians,
            state.faceX,
          )
          : null;
        state.faceYUncertaintyMm = Number.isFinite(state.faceY)
          ? polarFaceComponentUncertaintyMm(
            radius,
            radiusUncertaintyMm,
            Math.sin(angle),
            angleUncertaintyRadians,
            state.faceY,
          )
          : null;
        state.faceZUncertaintyMm = Number.isFinite(state.faceZ)
          ? requiredUncertainty(state.zUncertaintyMm)
          : null;
        state.g112PathTainted = state.turningPathTainted || (
          facePointKnown({x: state.faceX, y: state.faceY, z: state.faceZ})
          && facePointUncertaintyMm({
            x: state.faceXUncertaintyMm,
            y: state.faceYUncertaintyMm,
            z: state.faceZUncertaintyMm,
          }) > PROFILE_NUMERICAL_BUDGET_MM
        );
      }
      state.g112Active = true;
      state.turningMode = "live-tool";
    } else if (code === 113) {
      if (state.g112PathTainted) {
        state.x = null;
        state.z = null;
        state.xUncertaintyMm = null;
        state.zUncertaintyMm = null;
        state.cAxisPosition = null;
        state.cAxisPositionUncertaintyDegrees = null;
        state.turningPathTainted = true;
      }
      state.g112Active = false;
      state.faceX = null;
      state.faceY = null;
      state.faceZ = null;
      state.faceXUncertaintyMm = null;
      state.faceYUncertaintyMm = null;
      state.faceZUncertaintyMm = null;
      state.g112PathTainted = false;
    }
  }
}

function updateModalState(record, state, warnings) {
  const feedModes = state.liveToolDialectDefinition.feedModes;
  const modeledHaasCodes = state.liveToolDialect === "haas-lathe-ngc" ? [112, 113] : [];
  const g112Context = state.g112Active || hasG(record, 112);
  const hasMotionWords = ["X", "Y", "Z", "U", "W", "C", "H"].some((letter) => record.byLetter.has(letter));
  const modalConflict = state.liveToolDialect === "haas-lathe-ngc" ? conflictingHaasModalGroup(record) : null;
  const positioningModeConflict = modalConflict?.name === "Group 03 positioning";
  state.blockCurrentMotionLine = null;
  if (modalConflict) {
    state.blockCurrentMotionLine = record.line;
    invalidateExecutionState(state);
    warningOnce(warnings, {
      line: record.line,
      code: positioningModeConflict ? "multiple-position-modes" : "multiple-haas-modal-codes",
      verificationBlocked: true,
      message: `${modalConflict.name} contains more than one G code in this Haas block; execution is blocked.`,
    });
  }
  for (const code of record.byLetter.get("G") || []) {
    if (!Number.isInteger(code)) {
      state.blockCurrentMotionLine = record.line;
      if (g112Context) state.g112PathTainted = true;
      warningOnce(warnings, {
        line: record.line,
        code: "non-integer-g-code",
        verificationBlocked: true,
        message: `G${code} is not an exact supported G code; motion in this block is blocked.`,
      });
      continue;
    }
    if (state.liveToolDialect !== "haas-lathe-ngc" && (code === 112 || code === 113)) {
      state.unconfiguredG112Active = code === 112;
      state.blockCurrentMotionLine = record.line;
      warningOnce(warnings, {
        line: record.line,
        code: "live-tool-dialect-required",
        verificationBlocked: true,
        message: `G${code} is controller-specific and cannot be interpreted until a supported live-tool dialect is configured${code === 112 ? "; subsequent motion remains blocked through G113" : ""}.`,
      });
      continue;
    }
    if (MOTION_CODES.has(code)) {
      state.motion = MOTION_CODES.get(code);
      if (state.liveToolDialect === "haas-lathe-ngc") {
        // G90/G92/G94 are Haas Group 01 turning cycles. A modeled Group 01
        // motion replaces them. Haas also documents G00/G01 as canned-cycle
        // cancellation commands for the Group 09 drilling family.
        state.unsupportedGroup01MotionMode = null;
        if (code === 0 || code === 1) state.unsupportedGroup09MotionMode = null;
      }
    }
    else if ([17, 18, 19].includes(code)) {
      state.plane = `G${code}`;
      state.sawPlane = true;
    }
    else if (code === 20) { state.scale = 25.4; state.units = "in"; state.sawUnitMode = true; }
    else if (code === 21) { state.scale = 1; state.units = "mm"; state.sawUnitMode = true; }
    else if (state.liveToolDialect === "haas-lathe-ngc" && code === 390) {
      if (!modalConflict) state.absolute = true;
    }
    else if (state.liveToolDialect === "haas-lathe-ngc" && code === 391) {
      if (!modalConflict) state.absolute = false;
    }
    else if (state.liveToolDialect !== "haas-lathe-ngc" && code === 90) state.absolute = true;
    else if (state.liveToolDialect !== "haas-lathe-ngc" && code === 91) state.absolute = false;
    else if (state.liveToolDialect === "haas-lathe-ngc" && code === 91) {
      state.blockCurrentMotionLine = record.line;
      invalidateExecutionState(state);
      warningOnce(warnings, {
        line: record.line,
        code: "haas-g91-position-mode-invalid",
        verificationBlocked: true,
        message: "G91 is not the Haas lathe incremental-position command; execution is blocked. Configure G391 for incremental positioning.",
      });
    }
    else if (state.liveToolDialect === "haas-lathe-ngc" && HAAS_UNSUPPORTED_GROUP_01_MOTIONS.has(code)) {
      state.unsupportedGroup01MotionMode = `G${code}`;
      state.blockCurrentMotionLine = record.line;
      warningOnce(warnings, {
        line: record.line,
        code: `haas-g${code}-cycle-unsupported`,
        verificationBlocked: true,
        message: `G${code} is a Haas Group 01 motion that is not modeled; its modal motion is blocked until a modeled Group 01 motion replaces it.`,
      });
    }
    else if (state.liveToolDialect === "haas-lathe-ngc" && HAAS_UNSUPPORTED_GROUP_09_CYCLES.has(code)) {
      state.unsupportedGroup09MotionMode = `G${code}`;
      state.blockCurrentMotionLine = record.line;
      warningOnce(warnings, {
        line: record.line,
        code: `haas-g${code}-cycle-unsupported`,
        verificationBlocked: true,
        message: `G${code} is a Haas Group 09 canned cycle and is not modeled; its modal motion is blocked until G80 or a documented G00/G01 cancellation.`,
      });
    }
    else if (feedModes.perMinute.includes(code)) state.feedMode = "per-minute";
    else if (feedModes.perRevolution.includes(code)) state.feedMode = "per-revolution";
    else if (code === 96) state.spindleMode = "css";
    else if (code === 97) state.spindleMode = "rpm";
    else if (code === 80) state.unsupportedGroup09MotionMode = null;
    else if (code === 40) state.cutterCompMode = null;
    else if (code === 41 || code === 42) {
      state.cutterCompMode = `G${code}`;
      warningOnce(warnings, {
        line: record.line,
        code: "cutter-compensation-unsupported",
        verificationBlocked: hasMotionWords,
        message: `G${code} cutter compensation is not modeled; affected motion remains blocked until G40.`,
      });
    }
    else if (code === 50) {
      if (hasMotionWords) {
        state.unsupportedCoordinateTransform = "G50 coordinate shift";
        state.blockCurrentMotionLine = record.line;
        warningOnce(warnings, {
          line: record.line,
          code: "g50-coordinate-shift-unsupported",
          verificationBlocked: true,
          message: "G50 with axis words changes the coordinate system; it is not ordinary axis motion, and subsequent coordinates remain unresolved.",
        });
      }
      // G50 S-only spindle limiting is handled below.
    }
    else if (state.liveToolDialect === "haas-lathe-ngc" && code === 65) {
      state.blockCurrentMotionLine = record.line;
      invalidateExecutionState(state);
      warningOnce(warnings, {
        line: record.line,
        code: "unsupported-control-flow-g-code",
        verificationBlocked: true,
        message: "G65 calls a macro subprogram, which is not modeled; execution is blocked at this call boundary.",
      });
    }
    else if (modeledHaasCodes.includes(code)) {
      // G112/G113 transitions are applied after all modal words in the block.
    } else if (![4, 28, 54, 70, 71, 72].includes(code)) {
      const verificationBlocked = state.liveToolDialect === "haas-lathe-ngc" || g112Context || hasMotionWords;
      if (verificationBlocked) state.blockCurrentMotionLine = record.line;
      if (state.liveToolDialect === "haas-lathe-ngc") invalidateExecutionState(state);
      if (g112Context) state.g112PathTainted = true;
      warningOnce(warnings, {
        line: record.line,
        code: "unsupported-g-code",
        verificationBlocked,
        message: `G${code} is not modeled${state.liveToolDialect === "haas-lathe-ngc"
          ? "; its modal or coordinate effects are unknown, so execution is blocked"
          : (verificationBlocked ? "; motion in this block is blocked" : "")}.`,
      });
    }
  }

  const activeCycle = activeUnsupportedMotionMode(state);
  if (hasMotionWords && activeCycle) {
    state.blockCurrentMotionLine = record.line;
    if (g112Context) state.g112PathTainted = true;
    warningOnce(warnings, {
      line: record.line,
      code: "unsupported-modal-cycle-active",
      verificationBlocked: true,
      message: `Motion is blocked while unsupported modal cycle ${activeCycle} remains active.`,
    });
  }
  if (hasMotionWords && state.cutterCompMode) {
    state.blockCurrentMotionLine = record.line;
    if (g112Context) state.g112PathTainted = true;
    warningOnce(warnings, {
      line: record.line,
      code: "cutter-compensation-motion-blocked",
      verificationBlocked: true,
      message: `Motion is blocked while unsupported cutter compensation ${state.cutterCompMode} remains active; cancel it with G40 and re-establish position.`,
    });
  }
  if (hasMotionWords && state.unsupportedCoordinateTransform) {
    state.blockCurrentMotionLine = record.line;
    if (g112Context) state.g112PathTainted = true;
    warningOnce(warnings, {
      line: record.line,
      code: "coordinate-transform-unresolved",
      verificationBlocked: true,
      message: `Motion is blocked because ${state.unsupportedCoordinateTransform} is active and is not modeled.`,
    });
  }

  if (record.byLetter.has("F")) state.feed = interpretedHaasFeedValue(record, state);
  if (record.byLetter.has("S")) {
    if (hasG(record, 50)) state.spindleLimit = lastWord(record, "S");
    else state.spindleSpeed = lastWord(record, "S");
  }
  updateG112Mode(record, state);
}

function applyEndOfBlockMState(record, state, warnings, liveToolEvents, cAxisEvents) {
  const mCodes = record.byLetter.get("M") || [];
  const programEndCode = mCodes.find((code) => code === 2 || code === 30);
  if (state.liveToolDialect === "haas-lathe-ngc" && mCodes.length > 1) {
    invalidateExecutionState(state);
    warningOnce(warnings, {
      line: record.line,
      code: "multiple-m-codes-unsupported",
      verificationBlocked: true,
      message: "The Haas dialect permits only one M code per block; execution is blocked at this ambiguous block.",
    });
    return;
  }
  const liveContext = state.g112Active
    || state.liveToolRunning === true
    || state.cAxisEngaged === true
    || mCodes.some((code) => [133, 134, 154].includes(code));
  for (const code of mCodes) {
    if (code === 2 || code === 30) continue;
    if (!Number.isInteger(code)) {
      invalidateExecutionState(state);
      warningOnce(warnings, {
        line: record.line,
        code: "non-integer-m-code",
        verificationBlocked: true,
        message: `M${code} is not an exact supported M code and was not executed by the model.`,
      });
      continue;
    }
    if (CONTROL_FLOW_M_CODES.has(code)) {
      invalidateExecutionState(state);
      warningOnce(warnings, {
        line: record.line,
        code: "unsupported-control-flow-m-code",
        verificationBlocked: true,
        message: `M${code} changes program control flow, which is not modeled; execution is blocked at this call/return boundary.`,
      });
      continue;
    }
    let handled = false;
    if (code === 3) {
      state.spindleRunning = true;
      state.spindleDirection = "m3";
      handled = true;
    } else if (code === 4) {
      state.spindleRunning = true;
      state.spindleDirection = "m4";
      handled = true;
    } else if (code === 5) {
      state.spindleRunning = false;
      handled = true;
    }
    if (state.liveToolDialect !== "haas-lathe-ngc") {
      if (code === 8 || code === 9) {
        // Coolant state does not alter the bounded centerline geometry model.
        handled = true;
      }
      if (!handled) {
        const liveSpecific = [133, 134, 135, 154, 155].includes(code);
        state.liveToolRunning = null;
        state.cAxisEngaged = null;
        state.turningMode = "unknown";
        if (!liveSpecific) invalidateExecutionState(state);
        warningOnce(warnings, {
          line: record.line,
          code: liveSpecific ? "live-tool-dialect-required" : "unsupported-m-code",
          verificationBlocked: true,
          message: liveSpecific
            ? `M${code} is machine-builder-specific and cannot be interpreted until a live-tool controller dialect is configured.`
            : `M${code} is not modeled for the selected controller; its machine-state or control-flow effects are unknown, so execution is blocked.`,
        });
      }
      continue;
    }
    if (code === 133 || code === 134) {
      handled = true;
      state.turningMode = "live-tool";
      const speed = lastWord(record, "P");
      state.liveToolDirection = code === 133 ? "m133" : "m134";
      state.liveToolSpeed = Number.isFinite(speed) && speed > 0 ? speed : null;
      const capabilityReady = state.liveToolCapability === "equipped";
      state.liveToolRunning = capabilityReady && state.liveToolSpeed !== null ? true : null;
      state.liveToolSpeedOverLimit = Number.isFinite(state.liveToolMaxRpm)
        && state.liveToolSpeed > state.liveToolMaxRpm;
      if (!capabilityReady) {
        state.turningMode = "unknown";
        state.executionBlocked = true;
        warningOnce(warnings, {
          line: record.line,
          code: "live-tool-capability-required",
          verificationBlocked: true,
          message: `M${code} requires live-tool capability "equipped"; configured value is "${state.liveToolCapability}", so execution is blocked at this command.`,
        });
      }
      if (state.liveToolSpeed === null) {
        state.executionBlocked = true;
        warningOnce(warnings, {
          line: record.line,
          code: "live-tool-rpm-required",
          verificationBlocked: true,
          message: `M${code} needs a positive P live-tool RPM; live-tool motion is blocked.`,
        });
      }
      if (state.liveToolSpeedOverLimit) {
        state.executionBlocked = true;
        warningOnce(warnings, {
          line: record.line,
          code: "live-tool-rpm-over-limit",
          verificationBlocked: true,
          message: `M${code} commands ${state.liveToolSpeed} RPM, above the configured ${state.liveToolMaxRpm} RPM live-tool limit.`,
        });
      }
      liveToolEvents.push({
        line: record.line,
        direction: state.liveToolDirection,
        running: state.liveToolRunning,
        speed: state.liveToolSpeed,
        phase: "end-of-block",
        command: `M${code}`,
      });
    } else if (code === 135) {
      handled = true;
      state.liveToolRunning = false;
      liveToolEvents.push({
        line: record.line,
        direction: state.liveToolDirection,
        running: false,
        speed: state.liveToolSpeed,
        phase: "end-of-block",
        command: "M135",
      });
    } else if (code === 154 || code === 155) {
      handled = true;
      const engaging = code === 154;
      if (state.cAxisCapability === "available") {
        state.cAxisEngaged = engaging;
        state.cAxisEngagementSource = "command";
        state.turningMode = engaging ? "live-tool" : "turning";
      } else {
        invalidateExecutionState(state);
        warningOnce(warnings, {
          line: record.line,
          code: "c-axis-capability-required",
          verificationBlocked: true,
          message: `M${code} cannot be verified because C-axis capability is ${state.cAxisCapability}.`,
        });
      }
      cAxisEvents.push({
        line: record.line,
        engaged: state.cAxisEngaged,
        phase: "end-of-block",
        command: `M${code}`,
      });
    } else if (code === 8 || code === 9) {
      // Coolant on/off is semantically neutral to the bounded spindle/C-axis
      // model and appears in Haas' documented G112 example.
      handled = true;
    }
    if (!handled) {
      invalidateExecutionState(state);
      const liveSpecific = liveContext || [14, 15, 19].includes(code);
      warningOnce(warnings, {
        line: record.line,
        code: liveSpecific ? "unsupported-live-m-code" : "unsupported-haas-m-code",
        verificationBlocked: true,
        message: `M${code} is not modeled in the bounded Haas implementation; its machine-state effects are unknown, so execution is blocked.`,
      });
    }
  }
  if (programEndCode !== undefined) {
    state.spindleRunning = false;
    state.liveToolRunning = false;
    state.cAxisEngaged = false;
    state.turningMode = "stopped";
    state.programEnded = true;
    if (state.liveToolDialect === "haas-lathe-ngc") {
      liveToolEvents.push({
        line: record.line,
        direction: state.liveToolDirection,
        running: false,
        speed: state.liveToolSpeed,
        phase: "end-of-block",
        command: `M${programEndCode.toString().padStart(2, "0")}`,
        reason: "program-end",
      });
    }
  }
}

function programSpindleEvents(records, definitionIndexes, liveToolDialect, semanticExecutionStopIndex = -1) {
  const events = [];
  let direction = "unknown";
  let running = null;
  for (const record of records) {
    if (!record.byLetter.size || definitionIndexes.has(record.index)) continue;
    if (semanticExecutionStopIndex >= 0 && record.index >= semanticExecutionStopIndex) {
      events.push({line: record.line, direction, running: null, reason: "execution-blocked"});
      break;
    }
    const mCodes = record.byLetter.get("M") || [];
    if (hasExecutionBoundary(record, liveToolDialect)) {
      running = null;
      events.push({line: record.line, direction, running});
      break;
    }
    const hasProgramEnd = mCodes.some((code) => code === 2 || code === 30);
    const beforeDirection = direction;
    const beforeRunning = running;
    for (const code of mCodes) {
      if (code === 3) {
        direction = "m3";
        running = true;
      } else if (code === 4) {
        direction = "m4";
        running = true;
      } else if (code === 5) {
        running = false;
      }
    }
    if (hasProgramEnd) running = false;
    if (direction !== beforeDirection || running !== beforeRunning || hasProgramEnd) {
      events.push({
        line: record.line,
        direction,
        running,
        ...(hasProgramEnd ? {
          command: `M${mCodes.find((code) => code === 2 || code === 30).toString().padStart(2, "0")}`,
          reason: "program-end",
        } : {}),
      });
    }
    if (hasProgramEnd) break;
  }
  return events;
}

function cAxisReadiness(record, state, warnings, {
  requireStoppedMain = false,
  spindleCode = "c-axis-main-spindle-not-stopped",
  spindleMessage = "C-axis motion is blocked until the main spindle is known stopped with M5.",
} = {}) {
  const issues = [];
  const add = (code, message) => {
    issues.push(code);
    warningOnce(warnings, {line: record.line, code, verificationBlocked: true, message});
  };
  if (state.cAxisCapability !== "available") {
    add("c-axis-capability-required", `C-axis motion requires capability "available"; configured value is "${state.cAxisCapability}".`);
  }
  if (requireStoppedMain && state.spindleRunning !== false) add(spindleCode, spindleMessage);
  if (state.cAxisEngagementMode === "automatic") {
    if (state.cAxisCapability === "available" && (!requireStoppedMain || state.spindleRunning === false)) {
      state.cAxisEngaged = true;
      state.cAxisEngagementSource = "automatic";
    }
  } else if (state.cAxisEngagementMode === "required") {
    if (state.cAxisEngaged !== true) add("c-axis-not-engaged", "C-axis motion is blocked until M154 has engaged the C axis.");
  } else {
    add("c-axis-engagement-unknown", "C-axis motion is blocked because the machine profile does not define whether engagement is automatic or requires M154.");
  }
  return issues;
}

function parseDirectCAxis(record, state, warnings, cAxisMotions) {
  if (state.g112Active) return {present: false, blocked: false};
  const hasC = record.byLetter.has("C");
  const hasH = record.byLetter.has("H");
  if (!hasC && !hasH) return {present: false, blocked: false};
  const start = state.cAxisPosition;
  const startUncertaintyDegrees = state.cAxisPositionUncertaintyDegrees;
  let end = start;
  let endUncertaintyDegrees = startUncertaintyDegrees;
  if (hasC && hasH) {
    end = null;
    endUncertaintyDegrees = null;
  } else if (hasC) {
    const cAddress = rotaryPositionAddress(record, "C", state);
    // Haas documents C as the absolute rotary-position address and H as its
    // incremental alternative. G390/G391 govern linear positioning; they do
    // not turn C into the H-style incremental address.
    end = cAddress.value;
    endUncertaintyDegrees = cAddress.uncertaintyDegrees;
  } else if (hasH) {
    const hAddress = rotaryPositionAddress(record, "H", state);
    end = Number.isFinite(start) ? start + hAddress.value : null;
    endUncertaintyDegrees = Number.isFinite(end) ? boundedUncertaintySum(
      requiredUncertainty(startUncertaintyDegrees),
      hAddress.uncertaintyDegrees,
      arithmeticUncertainty(start, hAddress.value, end),
    ) : null;
  }
  const block = (issues) => {
    const verificationIssues = [...new Set(issues)];
    const event = {
      line: record.line,
      type: state.motion === "rapid" ? "rapid-index" : "interpolated-index",
      start: Number.isFinite(start) ? start : null,
      end: Number.isFinite(end) ? end : null,
      geometryUncertaintyDegrees: Number.isFinite(endUncertaintyDegrees) ? endUncertaintyDegrees : null,
      engaged: state.cAxisEngaged,
      engagementSource: state.cAxisEngagementSource,
      combinedWithLinearAxes: false,
      blocked: true,
      reason: verificationIssues[0] || "c-axis-motion-unresolved",
      verificationIssues,
    };
    cAxisMotions?.push(event);
    invalidateUnsupportedPosition(record, state);
    return {present: true, blocked: true, start, end, event};
  };
  if (state.liveToolDialect !== "haas-lathe-ngc") {
    warningOnce(warnings, {
      line: record.line,
      code: "c-axis-dialect-required",
      verificationBlocked: true,
      message: "C-axis motion is blocked until a controller-specific live-tool dialect is configured.",
    });
    return block(["c-axis-dialect-required"]);
  }

  const ambiguousAddresses = ambiguousHaasIntegerAddresses(record, state, ["C", "H"]);
  if (ambiguousAddresses.length) {
    warningOnce(warnings, {
      line: record.line,
      code: "haas-integer-axis-ambiguous",
      verificationBlocked: true,
      message: `${ambiguousAddresses.join("/")} integer input depends on Haas Setting 162 (Default To Float). Configure that setting or include an explicit decimal point.`,
    });
    return block(["haas-integer-axis-ambiguous"]);
  }

  if (hasC && hasH) {
    warningOnce(warnings, {
      line: record.line,
      code: "c-axis-absolute-incremental-conflict",
      verificationBlocked: true,
      message: "C (absolute rotary position) and H (incremental rotary motion) cannot be commanded in the same Haas block; C-axis position is unresolved.",
    });
    return block(["c-axis-absolute-incremental-conflict"]);
  }

  if (state.motion !== "rapid") {
    warningOnce(warnings, {
      line: record.line,
      code: "direct-c-interpolation-unsupported",
      verificationBlocked: true,
      message: "Interpolated C-axis motion is not modeled directly; use a supported G112 face path or rapid C indexing.",
    });
    return block(["direct-c-interpolation-unsupported"]);
  }

  const issues = cAxisReadiness(record, state, warnings, {requireStoppedMain: true});
  if (!Number.isFinite(end)) {
    const code = "c-axis-position-unknown";
    issues.push(code);
    warningOnce(warnings, {
      line: record.line,
      code,
      verificationBlocked: true,
      message: "Incremental C/H indexing is blocked until the C-axis position is known.",
    });
  }
  let event = null;
  if (!issues.length && Number.isFinite(end)) {
    state.cAxisPosition = end;
    state.cAxisPositionUncertaintyDegrees = endUncertaintyDegrees;
    event = {
      line: record.line,
      type: "rapid-index",
      start: Number.isFinite(start) ? start : null,
      end,
      geometryUncertaintyDegrees: endUncertaintyDegrees,
      engaged: state.cAxisEngaged,
      engagementSource: state.cAxisEngagementSource,
      combinedWithLinearAxes: false,
    };
    cAxisMotions?.push(event);
  } else if (issues.length) return block(issues);
  return {present: true, blocked: issues.length > 0, start, end, event};
}

function facePointKnown(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y) && Number.isFinite(point?.z);
}

function facePathTouchesCenter(start, end, geometryUncertaintyMm = 0) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const centerTolerance = boundedUncertaintySum(EPSILON, geometryUncertaintyMm);
  if (lengthSquared < EPSILON * EPSILON) return Math.hypot(start.x, start.y) <= centerTolerance;
  const projection = Math.max(0, Math.min(1, -(start.x * dx + start.y * dy) / lengthSquared));
  return Math.hypot(start.x + projection * dx, start.y + projection * dy) <= centerTolerance;
}

function g112Readiness(record, state, warnings) {
  const issues = cAxisReadiness(record, state, warnings, {
    requireStoppedMain: true,
    spindleCode: "g112-main-spindle-not-stopped",
    spindleMessage: "G112 face motion is blocked until the main spindle is known stopped with M5.",
  });
  const add = (code, message) => {
    issues.push(code);
    warningOnce(warnings, {line: record.line, code, verificationBlocked: true, message});
  };
  if (state.liveToolCapability !== "equipped") {
    add("live-tool-capability-required", `G112 motion requires live-tool capability "equipped"; configured value is "${state.liveToolCapability}".`);
  }
  if (state.plane !== "G17") add("g112-requires-g17", `G112 face motion requires G17; active plane is ${state.plane}.`);
  if (state.feedMode !== "per-minute") add("g112-requires-g98", "G112 face motion requires G98 feed per minute on the configured Haas lathe dialect.");
  if (state.liveToolRunning !== true || !(state.liveToolSpeed > 0)) {
    add("g112-live-tool-not-running", "G112 face motion is blocked until M133/M134 starts the live tool with a positive P RPM.");
  }
  if (state.liveToolSpeedOverLimit) {
    add("live-tool-rpm-over-limit", `The commanded live-tool speed exceeds the configured ${state.liveToolMaxRpm} RPM limit.`);
  }
  return issues;
}

function resolveG112End(record, state) {
  const resolve = (letter, current, currentUncertaintyMm) => resolvedPositionCoordinate(
    current,
    currentUncertaintyMm,
    record.byLetter.has(letter) ? scaledPositionAddress(record, letter, state) : null,
    state.absolute,
  );
  const x = resolve("X", state.faceX, state.faceXUncertaintyMm);
  const y = resolve("Y", state.faceY, state.faceYUncertaintyMm);
  const z = resolve("Z", state.faceZ, state.faceZUncertaintyMm);
  return {
    point: {x: x.value, y: y.value, z: z.value},
    uncertaintyMm: {x: x.uncertaintyMm, y: y.uncertaintyMm, z: z.uncertaintyMm},
  };
}

function acceptG112End(state, resolution) {
  const end = resolution.point;
  const uncertaintyMm = resolution.uncertaintyMm;
  state.faceX = end.x;
  state.faceY = end.y;
  state.faceZ = end.z;
  state.faceXUncertaintyMm = uncertaintyMm.x;
  state.faceYUncertaintyMm = uncertaintyMm.y;
  state.faceZUncertaintyMm = uncertaintyMm.z;
  if (Number.isFinite(end.x) && Number.isFinite(end.y)) {
    const radius = Math.hypot(end.x, end.y);
    const radiusCoordinateScale = state.xMode === "diameter" ? 0.5 : 1;
    const radialPositionUncertaintyMm = Math.hypot(
      requiredUncertainty(uncertaintyMm.x),
      requiredUncertainty(uncertaintyMm.y),
    );
    const radiusUncertaintyMm = boundedUncertaintySum(
      radialPositionUncertaintyMm,
      numericUncertainty(radius, POSITION_OPERATION_ULPS),
    );
    state.x = radius / radiusCoordinateScale;
    state.xUncertaintyMm = boundedUncertaintySum(
      radiusUncertaintyMm / radiusCoordinateScale,
      arithmeticUncertainty(radius, radiusCoordinateScale, state.x),
    );
    if (radius > EPSILON) {
      const angleRadians = Math.atan2(end.y, end.x);
      state.cAxisPosition = angleRadians * 180 / Math.PI;
      const directionalUncertaintyRadians = radialPositionUncertaintyMm < radius
        ? Math.asin(Math.min(1, radialPositionUncertaintyMm / radius))
        : Number.MAX_VALUE;
      state.cAxisPositionUncertaintyDegrees = boundedUncertaintySum(
        directionalUncertaintyRadians * 180 / Math.PI,
        numericUncertainty(angleRadians, POSITION_OPERATION_ULPS) * 180 / Math.PI,
        arithmeticUncertainty(angleRadians, 180, Math.PI, state.cAxisPosition),
      );
    } else {
      state.cAxisPosition = null;
      state.cAxisPositionUncertaintyDegrees = null;
    }
  }
  if (Number.isFinite(end.z)) {
    state.z = end.z;
    state.zUncertaintyMm = uncertaintyMm.z;
  }
}

function parseG112Record(record, state, warnings) {
  const hasX = record.byLetter.has("X");
  const hasY = record.byLetter.has("Y");
  const hasZ = record.byLetter.has("Z");
  const hasC = record.byLetter.has("C") || record.byLetter.has("H");
  const hasUnsupportedIncremental = record.byLetter.has("U") || record.byLetter.has("W");
  const unsupportedGeometryWords = ["I", "J", "K", "R"].filter((letter) => record.byLetter.has(letter));
  const priorTainted = state.g112PathTainted;
  if (unsupportedGeometryWords.length) {
    warningOnce(warnings, {
      line: record.line,
      code: "g112-motion-parameter-unsupported",
      verificationBlocked: true,
      message: `${unsupportedGeometryWords.join("/")} motion parameters are not modeled for bounded G112 G0/G1 face paths; the move is blocked.`,
    });
    state.g112PathTainted = true;
    return null;
  }
  if (hasUnsupportedIncremental) {
    warningOnce(warnings, {
      line: record.line,
      code: "g112-incremental-axis-unsupported",
      verificationBlocked: true,
      message: "The bounded G112 implementation accepts explicit X/Y/Z face coordinates only; U/W motion is blocked.",
    });
    state.g112PathTainted = true;
    return null;
  }
  if (hasC) {
    warningOnce(warnings, {
      line: record.line,
      code: "g112-c-word-forbidden",
      verificationBlocked: true,
      message: "C/H words are forbidden while G112 XY-to-XC interpolation is active.",
    });
    state.cAxisPosition = null;
    state.cAxisPositionUncertaintyDegrees = null;
    state.g112PathTainted = true;
  }
  if (!hasX && !hasY && !hasZ) return null;
  if (!state.sawUnitMode) state.assumedUnitsUsed = true;

  const ambiguousAddresses = ambiguousHaasIntegerAddresses(record, state, ["X", "Y", "Z"]);
  if (ambiguousAddresses.length) {
    warningOnce(warnings, {
      line: record.line,
      code: "haas-integer-axis-ambiguous",
      verificationBlocked: true,
      message: `${ambiguousAddresses.join("/")} integer input depends on Haas Setting 162 (Default To Float). Configure that setting or include an explicit decimal point.`,
    });
    state.g112PathTainted = true;
    return null;
  }

  const start = {x: state.faceX, y: state.faceY, z: state.faceZ};
  const startUncertaintyMm = {
    x: state.faceXUncertaintyMm,
    y: state.faceYUncertaintyMm,
    z: state.faceZUncertaintyMm,
  };
  const endResolution = resolveG112End(record, state);
  const end = endResolution.point;
  const endUncertaintyMm = endResolution.uncertaintyMm;
  const geometryUncertaintyMm = Math.max(
    facePointUncertaintyMm(startUncertaintyMm),
    facePointUncertaintyMm(endUncertaintyMm),
  );
  const numericalResolutionBlocked = geometryUncertaintyMm > PROFILE_NUMERICAL_BUDGET_MM;
  const reportNumericalResolution = () => {
    if (warnings.some((warning) => warning.code === "g112-numerical-resolution")) return;
    warningOnce(warnings, {
      line: record.line,
      code: "g112-numerical-resolution",
      verificationBlocked: true,
      message: "G112 face-coordinate arithmetic cannot retain the required 0.00005 in numerical budget; affected motion is display-only and verification is blocked.",
    });
  };
  const readinessIssues = g112Readiness(record, state, warnings);
  const wasTainted = priorTainted;
  const resynchronizes = state.absolute && state.motion === "rapid" && hasX && hasY && hasZ
    && facePointKnown(end) && readinessIssues.length === 0 && !hasC
    && facePointUncertaintyMm(endUncertaintyMm) <= PROFILE_NUMERICAL_BUDGET_MM;

  const motionBlocker = activeMotionBlocker(state);
  if (state.blockCurrentMotionLine === record.line || motionBlocker
    || (state.motion !== "rapid" && state.motion !== "linear")) {
    const mode = state.blockCurrentMotionLine === record.line
      ? "an unsupported code in this block"
      : (motionBlocker || state.motion);
    warningOnce(warnings, {
      line: record.line,
      code: "g112-motion-unsupported",
      verificationBlocked: true,
      message: `${mode} is not modeled in the bounded G112 implementation; only G0/G1 face paths are supported.`,
    });
    acceptG112End(state, endResolution);
    state.g112PathTainted = true;
    return null;
  }
  // In Haas G112, programmed X is a radius coordinate even when ordinary
  // turning X is configured as diameter. Y is the virtual linear face axis.
  acceptG112End(state, endResolution);

  if (!facePointKnown(end)) {
    if (state.motion === "rapid") {
      warningOnce(warnings, {
        line: record.line,
        code: "g112-position-unknown",
        info: true,
        message: "G112 face position is waiting for a complete absolute G0 X/Y/Z baseline.",
      });
    } else {
      warningOnce(warnings, {
        line: record.line,
        code: "g112-cut-from-unknown-position",
        verificationBlocked: true,
        message: "G112 cutting motion cannot establish a verified starting position; use a complete absolute G0 X/Y/Z baseline first.",
      });
    }
    state.g112PathTainted = true;
    return null;
  }
  if (!facePointKnown(start)) {
    if (resynchronizes) {
      warningOnce(warnings, {
        line: record.line,
        code: "g112-position-established",
        info: true,
        message: "G112 face position was established by a complete absolute G0 X/Y/Z; no approach from an unknown position was drawn.",
      });
      state.g112PathTainted = false;
      state.turningPathTainted = false;
    } else {
      if (numericalResolutionBlocked) reportNumericalResolution();
      warningOnce(warnings, {
        line: record.line,
        code: state.motion === "rapid" ? "g112-position-establishment-unverified" : "g112-cut-from-unknown-position",
        verificationBlocked: true,
        message: state.motion === "rapid"
          ? "Only a complete, ready, absolute G0 X/Y/Z can establish a verified G112 face baseline."
          : "G112 cutting motion cannot establish a verified starting position; use a complete absolute G0 X/Y/Z baseline first.",
      });
      state.g112PathTainted = true;
    }
    return null;
  }
  if (wasTainted && resynchronizes) {
    warningOnce(warnings, {
      line: record.line,
      code: "g112-position-resynchronized",
      info: true,
      message: "A complete absolute G0 X/Y/Z re-established the G112 face baseline; the unresolved incoming path was not drawn.",
    });
    state.g112PathTainted = false;
    state.turningPathTainted = false;
    return null;
  }
  if (Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) < EPSILON) {
    if (numericalResolutionBlocked) reportNumericalResolution();
    state.g112PathTainted = priorTainted || hasC || numericalResolutionBlocked;
    return null;
  }

  const issues = [...readinessIssues];
  if (numericalResolutionBlocked) {
    issues.push("g112-numerical-resolution");
    reportNumericalResolution();
  }
  if (wasTainted) {
    issues.push("g112-prior-path-unresolved");
    warningOnce(warnings, {
      line: record.line,
      code: "g112-prior-path-unresolved",
      verificationBlocked: true,
      message: "This G112 move depends on a prior blocked or unsupported face move and remains unresolved.",
    });
  }
  if (hasC) issues.push("g112-c-word-forbidden");
  const centerCrossingUncertaintyMm = Math.max(
    Math.hypot(
      requiredUncertainty(startUncertaintyMm.x),
      requiredUncertainty(startUncertaintyMm.y),
    ),
    Math.hypot(
      requiredUncertainty(endUncertaintyMm.x),
      requiredUncertainty(endUncertaintyMm.y),
    ),
  );
  if (facePathTouchesCenter(start, end, centerCrossingUncertaintyMm)) {
    issues.push("g112-center-crossing");
    warningOnce(warnings, {
      line: record.line,
      code: "g112-center-crossing",
      verificationBlocked: true,
      message: "G112 face path reaches or crosses spindle center; verification is blocked.",
    });
  }
  const currentIssues = issues.filter((issue) => issue !== "g112-prior-path-unresolved");
  state.g112PathTainted = currentIssues.length > 0 || (wasTainted && !resynchronizes);
  return {
    type: state.motion,
    start,
    end,
    points: [start, end],
    line: record.line,
    raw: record.raw.trim(),
    ...timingSnapshot(state),
    toolKey: state.activeToolKey,
    toolCallLine: state.activeToolCallLine,
    liveTool: true,
    machiningMode: "live-tool",
    coordinateMode: "g112-face",
    xCoordinateMode: "radius",
    plane: "G17",
    geometryUncertaintyMm,
    coordinateUncertaintyMm: {
      start: {
        x: requiredUncertainty(startUncertaintyMm.x),
        y: requiredUncertainty(startUncertaintyMm.y),
        z: requiredUncertainty(startUncertaintyMm.z),
      },
      end: {
        x: requiredUncertainty(endUncertaintyMm.x),
        y: requiredUncertainty(endUncertaintyMm.y),
        z: requiredUncertainty(endUncertaintyMm.z),
      },
    },
    verificationBlocked: issues.length > 0,
    verificationIssues: [...new Set(issues)],
  };
}

function blockedSameEndpointArcSegment(segment, record, warnings) {
  const sourceMotion = segment.sourceMotion || segment.type;
  warningOnce(warnings, {
    line: record.line,
    code: "same-endpoint-arc-unsupported",
    verificationBlocked: true,
    message: "Same-endpoint or sub-resolution G02/G03 arc intent is not modeled; the attempted motion is retained as blocked instead of being ignored.",
  });
  return {
    ...segment,
    type: "linear",
    sourceMotion,
    verificationBlocked: true,
    verificationIssues: [...new Set([
      ...(segment.verificationIssues || []),
      "same-endpoint-arc-unsupported",
    ])],
  };
}

function parseBasicRecord(record, state, xMode, warnings, {
  executeToolCall = true,
  liveToolEvents = null,
  cAxisMotions = null,
} = {}) {
  if (executeToolCall) applyRecordToolCall(record, state, liveToolEvents);
  if (!validateHaasRecordAddresses(record, state, warnings)) {
    invalidateUnsupportedPosition(record, state);
    return null;
  }
  if (!record.byLetter.size) return null;
  updateModalState(record, state, warnings);
  if (state.g112Active || state.unconfiguredG112Active) noteLiveToolAttempt(record, state);
  if (state.g112Active) return parseG112Record(record, state, warnings);
  if (state.unconfiguredG112Active) {
    warningOnce(warnings, {
      line: record.line,
      code: "unconfigured-g112-active",
      verificationBlocked: true,
      message: "Motion remains blocked because G112 was entered without a supported controller dialect; cancel it with G113 and re-establish position.",
    });
    invalidateUnsupportedPosition(record, state);
    return null;
  }

  if (state.blockCurrentMotionLine === record.line || activeMotionBlocker(state)) {
    invalidateUnsupportedPosition(record, state);
    return null;
  }
  const basicMotionContext = [0, 1].some((code) => hasG(record, code))
    || ["X", "Y", "Z", "U", "W", "C", "H"].some((letter) => record.byLetter.has(letter));
  const cycleOrSpecialRecord = [4, 28, 70, 71, 72].some((code) => hasG(record, code));
  const arcMotion = state.motion === "arc-cw" || state.motion === "arc-ccw";
  const unsupportedLinearGeometryWords = [
    "I", "J", "K", "R",
    ...(!cycleOrSpecialRecord && basicMotionContext ? ["D", "P", "Q"] : []),
  ].filter((letter) => record.byLetter.has(letter));
  if (["rapid", "linear"].includes(state.motion) && unsupportedLinearGeometryWords.length) {
    warningOnce(warnings, {
      line: record.line,
      code: "linear-corner-geometry-unsupported",
      verificationBlocked: true,
      message: `${state.motion === "linear" ? "G01" : "G00"} ${unsupportedLinearGeometryWords.join("/")} corner or auxiliary geometry is not modeled; execution is blocked instead of drawing a sharp or incomplete path.`,
    });
    invalidateUnsupportedPosition(record, state);
    state.turningPathTainted = true;
    if (state.liveToolDialect === "haas-lathe-ngc") invalidateExecutionState(state);
    return null;
  }
  const unsupportedArcGeometryWords = [
    "J",
    ...(!cycleOrSpecialRecord && basicMotionContext ? ["D", "P", "Q"] : []),
  ].filter((letter) => record.byLetter.has(letter));
  if (arcMotion && unsupportedArcGeometryWords.length) {
    warningOnce(warnings, {
      line: record.line,
      code: "turning-arc-parameter-unsupported",
      verificationBlocked: true,
      message: `G02/G03 ${unsupportedArcGeometryWords.join("/")} geometry is not modeled in the X/Z turning plane; execution is blocked instead of dropping the word.`,
    });
    invalidateUnsupportedPosition(record, state);
    state.turningPathTainted = true;
    if (state.liveToolDialect === "haas-lathe-ngc") invalidateExecutionState(state);
    return null;
  }
  if (record.byLetter.has("Y")) {
    warningOnce(warnings, {
      line: record.line,
      code: "direct-y-interpolation-unsupported",
      verificationBlocked: true,
      message: "Direct Y-axis motion outside G112 is not modeled and is blocked.",
    });
    invalidateUnsupportedPosition(record, state);
    return null;
  }
  if (record.byLetter.has("U") || record.byLetter.has("W")) {
    const aliases = [
      record.byLetter.has("X") && record.byLetter.has("U") ? "X/U" : null,
      record.byLetter.has("Z") && record.byLetter.has("W") ? "Z/W" : null,
    ].filter(Boolean);
    warningOnce(warnings, {
      line: record.line,
      code: aliases.length ? "absolute-incremental-axis-conflict" : "incremental-axis-motion-unsupported",
      verificationBlocked: true,
      message: aliases.length
        ? `${aliases.join(" and ")} cannot be commanded together in one Haas motion block.`
        : "U/W incremental motion outside the explicitly modeled G28 and G71/G72 forms is not supported and is blocked.",
    });
    invalidateUnsupportedPosition(record, state);
    return null;
  }

  if (arcMotion && state.plane !== "G18") {
    warningOnce(warnings, {
      line: record.line,
      code: "turning-plane-unsupported",
      verificationBlocked: true,
      message: `G02/G03 X/Z arc geometry is blocked while ${state.plane} is active; select G18.`,
    });
    invalidateUnsupportedPosition(record, state);
    state.turningPathTainted = true;
    if (state.liveToolDialect === "haas-lathe-ngc") invalidateExecutionState(state);
    return null;
  }
  const implicitTurningArcPlane = arcMotion && !state.sawPlane;
  if (implicitTurningArcPlane) {
    warningOnce(warnings, {
      line: record.line,
      code: "turning-plane-required",
      verificationBlocked: true,
      message: "G18 was not present before this arc; its assumed X/Z geometry is retained only as a blocked path.",
    });
  }

  const cAxis = parseDirectCAxis(record, state, warnings, cAxisMotions);
  if (cAxis.blocked) return null;
  const hasX = record.byLetter.has("X");
  const hasZ = record.byLetter.has("Z");
  if (!hasX && !hasZ) {
    const hasArcIntent = hasG(record, 2)
      || hasG(record, 3)
      || record.byLetter.has("I")
      || record.byLetter.has("K")
      || record.byLetter.has("R");
    if (arcMotion && hasArcIntent) {
      const point = {x: state.x, z: state.z};
      const pointUncertaintyMm = physicalPointUncertaintyMm(
        {x: state.xUncertaintyMm, z: state.zUncertaintyMm},
        xMode === "diameter" ? 0.5 : 1,
      );
      return blockedSameEndpointArcSegment({
        type: state.motion,
        start: {...point},
        end: {...point},
        points: isKnownPoint(point) ? [{...point}, {...point}] : [],
        line: record.line,
        raw: record.raw.trim(),
        ...timingSnapshot(state),
        toolKey: state.activeToolKey,
        toolCallLine: state.activeToolCallLine,
        geometryUncertaintyMm: pointUncertaintyMm,
        coordinateUncertaintyMm: {
          start: {
            x: (Number(state.xUncertaintyMm) || 0) * (xMode === "diameter" ? 0.5 : 1),
            z: Number(state.zUncertaintyMm) || 0,
          },
          end: {
            x: (Number(state.xUncertaintyMm) || 0) * (xMode === "diameter" ? 0.5 : 1),
            z: Number(state.zUncertaintyMm) || 0,
          },
        },
        verificationBlocked: false,
        verificationIssues: [],
      }, record, warnings);
    }
    return null;
  }
  if (state.liveToolDialect === "haas-lathe-ngc" && state.plane !== "G18") {
    warningOnce(warnings, {
      line: record.line,
      code: "turning-plane-unsupported",
      verificationBlocked: true,
      message: `X/Z turning motion is blocked while ${state.plane} is active outside G112; select G18.`,
    });
    if (cAxis.event) {
      cAxis.event.blocked = true;
      cAxis.event.reason = "turning-plane-unsupported";
    }
    invalidateUnsupportedPosition(record, state);
    return null;
  }
  const verificationIssues = [];
  if (implicitTurningArcPlane) verificationIssues.push("turning-plane-required");
  const liveStateActive = state.turningMode !== "turning"
    || state.liveToolRunning === true
    || (state.cAxisEngaged === true && !cAxis.event);
  if (liveStateActive) {
    const code = state.turningMode === "unknown" ? "machining-mode-unresolved" : "turning-mode-not-selected";
    verificationIssues.push(code);
    warningOnce(warnings, {
      line: record.line,
      code,
      verificationBlocked: true,
      message: state.turningMode === "unknown"
        ? "X/Z motion is blocked because a prior live-tool/C-axis command left the machining mode unresolved."
        : "X/Z turning motion is blocked while live-tool/C-axis mode is active; stop the live drive and select turning mode with M155.",
    });
    noteLiveToolAttempt(record, state, state.motion);
  }
  if (state.liveToolDialect === "haas-lathe-ngc" && state.motion !== "rapid" && state.spindleRunning !== true) {
    verificationIssues.push("turning-main-spindle-not-running");
    warningOnce(warnings, {
      line: record.line,
      code: "turning-main-spindle-not-running",
      verificationBlocked: true,
      message: "Haas X/Z cutting motion is blocked until the main spindle is known running with M3 or M4; live-tool spindle state does not satisfy this requirement.",
    });
  }
  if (state.liveToolDialect === "haas-lathe-ngc" && state.motion !== "rapid"
    && !(state.spindleSpeed > 0)) {
    verificationIssues.push("turning-main-spindle-speed-required");
    warningOnce(warnings, {
      line: record.line,
      code: "turning-main-spindle-speed-required",
      verificationBlocked: true,
      message: "Haas X/Z cutting motion is blocked until a positive main-spindle S command is known; M3/M4 alone or S0 cannot prove cutting rotation.",
    });
  }
  if (!state.sawUnitMode) state.assumedUnitsUsed = true;
  const wasTurningPathTainted = state.turningPathTainted;
  const xCoordinateScale = xMode === "diameter" ? 0.5 : 1;
  const start = {x: state.x, z: state.z};
  const startAxisUncertainty = {x: state.xUncertaintyMm, z: state.zUncertaintyMm};
  const xAddress = hasX ? scaledPositionAddress(record, "X", state) : null;
  const zAddress = hasZ ? scaledPositionAddress(record, "Z", state) : null;
  const resolvedX = resolvedPositionCoordinate(state.x, state.xUncertaintyMm, xAddress, state.absolute);
  const resolvedZ = resolvedPositionCoordinate(state.z, state.zUncertaintyMm, zAddress, state.absolute);
  const end = {x: resolvedX.value, z: resolvedZ.value};
  const endAxisUncertainty = {x: resolvedX.uncertaintyMm, z: resolvedZ.uncertaintyMm};
  state.x = end.x;
  state.z = end.z;
  state.xUncertaintyMm = endAxisUncertainty.x;
  state.zUncertaintyMm = endAxisUncertainty.z;
  const startPositionUncertaintyMm = physicalPointUncertaintyMm(startAxisUncertainty, xCoordinateScale);
  const endPositionUncertaintyMm = physicalPointUncertaintyMm(endAxisUncertainty, xCoordinateScale);
  const turningResynchronizes = wasTurningPathTainted
    && state.absolute
    && state.motion === "rapid"
    && hasX
    && hasZ
    && !cAxis.present
    && verificationIssues.length === 0
    && isKnownPoint(end)
    && endPositionUncertaintyMm <= PROFILE_NUMERICAL_BUDGET_MM;
  if (turningResynchronizes) {
    state.turningPathTainted = false;
    warningOnce(warnings, {
      line: record.line,
      code: "turning-position-resynchronized",
      info: true,
      message: "A complete absolute G0 X/Z re-established the turning baseline; the unresolved incoming path was not drawn.",
    });
    return null;
  }
  if (wasTurningPathTainted) {
    verificationIssues.push("turning-position-resync-required");
    warningOnce(warnings, {
      line: record.line,
      code: "turning-position-resync-required",
      verificationBlocked: true,
      message: "Turning motion remains blocked after unresolved G112 positioning until a complete, verification-clear absolute G0 X/Z re-establishes the baseline.",
    });
  }
  if (!isKnownPoint(end)) {
    if (state.motion === "rapid") {
      warnings.push({line: record.line, info: true, message: "Motion is waiting for both X and Z to become known."});
    } else {
      state.turningPathTainted = true;
      warningOnce(warnings, {
        line: record.line,
        code: "turning-cut-from-unknown-position",
        verificationBlocked: true,
        message: "G01/G02/G03 cutting motion has an incomplete X/Z endpoint and cannot establish a verified path; use a complete absolute G0 X/Z baseline.",
      });
    }
    return null;
  }
  if (!isKnownPoint(start)) {
    if (!wasTurningPathTainted && state.motion === "rapid") {
      warnings.push({line: record.line, info: true, message: `Position established at X${(end.x / state.scale).toFixed(4)} Z${(end.z / state.scale).toFixed(4)}; no invented approach was drawn.`});
    } else if (!wasTurningPathTainted) {
      state.turningPathTainted = true;
      warningOnce(warnings, {
        line: record.line,
        code: "turning-cut-from-unknown-position",
        verificationBlocked: true,
        message: "G01/G02/G03 cutting motion cannot establish a verified turning start; use a complete absolute G0 X/Z baseline first.",
      });
    }
    return null;
  }
  const points = state.motion === "rapid" ? rapidPath(start, end, state, xMode) : [start, end];
  const positionUncertaintyMm = Math.max(startPositionUncertaintyMm, endPositionUncertaintyMm);
  const segment = {
    type: state.motion, start, end, points, line: record.line, raw: record.raw.trim(), ...timingSnapshot(state),
    toolKey: state.activeToolKey, toolCallLine: state.activeToolCallLine,
    geometryUncertaintyMm: positionUncertaintyMm,
    coordinateUncertaintyMm: {
      start: {
        x: (Number(startAxisUncertainty.x) || 0) * xCoordinateScale,
        z: Number(startAxisUncertainty.z) || 0,
      },
      end: {
        x: (Number(endAxisUncertainty.x) || 0) * xCoordinateScale,
        z: Number(endAxisUncertainty.z) || 0,
      },
    },
    verificationBlocked: verificationIssues.length > 0,
    verificationIssues: [...new Set(verificationIssues)],
  };
  if (liveStateActive) {
    segment.liveTool = true;
    segment.machiningMode = "live-tool";
  }
  if (cAxis.event) {
    cAxis.event.combinedWithLinearAxes = true;
    segment.coordinateMode = "c-axis-index";
    segment.cAxisMotion = {start: cAxis.event.start, end: cAxis.event.end};
  }
  if (distance(start, end) < EPSILON) {
    if (state.motion === "arc-cw" || state.motion === "arc-ccw") {
      return blockedSameEndpointArcSegment(segment, record, warnings);
    }
    if (state.motion === "linear" && positionUncertaintyMm > PROFILE_NUMERICAL_BUDGET_MM) {
      warningOnce(warnings, {
        line: record.line,
        code: "linear-numerical-resolution",
        verificationBlocked: true,
        message: "Sub-resolution G01 coordinate arithmetic cannot retain the required 0.00005 in numerical budget; the attempted move is retained as blocked.",
      });
      return {
        ...segment,
        verificationBlocked: true,
        verificationIssues: [...new Set([
          ...(segment.verificationIssues || []),
          "linear-numerical-resolution",
        ])],
      };
    }
    return null;
  }
  if (state.motion === "arc-cw" || state.motion === "arc-ccw") {
    const hasCenterDefinition = record.byLetter.has("I") || record.byLetter.has("K");
    if (record.byLetter.has("R") && hasCenterDefinition) {
      warningOnce(warnings, {
        line: record.line,
        code: "arc-center-radius-conflict",
        verificationBlocked: true,
        message: "Haas G02/G03 cannot combine R radius with I/K center definition in the same block; arc geometry is blocked.",
      });
      invalidateUnsupportedPosition(record, state);
      return null;
    }
    const iAddress = record.byLetter.has("I") ? scaledPositionAddress(record, "I", state) : null;
    const kAddress = record.byLetter.has("K") ? scaledPositionAddress(record, "K", state) : null;
    const rAddress = record.byLetter.has("R") ? scaledPositionAddress(record, "R", state) : null;
    const params = {
      i: iAddress?.value ?? NaN,
      k: kAddress?.value ?? NaN,
      r: rAddress?.value ?? NaN,
      iUncertaintyMm: iAddress?.uncertaintyMm ?? 0,
      kUncertaintyMm: kAddress?.uncertaintyMm ?? 0,
      rUncertaintyMm: rAddress?.uncertaintyMm ?? 0,
    };
    const arc = arcGeometry(
      start,
      end,
      params,
      state.motion === "arc-cw",
      xCoordinateScale,
      state.arcChordTolerance,
      {startMm: startPositionUncertaintyMm, endMm: endPositionUncertaintyMm},
    );
    if (arc && !arc.numericalResolutionBlocked) {
      Object.assign(segment, arc);
      segment.geometryUncertaintyMm = Math.max(positionUncertaintyMm, arc.geometryUncertaintyMm || 0);
    }
    else {
      segment.sourceMotion = state.motion;
      segment.type = "linear";
      if (arc?.numericalResolutionBlocked) {
        segment.verificationBlocked = true;
        segment.verificationIssues = [...new Set([
          ...(segment.verificationIssues || []),
          "arc-numerical-resolution",
        ])];
        warningOnce(warnings, {
          line: record.line,
          code: "arc-numerical-resolution",
          verificationBlocked: true,
          message: "Arc center or directed-sweep construction cannot retain the required 0.00005 in numerical budget; the attempted chord is shown only as a blocked path.",
        });
      }
      if (state.liveToolDialect === "haas-lathe-ngc") {
        segment.verificationBlocked = true;
        segment.verificationIssues = [...new Set([...(segment.verificationIssues || []), "arc-geometry-unresolved"])];
        if (!arc?.numericalResolutionBlocked) {
          warningOnce(warnings, {
            line: record.line,
            code: "arc-geometry-unresolved",
            verificationBlocked: true,
            message: "Haas arc geometry is incomplete or inconsistent; its attempted chord is shown only as a blocked path and execution stops.",
          });
        }
        state.x = null;
        state.z = null;
        state.xUncertaintyMm = null;
        state.zUncertaintyMm = null;
        invalidateExecutionState(state);
      } else if (!arc?.numericalResolutionBlocked) {
        warnings.push({line: record.line, message: "Arc geometry is incomplete or inconsistent; shown as a line."});
      }
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
    state.xUncertaintyMm = null;
    state.zUncertaintyMm = null;
    warnings.push({line: record.line, message: "G28 returns to machine reference, but its position cannot be placed in the part view without a plotted reference estimate."});
    return [];
  }

  const segments = [];
  const start = {x: state.x, z: state.z};
  let intermediate = null;
  if (isKnownPoint(start)) {
    intermediate = {
      x: start.x + (record.byLetter.has("U") ? interpretedHaasAddressValue(record, "U", state) * state.scale : 0),
      z: start.z + (record.byLetter.has("W") ? interpretedHaasAddressValue(record, "W", state) * state.scale : 0),
    };
    if (distance(start, intermediate) > EPSILON) segments.push(rapidSegment(start, intermediate, record, state, xMode, "intermediate"));
    if (distance(intermediate, reference) > EPSILON) segments.push(rapidSegment(intermediate, reference, record, state, xMode, "reference"));
  }

  state.x = reference.x;
  state.z = reference.z;
  state.xUncertaintyMm = numericUncertainty(reference.x);
  state.zUncertaintyMm = numericUncertainty(reference.z);
  const message = isKnownPoint(start)
    ? `G28 returned to the estimated machine reference at X${(reference.x / state.scale).toFixed(4)} Z${(reference.z / state.scale).toFixed(4)}.`
    : `G28 established the estimated machine reference at X${(reference.x / state.scale).toFixed(4)} Z${(reference.z / state.scale).toFixed(4)}; the unknown incoming move was not drawn.`;
  warnings.push({line: record.line, info: true, message});
  return segments;
}

function sequenceIndex(records, sequence) {
  if (!Number.isSafeInteger(sequence) || sequence < 0) return -1;
  return records.findIndex((record) => isUnsignedIntegerWord(record, "N") && lastWord(record, "N") === sequence);
}

function contourFor(records, startIndex, endIndex, state, xMode, warnings) {
  const localState = cloneState(state);
  const segments = [];
  const contourWarnings = [];
  let prohibitedSemantics = false;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const contourRecord = records[index];
    const prohibitedAxes = ["C", "H", "Y"].filter((letter) => contourRecord.byLetter.has(letter));
    const hasMCode = contourRecord.byLetter.has("M");
    if (prohibitedAxes.length || hasMCode) {
      prohibitedSemantics = true;
      warningOnce(contourWarnings, {
        line: contourRecord.line,
        code: "cycle-contour-nongeometric-semantics",
        verificationBlocked: true,
        message: `P/Q turning contours cannot be verified with ${[
          prohibitedAxes.length ? `${prohibitedAxes.join("/")} axes` : null,
          hasMCode ? "M-code state/control commands" : null,
        ].filter(Boolean).join(" and ")}; the canned cycle is blocked.`,
      });
      localState.x = null;
      localState.z = null;
      localState.xUncertaintyMm = null;
      localState.zUncertaintyMm = null;
      localState.cAxisPosition = null;
      localState.cAxisPositionUncertaintyDegrees = null;
      localState.g112PathTainted = true;
      continue;
    }
    // P-Q records describe contour geometry. A T word retained in one of those
    // records is metadata, not an executed modal tool change for the canned
    // cycle. G70/G71/G72 all use the tool active at their executing call.
    const segment = parseBasicRecord(contourRecord, localState, xMode, contourWarnings, {executeToolCall: false});
    if (segment) segments.push(segment);
  }
  warnings.push(...contourWarnings);
  const invalidSegment = segments.some((segment) => segment.liveTool
    || segment.coordinateMode && segment.coordinateMode !== "turning-xz"
    || segment.cAxisMotion
    || segment.verificationBlocked
    || (segment.points || []).some((point) => Number.isFinite(point?.y) || Number.isFinite(point?.c)));
  const invalidState = localState.g112Active
    || localState.unconfiguredG112Active
    || localState.g112PathTainted
    || localState.turningPathTainted
    || activeMotionBlocker(localState)
    || localState.executionBlocked;
  const invalidWarning = contourWarnings.some((warning) => !warning.info || warning.verificationBlocked);
  return {
    segments,
    state: localState,
    validTurningContour: !prohibitedSemantics && !invalidSegment && !invalidState && !invalidWarning,
  };
}

function profileGeometry(contourSegments) {
  if (!contourSegments.length) return {points: [], segments: [], startLine: null};
  const first = contourSegments[0].end;
  const profileSegments = contourSegments.slice(1);
  const points = [{...first}];
  const pointUncertaintiesMm = [{
    x: Number(contourSegments[0].coordinateUncertaintyMm?.end?.x) || 0,
    z: Number(contourSegments[0].coordinateUncertaintyMm?.end?.z) || 0,
  }];
  for (const segment of profileSegments) {
    const additions = segment.points.slice(1);
    additions.forEach((point, index) => {
      points.push({...point});
      const endpoint = index === additions.length - 1;
      pointUncertaintiesMm.push(endpoint ? {
        x: Number(segment.coordinateUncertaintyMm?.end?.x) || 0,
        z: Number(segment.coordinateUncertaintyMm?.end?.z) || 0,
      } : {
        x: Number(segment.geometryUncertaintyMm) || 0,
        z: Number(segment.geometryUncertaintyMm) || 0,
      });
    });
  }
  const geometryUncertaintyMm = contourSegments.reduce(
    (maximum, segment) => Math.max(maximum, Number(segment.geometryUncertaintyMm) || 0),
    0,
  );
  return {
    points,
    pointUncertaintiesMm,
    segments: profileSegments,
    startLine: contourSegments[0].line,
    geometryUncertaintyMm,
  };
}

function coordinateAverageWithUncertainty(points, key, pointUncertainties) {
  let sum = 0;
  let arithmeticBound = 0;
  for (const point of points) {
    const next = sum + point[key];
    arithmeticBound = boundedUncertaintySum(
      arithmeticBound,
      arithmeticUncertainty(sum, point[key], next),
    );
    sum = next;
  }
  const value = sum / points.length;
  return {
    value,
    uncertainty: boundedUncertaintySum(
      pointUncertainties.reduce((sum, uncertainty) => sum + uncertainty, 0) / points.length,
      arithmeticBound / points.length,
      arithmeticUncertainty(sum, points.length, value),
    ),
  };
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

function extremePointIndex(points, key, minimum) {
  let selected = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (minimum ? points[index][key] < points[selected][key] : points[index][key] > points[selected][key]) {
      selected = index;
    }
  }
  return selected;
}

function shiftedProfile(geometry, offsetX, offsetZ, xCoordinateScale) {
  const points = geometry.points.map((point) => ({x: point.x + offsetX, z: point.z + offsetZ}));
  const pointUncertaintiesMm = points.map((point, index) => {
    const source = geometry.pointUncertaintiesMm?.[index] || {};
    return {
      x: boundedUncertaintySum(
        source.x,
        numericUncertainty(offsetX) * Math.abs(xCoordinateScale),
        arithmeticUncertainty(geometry.points[index].x, offsetX, point.x) * Math.abs(xCoordinateScale),
      ),
      z: boundedUncertaintySum(
        source.z,
        numericUncertainty(offsetZ),
        arithmeticUncertainty(geometry.points[index].z, offsetZ, point.z),
      ),
    };
  });
  const segments = geometry.segments.map((segment) => {
    const start = {x: segment.start.x + offsetX, z: segment.start.z + offsetZ};
    const end = {x: segment.end.x + offsetX, z: segment.end.z + offsetZ};
    const shiftUncertaintyMm = boundedUncertaintySum(
      numericUncertainty(offsetX) * Math.abs(xCoordinateScale),
      numericUncertainty(offsetZ),
      arithmeticUncertainty(segment.start.x, offsetX, start.x) * Math.abs(xCoordinateScale),
      arithmeticUncertainty(segment.start.z, offsetZ, start.z),
      arithmeticUncertainty(segment.end.x, offsetX, end.x) * Math.abs(xCoordinateScale),
      arithmeticUncertainty(segment.end.z, offsetZ, end.z),
    );
    return {
      ...segment,
      start,
      end,
      points: segment.points.map((point) => ({x: point.x + offsetX, z: point.z + offsetZ})),
      center: segment.center ? {
        x: segment.center.x + offsetX * xCoordinateScale,
        z: segment.center.z + offsetZ,
      } : undefined,
      geometryUncertaintyMm: boundedUncertaintySum(
        segment.geometryUncertaintyMm,
        shiftUncertaintyMm,
      ),
      coordinateUncertaintyMm: {
        start: {
          x: boundedUncertaintySum(
            segment.coordinateUncertaintyMm?.start?.x,
            numericUncertainty(offsetX) * Math.abs(xCoordinateScale),
            arithmeticUncertainty(segment.start.x, offsetX, start.x) * Math.abs(xCoordinateScale),
          ),
          z: boundedUncertaintySum(
            segment.coordinateUncertaintyMm?.start?.z,
            numericUncertainty(offsetZ),
            arithmeticUncertainty(segment.start.z, offsetZ, start.z),
          ),
        },
        end: {
          x: boundedUncertaintySum(
            segment.coordinateUncertaintyMm?.end?.x,
            numericUncertainty(offsetX) * Math.abs(xCoordinateScale),
            arithmeticUncertainty(segment.end.x, offsetX, end.x) * Math.abs(xCoordinateScale),
          ),
          z: boundedUncertaintySum(
            segment.coordinateUncertaintyMm?.end?.z,
            numericUncertainty(offsetZ),
            arithmeticUncertainty(segment.end.z, offsetZ, end.z),
          ),
        },
      },
    };
  });
  const geometryUncertaintyMm = segments.reduce(
    (maximum, segment) => Math.max(maximum, segment.geometryUncertaintyMm),
    Number(geometry.geometryUncertaintyMm) || 0,
  );
  return {startLine: geometry.startLine, geometryUncertaintyMm, points, pointUncertaintiesMm, segments};
}

function crossingPoint(
  points,
  level,
  key,
  outsideDirection,
  {
    pointUncertaintiesMm = [],
    levelUncertaintyMm = 0,
    xCoordinateScale = 1,
    levelIsResolvedTarget = false,
  } = {},
) {
  if (!points.length) return {point: null, uncertaintyMm: 0, conditioningBlocked: false};
  const safe = (point) => (level - point[key]) * outsideDirection >= -EPSILON;
  const axisScale = key === "x" ? Math.abs(xCoordinateScale) : 1;
  const levelAxisUncertainty = levelUncertaintyMm / axisScale;
  const uncertaintyAt = (index, coordinateKey) => (
    Math.max(0, Number(pointUncertaintiesMm[index]?.[coordinateKey]) || 0)
  );
  const predicateUncertainty = (point, index) => {
    const difference = level - point[key];
    return boundedUncertaintySum(
      levelAxisUncertainty,
      uncertaintyAt(index, key) / axisScale,
      arithmeticUncertainty(level, point[key], difference),
    );
  };
  const firstPredicateUncertainty = predicateUncertainty(points[0], 0);
  let priorPredicateUnresolved = Math.abs(level - points[0][key]) <= firstPredicateUncertainty;
  let priorPredicateIndex = priorPredicateUnresolved ? 0 : -1;
  if (!safe(points[0])) {
    return {
      point: {...points[0]},
      uncertaintyMm: Math.hypot(uncertaintyAt(0, "x"), uncertaintyAt(0, "z")),
      conditioningBlocked: priorPredicateUnresolved,
    };
  }
  for (let index = 1; index < points.length; index += 1) {
    const nextPredicateUncertainty = predicateUncertainty(points[index], index);
    const nextPredicateUnresolved = Math.abs(level - points[index][key]) <= nextPredicateUncertainty;
    const otherKey = key === "x" ? "z" : "x";
    const otherScale = otherKey === "x" ? Math.abs(xCoordinateScale) : 1;
    const ambiguousSpanMm = priorPredicateUnresolved && nextPredicateUnresolved
      ? Math.abs(points[index][otherKey] - points[priorPredicateIndex][otherKey]) * otherScale
      : 0;
    const ambiguousSpanBlocked = !levelIsResolvedTarget
      && ambiguousSpanMm > PROFILE_NUMERICAL_BUDGET_MM
      && Math.max(
        uncertaintyAt(priorPredicateIndex, key),
        uncertaintyAt(index, key),
        levelUncertaintyMm,
      ) > 0;
    if (safe(points[index])) {
      priorPredicateUnresolved = nextPredicateUnresolved;
      priorPredicateIndex = nextPredicateUnresolved ? index : -1;
      if (ambiguousSpanBlocked) {
        return {point: {...points[index - 1]}, uncertaintyMm: Number.MAX_VALUE, conditioningBlocked: true};
      }
      continue;
    }
    const before = points[index - 1];
    const after = points[index];
    const denominator = after[key] - before[key];
    const beforeAxisUncertainty = uncertaintyAt(index - 1, key) / axisScale;
    const afterAxisUncertainty = uncertaintyAt(index, key) / axisScale;
    const denominatorUncertainty = boundedUncertaintySum(
      beforeAxisUncertainty,
      afterAxisUncertainty,
      arithmeticUncertainty(after[key], before[key], denominator),
    );
    const numerator = level - before[key];
    const numeratorUncertainty = boundedUncertaintySum(
      levelAxisUncertainty,
      beforeAxisUncertainty,
      arithmeticUncertainty(level, before[key], numerator),
    );
    if (Math.abs(denominator) <= denominatorUncertainty) {
      return {point: {...before}, uncertaintyMm: Number.MAX_VALUE, conditioningBlocked: true};
    }
    const ratio = Math.abs(denominator) < EPSILON ? 0 : (level - before[key]) / denominator;
    const ratioUncertainty = (
      numeratorUncertainty * Math.abs(denominator)
      + Math.abs(numerator) * denominatorUncertainty
    ) / (Math.abs(denominator) * (Math.abs(denominator) - denominatorUncertainty));
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    const point = {
      x: before.x + (after.x - before.x) * Math.max(0, Math.min(1, ratio)),
      z: before.z + (after.z - before.z) * Math.max(0, Math.min(1, ratio)),
    };
    const interpolationUncertaintyMm = boundedUncertaintySum(
      Math.hypot(
        Math.max(uncertaintyAt(index - 1, "x"), uncertaintyAt(index, "x")),
        Math.max(uncertaintyAt(index - 1, "z"), uncertaintyAt(index, "z")),
      ),
      Math.abs(after[otherKey] - before[otherKey]) * otherScale * ratioUncertainty,
      arithmeticUncertainty(
        before[otherKey],
        after[otherKey] - before[otherKey],
        clampedRatio,
        point[otherKey],
      ) * otherScale,
    );
    return {
      point,
      uncertaintyMm: interpolationUncertaintyMm,
      conditioningBlocked: ambiguousSpanBlocked
        || !Number.isFinite(ratioUncertainty)
        || interpolationUncertaintyMm > PROFILE_NUMERICAL_BUDGET_MM,
    };
  }
  const lastIndex = points.length - 1;
  return {
    point: {...points.at(-1)},
    uncertaintyMm: Math.hypot(
      uncertaintyAt(lastIndex, "x"),
      uncertaintyAt(lastIndex, "z"),
    ),
    conditioningBlocked: false,
  };
}

function generatedSegment(
  type,
  start,
  end,
  cycle,
  line,
  pass,
  points = null,
  rapidState = null,
  xMode = "diameter",
  geometry = null,
  cycleUncertaintyMm = 0,
) {
  const path = points || (type === "rapid" && rapidState ? rapidPath(start, end, rapidState, xMode) : [{...start}, {...end}]);
  const timingSource = geometry && type !== "rapid" ? geometry : rapidState;
  const executionSpindle = timingSnapshot(rapidState || {});
  const segment = {
    type, start: {...start}, end: {...end}, points: path,
    line, raw: `${cycle} generated ${type}${pass ? ` pass ${pass}` : ""}`,
    ...timingSnapshot(timingSource || {}),
    spindleRunning: executionSpindle.spindleRunning,
    spindleDirection: executionSpindle.spindleDirection,
    generated: true, cycle, pass,
    executionLine: line,
    sourceLine: Number.isInteger(geometry?.line) ? geometry.line : line,
    toolKey: rapidState?.activeToolKey ?? null,
    toolCallLine: rapidState?.activeToolCallLine ?? null,
  };
  segment.geometryUncertaintyMm = boundedUncertaintySum(
    cycleUncertaintyMm,
    geometry?.geometryUncertaintyMm,
  );
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

function expandCycle({
  code,
  start,
  startUncertaintyMm = 0,
  geometry,
  depth,
  retract,
  finishU,
  finishW,
  xMode,
  line,
  p,
  q,
  rapidState,
}) {
  const warnings = [];
  const segments = [];
  const xCoordinateScale = xMode === "diameter" ? 0.5 : 1;
  const points = geometry.points;
  if (points.length < 2) {
    return {
      segments,
      warnings: [{
        line,
        code: "cycle-profile-empty",
        verificationBlocked: true,
        message: `${code} P${p}/Q${q} does not define a usable profile; cycle verification is blocked.`,
      }],
      passes: 0,
      type: "I",
    };
  }
  const cycleUncertaintyMm = boundedUncertaintySum(
    startUncertaintyMm,
    geometry.geometryUncertaintyMm,
    numericUncertainty(depth),
    numericUncertainty(retract),
    numericUncertainty(finishU),
    numericUncertainty(finishW),
    numericUncertainty(Math.max(
      Math.abs(start.x),
      Math.abs(start.z),
      Math.abs(depth),
      Math.abs(retract),
      Math.abs(finishU),
      Math.abs(finishW),
    )) * 32,
  );

  const averageXResult = coordinateAverageWithUncertainty(
    points,
    "x",
    geometry.pointUncertaintiesMm.map((uncertainty) => uncertainty.x / xCoordinateScale),
  );
  const averageZResult = coordinateAverageWithUncertainty(
    points,
    "z",
    geometry.pointUncertaintiesMm.map((uncertainty) => uncertainty.z),
  );
  const averageX = averageXResult.value;
  const averageZ = averageZResult.value;
  const outsideXMarginMm = Math.abs(start.x - averageX) * xCoordinateScale;
  const outsideZMarginMm = Math.abs(start.z - averageZ);
  const outsideXUncertaintyMm = boundedUncertaintySum(
    startUncertaintyMm,
    averageXResult.uncertainty * xCoordinateScale,
    arithmeticUncertainty(start.x, averageX, start.x - averageX) * xCoordinateScale,
  );
  const outsideZUncertaintyMm = boundedUncertaintySum(
    startUncertaintyMm,
    averageZResult.uncertainty,
    arithmeticUncertainty(start.z, averageZ, start.z - averageZ),
  );
  const outsideDirectionUnresolved = (
    (code === "G71" || Math.abs(finishU) > EPSILON)
      && outsideXMarginMm <= outsideXUncertaintyMm
  ) || (
    (code === "G72" || Math.abs(finishW) > EPSILON)
      && outsideZMarginMm <= outsideZUncertaintyMm
  );
  const outsideX = Math.sign(start.x - averageX) || 1;
  const outsideZ = Math.sign(start.z - averageZ) || 1;
  const profile = shiftedProfile(geometry, outsideX * Math.abs(finishU), outsideZ * Math.abs(finishW), xCoordinateScale);
  const typeII = code === "G71" ? directionReversals(points, "x") > 0 : directionReversals(points, "z") > 0;
  const invalidReversal = code === "G71" ? directionReversals(points, "z") > 0 : directionReversals(points, "x") > 0;
  if (typeII) warnings.push({line, message: `${code} Type II pockets are shown using the profile envelope; verify nested trough sequencing at the control.`});
  if (invalidReversal) warnings.push({line, message: `${code} profile reverses its cutting axis and may be invalid for this cycle.`});

  let current = {...start};
  let passCount = 0;
  let derivedCycleUncertaintyMm = cycleUncertaintyMm;
  let crossingConditioningBlocked = false;
  const push = (type, end, pass = null, customPoints = null, geometrySource = null) => {
    if (distance(current, end) < EPSILON && !customPoints) return;
    const segment = generatedSegment(
      type,
      current,
      end,
      code,
      line,
      pass,
      customPoints,
      rapidState,
      xMode,
      geometrySource,
      derivedCycleUncertaintyMm,
    );
    segments.push(segment);
    current = {...end};
  };

  if (code === "G71") {
    const step = Math.max(EPSILON, Math.abs(depth) / xCoordinateScale);
    const targetIndex = extremePointIndex(profile.points, "x", outsideX > 0);
    const target = profile.points[targetIndex].x;
    const targetUncertaintyMm = profile.pointUncertaintiesMm[targetIndex].x;
    const stepUncertaintyMm = numericUncertainty(step) * xCoordinateScale;
    const travelZ = Math.sign(profile.points.at(-1).z - profile.points[0].z) || -1;
    let level = start.x;
    let levelUncertaintyMm = startUncertaintyMm;
    while ((level - target) * outsideX > EPSILON && passCount < 250) {
      const remaining = Math.abs(level - target);
      const clampMarginMm = Math.abs(remaining - step) * xCoordinateScale;
      const clampUncertaintyMm = boundedUncertaintySum(
        levelUncertaintyMm,
        targetUncertaintyMm,
        stepUncertaintyMm,
        arithmeticUncertainty(level, target, level - target) * xCoordinateScale,
      );
      const clampDecisionUnresolved = clampMarginMm <= clampUncertaintyMm;
      const clampedToTarget = remaining <= step;
      const nextLevel = clampedToTarget
        ? target
        : level + -outsideX * step;
      crossingConditioningBlocked ||= clampDecisionUnresolved;
      levelUncertaintyMm = clampedToTarget && !clampDecisionUnresolved
        ? targetUncertaintyMm
        : boundedUncertaintySum(
            levelUncertaintyMm,
            stepUncertaintyMm,
            arithmeticUncertainty(level, step, nextLevel) * xCoordinateScale,
          );
      derivedCycleUncertaintyMm = boundedUncertaintySum(
        derivedCycleUncertaintyMm,
        levelUncertaintyMm,
      );
      level = nextLevel;
      const crossing = crossingPoint(profile.points, level, "x", outsideX, {
        pointUncertaintiesMm: profile.pointUncertaintiesMm,
        levelUncertaintyMm,
        xCoordinateScale,
        levelIsResolvedTarget: clampedToTarget && !clampDecisionUnresolved,
      });
      const hit = crossing.point;
      derivedCycleUncertaintyMm = Math.max(derivedCycleUncertaintyMm, crossing.uncertaintyMm);
      crossingConditioningBlocked ||= crossing.conditioningBlocked;
      passCount += 1;
      push("rapid", {x: level, z: start.z}, passCount);
      if (hit && Math.abs(hit.z - start.z) > EPSILON) push("rough", {x: level, z: hit.z}, passCount);
      const retractPoint = {x: level + outsideX * Math.abs(retract) / xCoordinateScale, z: (hit?.z ?? start.z) - travelZ * Math.abs(retract)};
      push("rapid", retractPoint, passCount);
      push("rapid", {x: retractPoint.x, z: start.z}, passCount);
    }
  } else {
    const step = Math.max(EPSILON, Math.abs(depth));
    const targetIndex = extremePointIndex(profile.points, "z", outsideZ > 0);
    const target = profile.points[targetIndex].z;
    const targetUncertaintyMm = profile.pointUncertaintiesMm[targetIndex].z;
    const stepUncertaintyMm = numericUncertainty(step);
    const travelX = Math.sign(profile.points.at(-1).x - profile.points[0].x) || -1;
    let level = start.z;
    let levelUncertaintyMm = startUncertaintyMm;
    while ((level - target) * outsideZ > EPSILON && passCount < 250) {
      const remaining = Math.abs(level - target);
      const clampMarginMm = Math.abs(remaining - step);
      const clampUncertaintyMm = boundedUncertaintySum(
        levelUncertaintyMm,
        targetUncertaintyMm,
        stepUncertaintyMm,
        arithmeticUncertainty(level, target, level - target),
      );
      const clampDecisionUnresolved = clampMarginMm <= clampUncertaintyMm;
      const clampedToTarget = remaining <= step;
      const nextLevel = clampedToTarget
        ? target
        : level + -outsideZ * step;
      crossingConditioningBlocked ||= clampDecisionUnresolved;
      levelUncertaintyMm = clampedToTarget && !clampDecisionUnresolved
        ? targetUncertaintyMm
        : boundedUncertaintySum(
            levelUncertaintyMm,
            stepUncertaintyMm,
            arithmeticUncertainty(level, step, nextLevel),
          );
      derivedCycleUncertaintyMm = boundedUncertaintySum(
        derivedCycleUncertaintyMm,
        levelUncertaintyMm,
      );
      level = nextLevel;
      const crossing = crossingPoint(profile.points, level, "z", outsideZ, {
        pointUncertaintiesMm: profile.pointUncertaintiesMm,
        levelUncertaintyMm,
        xCoordinateScale,
        levelIsResolvedTarget: clampedToTarget && !clampDecisionUnresolved,
      });
      const hit = crossing.point;
      derivedCycleUncertaintyMm = Math.max(derivedCycleUncertaintyMm, crossing.uncertaintyMm);
      crossingConditioningBlocked ||= crossing.conditioningBlocked;
      passCount += 1;
      push("rapid", {x: start.x, z: level}, passCount);
      if (hit && Math.abs(hit.x - start.x) > EPSILON) push("rough", {x: hit.x, z: level}, passCount);
      const retractPoint = {x: (hit?.x ?? start.x) - travelX * Math.abs(retract) / xCoordinateScale, z: level + outsideZ * Math.abs(retract)};
      push("rapid", retractPoint, passCount);
      push("rapid", {x: start.x, z: retractPoint.z}, passCount);
    }
  }

  const truncated = passCount >= 250;
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
  if (outsideDirectionUnresolved || crossingConditioningBlocked) {
    warnings.push({
      line,
      code: "cycle-numerical-conditioning",
      verificationBlocked: true,
      message: "Canned-cycle direction or contour-intersection arithmetic is numerically unresolved; generated motion remains display-only and verification is blocked.",
    });
    for (const segment of segments) {
      segment.verificationBlocked = true;
      segment.verificationIssues = [...new Set([...(segment.verificationIssues || []), "cycle-numerical-conditioning"])];
    }
  }
  if (segments.some((segment) => segment.geometryUncertaintyMm > PROFILE_NUMERICAL_BUDGET_MM)) {
    warnings.push({
      line,
      code: "cycle-numerical-resolution",
      verificationBlocked: true,
      message: "Canned-cycle geometry cannot retain the required 0.00005 in numerical budget; generated motion remains display-only and verification is blocked.",
    });
    for (const segment of segments) {
      segment.verificationBlocked = true;
      segment.verificationIssues = [...new Set([...(segment.verificationIssues || []), "cycle-numerical-resolution"])];
    }
  }
  if (truncated) {
    warnings.push({
      line,
      code: "cycle-expansion-truncated",
      verificationBlocked: true,
      message: `${code} expansion stopped at 250 passes; path, stock, collision, and runtime proof remain incomplete.`,
    });
    for (const segment of segments) {
      segment.verificationBlocked = true;
      segment.verificationIssues = [...new Set([...(segment.verificationIssues || []), "cycle-expansion-truncated"])];
    }
  }
  return {segments, warnings, passes: passCount, type: typeII ? "II" : "I", truncated};
}

function cycleCall(record, pending, state) {
  const code = hasG(record, 71) ? "G71" : "G72";
  const first = pending?.code === code ? pending.record : null;
  const scale = state.scale;
  const depthLetter = code === "G71" ? (first ? "U" : "D") : (first ? "W" : "D");
  const depthRaw = interpretedHaasAddressValue(first || record, depthLetter, state);
  return {
    code,
    p: lastWord(record, "P"), q: lastWord(record, "Q"),
    depth: Number.isFinite(depthRaw) ? depthRaw * scale : NaN,
    retract: (lastWord(first || record, "R") ?? 1) * scale,
    finishU: (interpretedHaasAddressValue(record, "U", state) ?? 0) * scale,
    finishW: (interpretedHaasAddressValue(record, "W", state) ?? 0) * scale,
    feed: record.byLetter.has("F") ? interpretedHaasFeedValue(record, state) : undefined,
  };
}

export function parseGcode(source, {
  xMode = "diameter", initialPosition = {x: 0, z: 0}, referencePosition = null,
  rapidBehavior = "linear", rapidXMax = null, rapidZMax = null, arcChordTolerance = 0.0254,
  defaultUnits = "mm", warnOnAssumedUnits = false,
  liveToolDialect: requestedLiveToolDialect = "unconfigured",
  liveToolCapability: requestedLiveToolCapability = "unknown",
  cAxisCapability: requestedCAxisCapability = "unknown",
  yAxisCapability: requestedYAxisCapability = "unknown",
  cAxisEngagement: requestedCAxisEngagement = "unknown",
  liveToolMaxRpm: requestedLiveToolMaxRpm = null,
  haasDefaultToFloat: requestedHaasDefaultToFloat = "unknown",
  haasIntegerFeedScale: requestedHaasIntegerFeedScale = "unknown",
} = {}) {
  const lines = source.replace(/\r/g, "").split("\n");
  const records = lines.map(recordFor);
  const extractedToolCalls = extractProgramToolCalls(source);
  const normalizedDefaultUnits = defaultUnits === "inch" || defaultUnits === "in" ? "in" : "mm";
  const liveToolDialectDefinition = resolveLiveToolDialect(requestedLiveToolDialect);
  const state = {
    x: Number.isFinite(initialPosition?.x) ? initialPosition.x : null,
    z: Number.isFinite(initialPosition?.z) ? initialPosition.z : null,
    xUncertaintyMm: Number.isFinite(initialPosition?.x) ? numericUncertainty(initialPosition.x) : null,
    zUncertaintyMm: Number.isFinite(initialPosition?.z) ? numericUncertainty(initialPosition.z) : null,
    xMode,
    referencePosition: isKnownPoint(referencePosition) ? {...referencePosition} : null,
    rapidBehavior, rapidXMax, rapidZMax, arcChordTolerance,
    absolute: true, scale: normalizedDefaultUnits === "in" ? 25.4 : 1, units: normalizedDefaultUnits,
    motion: "rapid", feed: null, feedMode: "unknown", spindleMode: "unknown", spindleSpeed: null,
    spindleLimit: null, spindleRunning: null, spindleDirection: "unknown",
    plane: "G18", sawPlane: false, sawUnitMode: false, assumedUnitsUsed: false,
    activeToolKey: null, activeToolCallLine: null,
    liveToolDialectDefinition,
    liveToolDialect: liveToolDialectDefinition.id,
    haasDefaultToFloat: ["on", "off"].includes(requestedHaasDefaultToFloat) ? requestedHaasDefaultToFloat : "unknown",
    haasIntegerFeedScale: HAAS_INTEGER_FEED_SCALES.has(requestedHaasIntegerFeedScale) ? requestedHaasIntegerFeedScale : "unknown",
    liveToolCapability: normalizeLiveToolCapability(requestedLiveToolCapability),
    liveToolRunning: null,
    liveToolDirection: "unknown",
    liveToolSpeed: null,
    liveToolMaxRpm: Number.isFinite(Number(requestedLiveToolMaxRpm)) && Number(requestedLiveToolMaxRpm) > 0
      ? Number(requestedLiveToolMaxRpm)
      : null,
    liveToolSpeedOverLimit: false,
    cAxisCapability: normalizeAxisCapability(requestedCAxisCapability),
    yAxisCapability: normalizeAxisCapability(requestedYAxisCapability),
    cAxisEngagementMode: normalizeCAxisEngagement(requestedCAxisEngagement),
    cAxisEngaged: null,
    cAxisEngagementSource: "unknown",
    cAxisPosition: null,
    cAxisPositionUncertaintyDegrees: null,
    g112Active: false,
    unconfiguredG112Active: false,
    faceX: null,
    faceY: null,
    faceZ: null,
    faceXUncertaintyMm: null,
    faceYUncertaintyMm: null,
    faceZUncertaintyMm: null,
    g112PathTainted: false,
    turningPathTainted: false,
    turningMode: "turning",
    unsupportedGroup01MotionMode: null,
    unsupportedGroup09MotionMode: null,
    cutterCompMode: null,
    unsupportedCoordinateTransform: null,
    blockCurrentMotionLine: null,
    programEnded: false,
    executionBlocked: false,
    liveToolAttempts: new Map(),
  };
  const segments = [];
  const warnings = [];
  const cycles = [];
  const timingEvents = [];
  const liveToolEvents = [];
  const cAxisEvents = [];
  const cAxisMotions = [];
  const definitionIndexes = new Set();
  const rawProgramEndIndex = records.findIndex(hasProgramEnd);
  const rawExecutionStopIndex = records.findIndex((record) => hasProgramEnd(record)
    || hasExecutionBoundary(record, state.liveToolDialect));

  for (const record of records) {
    // A cycle call after an unconditional program end is unreachable and must
    // never reclassify that M02/M30 (or earlier executable records) as contour
    // metadata. Reachable calls may reference labels elsewhere in the file,
    // but program-end records themselves always retain execution semantics.
    if (rawExecutionStopIndex >= 0 && record.index >= rawExecutionStopIndex) continue;
    if (!(hasG(record, 70) || hasG(record, 71) || hasG(record, 72))
      || !Number.isFinite(lastWord(record, "P"))
      || !Number.isFinite(lastWord(record, "Q"))) continue;
    const startIndex = sequenceIndex(records, lastWord(record, "P"));
    const endIndex = sequenceIndex(records, lastWord(record, "Q"));
    if (startIndex >= 0 && endIndex >= startIndex) {
      for (let index = startIndex; index <= endIndex; index += 1) {
        if (!hasProgramEnd(records[index])
          && !hasExecutionBoundary(records[index], state.liveToolDialect)) {
          definitionIndexes.add(index);
        }
      }
    }
  }
  const programEndIndex = rawProgramEndIndex;
  const executionStopIndex = rawExecutionStopIndex;
  let toolCalls = extractedToolCalls.map((call) => {
    const definitionOnly = definitionIndexes.has(call.line - 1);
    const afterProgramEnd = programEndIndex >= 0 && call.line - 1 > programEndIndex;
    const afterExecutionStop = executionStopIndex >= 0 && call.line - 1 >= executionStopIndex;
    return {
      ...call,
      executable: !definitionOnly && !afterExecutionStop,
      definitionOnly,
      afterProgramEnd,
      afterExecutionStop,
      executionContext: definitionOnly
        ? "cycle-definition"
        : (afterProgramEnd ? "after-program-end" : (afterExecutionStop ? "after-blocked-execution" : "main")),
    };
  });
  let executableToolCalls = toolCalls.filter((call) => call.executable);
  const toolCallsByLine = new Map();
  for (const call of toolCalls) {
    if (!toolCallsByLine.has(call.line)) toolCallsByLine.set(call.line, []);
    toolCallsByLine.get(call.line).push(call);
  }
  for (const record of records) record.toolCalls = toolCallsByLine.get(record.line) || [];

  let pending = null;
  let semanticExecutionStopIndex = -1;
  for (const record of records) {
    if (state.programEnded || state.executionBlocked) break;
    if (definitionIndexes.has(record.index)) continue;
    if (!validateHaasRecordAddresses(record, state, warnings, {stopExecution: true})) {
      if (state.g112Active || state.unconfiguredG112Active) noteLiveToolAttempt(record, state, null);
      if (semanticExecutionStopIndex < 0) semanticExecutionStopIndex = record.index;
      continue;
    }
    if (!record.byLetter.size) continue;
    if (pending && state.liveToolDialect === "haas-lathe-ngc") {
      const isMatchingCycleBlock = hasG(record, pending.code === "G71" ? 71 : 72)
        && record.byLetter.has("P") && record.byLetter.has("Q");
      const hasExecutableContent = [...record.byLetter.keys()].some((letter) => !["N", "O"].includes(letter));
      if (hasExecutableContent && !isMatchingCycleBlock) {
        warningOnce(warnings, {
          line: pending.record.line,
          code: "unmatched-two-block-cycle",
          verificationBlocked: true,
          message: `${pending.code} first block has no immediately matching P/Q cycle block; execution is blocked instead of treating it as a no-op.`,
        });
        invalidateExecutionState(state);
        if (semanticExecutionStopIndex < 0) semanticExecutionStopIndex = pending.record.index;
        break;
      }
    }
    if (hasExecutionBoundary(record, state.liveToolDialect)) {
      if (hasG(record, 65)) updateModalState(record, state, warnings);
      else applyEndOfBlockMState(record, state, warnings, liveToolEvents, cAxisEvents);
      if (state.executionBlocked && semanticExecutionStopIndex < 0) semanticExecutionStopIndex = record.index;
      continue;
    }
    applyRecordToolCall(record, state, liveToolEvents);
    try {
      const enteringSupportedG112 = state.liveToolDialect === "haas-lathe-ngc" && hasG(record, 112);
      if (record.byLetter.has("Y") && !state.g112Active && !enteringSupportedG112) {
        updateModalState(record, state, warnings);
        warningOnce(warnings, {
          line: record.line,
          code: "direct-y-interpolation-unsupported",
          verificationBlocked: true,
          message: "Direct Y-axis motion outside G112 is not modeled and is blocked.",
        });
        invalidateUnsupportedPosition(record, state);
        continue;
      }
      const specialMotionCode = hasG(record, 28)
        ? "G28"
        : (hasG(record, 70) ? "G70" : (hasG(record, 71) ? "G71" : (hasG(record, 72) ? "G72" : null)));
      if (specialMotionCode) {
        const g112WasActive = state.g112Active;
        updateModalState(record, state, warnings);
        const inBoundedG112 = g112WasActive || state.g112Active || hasG(record, 112);
        const unsupportedSpecialAxes = ["C", "H", "Y"].filter((letter) => record.byLetter.has(letter));
        const blockedModalState = state.blockCurrentMotionLine === record.line
          || activeMotionBlocker(state)
          || state.unconfiguredG112Active;
        if (inBoundedG112 || blockedModalState || unsupportedSpecialAxes.length) {
          if (inBoundedG112) {
            noteLiveToolAttempt(record, state, specialMotionCode === "G28" ? "rapid" : "unsupported-cut");
          }
          const warningCode = inBoundedG112
            ? "g112-special-motion-unsupported"
            : (unsupportedSpecialAxes.length ? "special-motion-axis-combination-unsupported" : "special-motion-mode-unresolved");
          warningOnce(warnings, {
            line: record.line,
            code: warningCode,
            verificationBlocked: true,
            message: inBoundedG112
              ? `${specialMotionCode} is not modeled inside the bounded G112 implementation; the resulting position is unresolved.`
              : (unsupportedSpecialAxes.length
                ? `${specialMotionCode} combined with ${unsupportedSpecialAxes.join("/")} is not modeled; all affected positions are unresolved.`
                : `${specialMotionCode} is blocked while ${activeMotionBlocker(state) || "an unsupported code"} leaves motion semantics unresolved.`),
          });
          state.x = null;
          state.z = null;
          state.xUncertaintyMm = null;
          state.zUncertaintyMm = null;
          state.cAxisPosition = null;
          state.cAxisPositionUncertaintyDegrees = null;
          state.faceX = null;
          state.faceY = null;
          state.faceZ = null;
          state.faceXUncertaintyMm = null;
          state.faceYUncertaintyMm = null;
          state.faceZUncertaintyMm = null;
          state.g112PathTainted = true;
          if (unsupportedSpecialAxes.some((letter) => letter === "C" || letter === "H")) {
            cAxisMotions.push({
              line: record.line,
              type: "rapid-index",
              start: null,
              end: null,
              combinedWithLinearAxes: false,
              blocked: true,
              reason: warningCode,
              verificationIssues: [warningCode],
            });
          }
          continue;
        }
      }
      if (hasG(record, 4)) {
        updateModalState(record, state, warnings);
        const secondsWord = record.byLetter.has("X")
          ? interpretedHaasAddressValue(record, "X", state)
          : (record.byLetter.has("U") ? interpretedHaasAddressValue(record, "U", state) : undefined);
        const millisecondsWord = lastWord(record, "P");
        const pLexeme = lastWordLexeme(record, "P");
        const seconds = Number.isFinite(secondsWord)
          ? secondsWord
          : (Number.isFinite(millisecondsWord)
            ? (pLexeme?.includes(".") ? millisecondsWord : millisecondsWord / 1000)
            : NaN);
        if (seconds >= 0) timingEvents.push({type: "dwell", line: record.line, seconds});
        else warnings.push({line: record.line, message: "G04 dwell needs nonnegative X/U seconds, integer P milliseconds, or decimal-point P seconds for cycle-time estimation."});
        continue;
      }
      if (hasG(record, 28)) {
        segments.push(...parseReferenceReturn(record, state, xMode, warnings));
        continue;
      }
      if (hasG(record, 71) || hasG(record, 72)) {
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
          if (state.liveToolDialect === "haas-lathe-ngc") {
            warningOnce(warnings, {
              line: record.line,
              code: "cycle-contour-reference-unresolved",
              verificationBlocked: true,
              message: `${code} cannot find contour blocks P${p} through Q${q}; execution is blocked at the invalid cycle call.`,
            });
            invalidateExecutionState(state);
          } else {
            warnings.push({line: record.line, message: `${code} cannot find contour blocks P${p} through Q${q}.`});
          }
          continue;
        }
        if (!Number.isFinite(call.depth) || call.depth <= 0) {
          const message = `${code} needs a positive depth of cut (${code === "G71" ? "U or D" : "W or D"}).`;
          if (state.liveToolDialect === "haas-lathe-ngc") {
            warningOnce(warnings, {line: record.line, code: "cycle-depth-invalid", verificationBlocked: true, message: `${message} Execution is blocked.`});
            invalidateExecutionState(state);
          } else warnings.push({line: record.line, message});
          continue;
        }
        if (!isKnownPoint(state) || state.turningPathTainted) {
          const message = state.turningPathTainted
            ? `${code} cannot be expanded until a complete absolute G0 X/Z re-establishes the turning baseline.`
            : `${code} cannot be expanded until the current X/Z position is known.`;
          if (state.liveToolDialect === "haas-lathe-ngc") {
            warningOnce(warnings, {line: record.line, code: "cycle-start-position-unresolved", verificationBlocked: true, message: `${message} Execution is blocked.`});
            invalidateExecutionState(state);
          } else warnings.push({line: record.line, message});
          continue;
        }
        if (Number.isFinite(call.feed)) state.feed = call.feed;
        const contour = contourFor(records, startIndex, endIndex, state, xMode, warnings);
        if (!contour.validTurningContour) {
          warningOnce(warnings, {
            line: record.line,
            code: "cycle-contour-unresolved",
            verificationBlocked: true,
            message: `${code} is blocked because its P/Q definition is not a fully modeled, verification-clear X/Z turning contour.`,
          });
          state.x = null;
          state.z = null;
          state.xUncertaintyMm = null;
          state.zUncertaintyMm = null;
          state.cAxisPosition = null;
          state.cAxisPositionUncertaintyDegrees = null;
          continue;
        }
        const geometry = profileGeometry(contour.segments);
        const expanded = expandCycle({
          code, start: {x: state.x, z: state.z}, geometry,
          startUncertaintyMm: physicalPointUncertaintyMm(
            {x: state.xUncertaintyMm, z: state.zUncertaintyMm},
            xMode === "diameter" ? 0.5 : 1,
          ),
          depth: call.depth, retract: call.retract, finishU: call.finishU, finishW: call.finishW,
          xMode, line: record.line, p, q, rapidState: state,
        });
        segments.push(...expanded.segments);
        warnings.push(...expanded.warnings);
        cycles.push({code, line: record.line, p, q, passes: expanded.passes, type: expanded.type, truncated: expanded.truncated});
        continue;
      }

      if (hasG(record, 70)) {
        const p = lastWord(record, "P");
        const q = lastWord(record, "Q");
        const startIndex = sequenceIndex(records, p);
        const endIndex = sequenceIndex(records, q);
        if (startIndex < 0 || endIndex < startIndex) {
          if (state.liveToolDialect === "haas-lathe-ngc") {
            warningOnce(warnings, {
              line: record.line,
              code: "cycle-contour-reference-unresolved",
              verificationBlocked: true,
              message: `G70 cannot find contour blocks P${p} through Q${q}; execution is blocked at the invalid cycle call.`,
            });
            invalidateExecutionState(state);
          } else {
            warnings.push({line: record.line, message: `G70 cannot find contour blocks P${p} through Q${q}.`});
          }
          continue;
        }
        if (state.turningPathTainted) {
          warningOnce(warnings, {
            line: record.line,
            code: "cycle-start-position-unresolved",
            verificationBlocked: true,
            message: "G70 cannot execute until a complete absolute G0 X/Z re-establishes the turning baseline.",
          });
          continue;
        }
        const contour = contourFor(records, startIndex, endIndex, state, xMode, warnings);
        if (!contour.validTurningContour) {
          warningOnce(warnings, {
            line: record.line,
            code: "cycle-contour-unresolved",
            verificationBlocked: true,
            message: "G70 is blocked because its P/Q definition is not a fully modeled, verification-clear X/Z turning contour.",
          });
          state.x = null;
          state.z = null;
          state.xUncertaintyMm = null;
          state.zUncertaintyMm = null;
          state.cAxisPosition = null;
          state.cAxisPositionUncertaintyDegrees = null;
          continue;
        }
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
            spindleRunning: state.spindleRunning,
            spindleDirection: state.spindleDirection,
          });
        }
        state.x = contour.state.x;
        state.z = contour.state.z;
        state.xUncertaintyMm = contour.state.xUncertaintyMm;
        state.zUncertaintyMm = contour.state.zUncertaintyMm;
        cycles.push({code: "G70", line: record.line, p, q, passes: 1, type: "finish"});
        continue;
      }

      const segment = parseBasicRecord(record, state, xMode, warnings, {liveToolEvents, cAxisMotions});
      if (segment) segments.push(segment);
    } finally {
      applyEndOfBlockMState(record, state, warnings, liveToolEvents, cAxisEvents);
      if (state.executionBlocked && semanticExecutionStopIndex < 0) semanticExecutionStopIndex = record.index;
    }
  }

  if (pending && state.liveToolDialect === "haas-lathe-ngc") {
    warningOnce(warnings, {
      line: pending.record.line,
      code: "unmatched-two-block-cycle",
      verificationBlocked: true,
      message: `${pending.code} first block has no matching P/Q cycle block; execution is blocked instead of treating it as a no-op.`,
    });
    invalidateExecutionState(state);
    if (semanticExecutionStopIndex < 0 || pending.record.index < semanticExecutionStopIndex) {
      semanticExecutionStopIndex = pending.record.index;
    }
  }

  if (semanticExecutionStopIndex >= 0) {
    toolCalls = toolCalls.map((call) => {
      if (call.line - 1 < semanticExecutionStopIndex) return call;
      return {
        ...call,
        executable: false,
        afterExecutionStop: true,
        executionContext: "after-blocked-execution",
      };
    });
    executableToolCalls = toolCalls.filter((call) => call.executable);
  }
  const spindleEvents = programSpindleEvents(records, definitionIndexes, state.liveToolDialect, semanticExecutionStopIndex);

  if (pending && state.liveToolDialect !== "haas-lathe-ngc") {
    warnings.push({line: pending.record.line, message: `${pending.code} first block has no matching P/Q cycle block.`});
  }
  if (warnOnAssumedUnits && state.assumedUnitsUsed) {
    const label = normalizedDefaultUnits === "in" ? "inches" : "millimeters";
    warnings.unshift({line: null, info: true, message: `No G20/G21 was found before motion; Program units are assuming ${label}.`});
  }
  const liveToolAttempts = [...state.liveToolAttempts.values()].map((attempt) => {
    const sameLine = segments.filter((segment) => (segment.liveTool || segment.machiningMode === "live-tool")
      && (segment.executionLine || segment.line) === attempt.line);
    const blockedBySegment = sameLine.some((segment) => segment.verificationBlocked || segment.liveToolBlocked);
    const blockedByWarning = warnings.some((warning) => warning.line === attempt.line && warning.verificationBlocked);
    return {
      ...attempt,
      displayed: sameLine.length > 0,
      blocked: blockedBySegment || blockedByWarning,
    };
  });
  return {
    segments, warnings, cycles, toolCalls, executableToolCalls, units: state.units, sourceLines: lines.length,
    timingEvents, spindleEvents, dwellSeconds: timingEvents.reduce((sum, event) => sum + event.seconds, 0),
    unitsSource: state.assumedUnitsUsed ? "assumed" : "program",
    liveToolEvents,
    liveToolAttempts,
    cAxisEvents,
    cAxisMotions,
    machineState: {
      liveToolDialect: state.liveToolDialect,
      liveToolCapability: state.liveToolCapability,
      liveToolRunning: state.liveToolRunning,
      liveToolDirection: state.liveToolDirection,
      liveToolSpeed: state.liveToolSpeed,
      liveToolMaxRpm: state.liveToolMaxRpm,
      haasDefaultToFloat: state.haasDefaultToFloat,
      haasIntegerFeedScale: state.haasIntegerFeedScale,
      liveToolSpeedOverLimit: state.liveToolSpeedOverLimit,
      cAxisCapability: state.cAxisCapability,
      yAxisCapability: state.yAxisCapability,
      cAxisEngagement: state.cAxisEngagementMode,
      cAxisEngaged: state.cAxisEngaged,
      cAxisEngagementSource: state.cAxisEngagementSource,
      cAxisPosition: state.cAxisPosition,
      cAxisPositionUncertaintyDegrees: state.cAxisPositionUncertaintyDegrees,
      plane: state.plane,
      coordinateMode: state.g112Active ? "g112-face" : "turning-xz",
      feedMode: state.feedMode,
      spindleRunning: state.spindleRunning,
      spindleDirection: state.spindleDirection,
      turningMode: state.turningMode,
      turningPathTainted: state.turningPathTainted,
      executionBlocked: state.executionBlocked,
    },
  };
}

export function spindleStateAtLine(events, sourceLine) {
  const line = Math.max(0, Math.trunc(Number(sourceLine) || 0));
  let state = {direction: "unknown", running: null};
  for (const event of Array.isArray(events) ? events : []) {
    if (!Number.isFinite(event?.line)) continue;
    if (event.line > line) break;
    state = {
      direction: event.direction === "m3" || event.direction === "m4" ? event.direction : "unknown",
      running: typeof event.running === "boolean" ? event.running : null,
    };
  }
  return state;
}

export function segmentLength(segment, xScale = 1) {
  let total = 0;
  for (let index = 1; index < segment.points.length; index += 1) {
    const effectiveXScale = segment?.xCoordinateMode === "radius" ? 1 : xScale;
    const before = segment.points[index - 1];
    const after = segment.points[index];
    total += Math.hypot(
      (after.x - before.x) * effectiveXScale,
      (after.y ?? 0) - (before.y ?? 0),
      after.z - before.z,
    );
  }
  return total;
}

export function programBounds(segments, xScale = 1) {
  const scaledPoints = segments.flatMap((segment) => {
    const effectiveXScale = segment?.xCoordinateMode === "radius" ? 1 : xScale;
    return (segment?.points || []).map((point) => ({
      x: point.x * effectiveXScale,
      y: Number.isFinite(point.y) ? point.y : null,
      z: point.z,
    }));
  });
  if (!scaledPoints.length) return null;
  const xs = scaledPoints.map((point) => point.x);
  const zs = scaledPoints.map((point) => point.z);
  const bounds = {minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs)};
  const ys = scaledPoints.map((point) => point.y).filter(Number.isFinite);
  if (ys.length) {
    bounds.minY = Math.min(...ys);
    bounds.maxY = Math.max(...ys);
  }
  return bounds;
}
