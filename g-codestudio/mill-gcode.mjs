const TAU = Math.PI * 2;
const DEFAULT_ARC_CHORD_TOLERANCE_MM = 0.0254;
export const MILL_NUMERICAL_BUDGET_MM = 0.00127;
export const MILL_PARSE_LIMITS = Object.freeze({
  maxSourceBytes: 8 * 1024 * 1024,
  maxRecords: 100_000,
  maxBlockCharacters: 4_096,
  maxWords: 250_000,
  maxSegments: 10_000,
  maxPoints: 100_000,
});

const MOTION_CODES = new Map([
  [0, "rapid"],
  [1, "linear"],
  [2, "arc-cw"],
  [3, "arc-ccw"],
]);
const SUPPORTED_G_CODES = new Set([
  0, 1, 2, 3, 4,
  17, 18, 19, 20, 21,
  40, 43, 49, 54, 80,
  90, 91, 90.1, 91.1, 94,
]);
const SUPPORTED_M_CODES = new Set([2, 3, 4, 5, 6, 7, 8, 9, 30]);
const ALLOWED_ADDRESSES = new Set([
  "N", "O", "G", "M", "T", "S", "F",
  "X", "Y", "Z", "I", "J", "R", "H", "P",
]);
const ROTARY_OR_AUXILIARY_AXES = new Set(["A", "B", "C", "U", "V", "W", "E"]);
const CONTROL_FLOW_M_CODES = new Set([97, 98, 99]);
const CANNED_CYCLE_CODES = new Set([73, 81, 82, 83, 84, 85, 86, 87, 88, 89]);
const WORK_FRAME_CODES = new Set([53, 54, 55, 56, 57, 58, 59]);
const TRANSFORM_CODES = new Set([10, 28, 30, 50, 51, 52, 68, 69, 92]);
const CONTROL_FLOW_G_CODES = new Set([65, 66, 67]);
const EPSILON = 1e-12;
export const MILL_MAX_ARC_POINTS = 4097;

function finite(value) {
  return Number.isFinite(value);
}

function finitePoint(point) {
  return finite(point?.x) && finite(point?.y) && finite(point?.z);
}

function boundedSum(...terms) {
  const total = terms.reduce((sum, term) => sum + Math.max(0, Number(term) || 0), 0);
  return finite(total) ? total : Number.MAX_VALUE;
}

function numericUncertainty(value, ulps = 8) {
  if (!finite(value)) return Number.MAX_VALUE;
  const uncertainty = Number.EPSILON * ulps * Math.max(1, Math.abs(value));
  return finite(uncertainty) ? uncertainty : Number.MAX_VALUE;
}

function requiredUncertainty(value) {
  return finite(value) && value >= 0 ? value : Number.MAX_VALUE;
}

function pointUncertainty(axisUncertainty) {
  const uncertainty = Math.hypot(
    requiredUncertainty(axisUncertainty?.x),
    requiredUncertainty(axisUncertainty?.y),
    requiredUncertainty(axisUncertainty?.z),
  );
  return finite(uncertainty) ? uncertainty : Number.MAX_VALUE;
}

function clonePoint(point) {
  return {x: point.x, y: point.y, z: point.z};
}

function warningFor(line, code, message, verificationBlocked = true) {
  return {
    line,
    code,
    message,
    verificationBlocked,
    ...(verificationBlocked ? {danger: true} : {info: true}),
  };
}

function stripComments(raw) {
  let clean = "";
  let commentDepth = 0;
  let error = null;
  for (const character of String(raw)) {
    if (character === ";" && commentDepth === 0) break;
    if (character === "(") {
      if (commentDepth > 0 && !error) error = "Nested parenthetical comments are not supported.";
      commentDepth += 1;
      clean += " ";
      continue;
    }
    if (character === ")") {
      if (commentDepth === 0) {
        if (!error) error = "The block contains an unmatched closing parenthesis.";
      } else {
        commentDepth -= 1;
      }
      clean += " ";
      continue;
    }
    clean += commentDepth > 0 ? " " : character;
  }
  if (commentDepth > 0 && !error) error = "The block contains an unterminated parenthetical comment.";
  return {clean: clean.trim(), ...(error ? {error} : {})};
}

function recordFor(raw, index, resourceTracker = null) {
  const line = index + 1;
  const stripped = stripComments(raw);
  if (stripped.error) return {raw, line, index, clean: String(stripped.clean || "").toUpperCase(), error: stripped.error, words: [], byLetter: new Map()};
  const clean = stripped.clean.toUpperCase();
  if (!clean || clean === "%") return {raw, line, index, clean, words: [], byLetter: new Map()};
  if (clean.includes("%")) {
    return {raw, line, index, clean, error: "Percent delimiters must appear alone on a line.", words: [], byLetter: new Map()};
  }
  if (/^\s*\//.test(clean)) {
    return {raw, line, index, clean, errorCode: "block-delete-state-required", error: "Optional block-delete execution depends on unconfigured machine state.", words: [], byLetter: new Map()};
  }
  if (/[#[\]]/.test(clean) || /\b(?:IF|THEN|WHILE|DO|END|GOTO|CALL|RETURN)\b/.test(clean)) {
    return {raw, line, index, clean, errorCode: "macro-control-flow-unsupported", error: "Macro expressions and program control flow are not evaluated.", words: [], byLetter: new Map()};
  }

  const words = [];
  let cursor = 0;
  while (cursor < clean.length) {
    if (/\s/.test(clean[cursor])) {
      cursor += 1;
      continue;
    }
    const letter = clean[cursor];
    if (!/[A-Z]/.test(letter)) {
      return {raw, line, index, clean, error: `Unrecognized text begins at ${JSON.stringify(clean.slice(cursor, cursor + 12))}.`, words: [], byLetter: new Map()};
    }
    cursor += 1;
    while (cursor < clean.length && /\s/.test(clean[cursor])) cursor += 1;
    const match = clean.slice(cursor).match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)/);
    if (!match) {
      return {raw, line, index, clean, error: `${letter} requires a finite numeric value.`, words: [], byLetter: new Map()};
    }
    const lexeme = match[0];
    const value = Number(lexeme);
    if (!finite(value)) {
      return {raw, line, index, clean, error: `${letter}${lexeme} is outside the supported numeric range.`, words: [], byLetter: new Map()};
    }
    if (resourceTracker && resourceTracker.wordCount >= resourceTracker.maxWords) {
      resourceTracker.exceeded = true;
      return {
        raw,
        line,
        index,
        clean,
        errorCode: "mill-source-word-budget",
        error: `Mill source exceeds the bounded ${resourceTracker.maxWords.toLocaleString("en-US")}-word parser limit.`,
        words: [],
        byLetter: new Map(),
      };
    }
    words.push({letter, value, lexeme});
    if (resourceTracker) resourceTracker.wordCount += 1;
    cursor += lexeme.length;
  }

  const byLetter = new Map();
  for (const word of words) {
    if (!byLetter.has(word.letter)) byLetter.set(word.letter, []);
    byLetter.get(word.letter).push(word);
  }
  return {raw, line, index, clean, words, byLetter};
}

function words(record, letter) {
  return record.byLetter.get(letter) || [];
}

function word(record, letter) {
  return words(record, letter).at(-1) || null;
}

function hasG(record, code) {
  return words(record, "G").some((item) => item.value === code);
}

function modalConflict(record, codes, label) {
  const selected = [...new Set(words(record, "G").map((item) => item.value).filter((code) => codes.has(code)))];
  return selected.length > 1 ? label : null;
}

function normalizedUnits(value) {
  return value === "inch" || value === "in" ? "in" : "mm";
}

function scaledWord(sourceWord, scale) {
  if (!sourceWord) return null;
  const value = sourceWord.value * scale;
  const exactMetricInteger = scale === 1 && /^[+-]?\d+$/.test(sourceWord.lexeme)
    && Number.isSafeInteger(sourceWord.value);
  const uncertaintyMm = exactMetricInteger ? numericUncertainty(value) : boundedSum(
    numericUncertainty(sourceWord.value) * Math.abs(scale),
    numericUncertainty(scale) * Math.abs(sourceWord.value),
    numericUncertainty(value),
  );
  return {value, uncertaintyMm, lexeme: sourceWord.lexeme};
}

function resolveCoordinate(current, currentUncertaintyMm, address, absolute) {
  if (!address) return {value: current, uncertaintyMm: currentUncertaintyMm};
  if (absolute) return {value: address.value, uncertaintyMm: address.uncertaintyMm};
  if (!finite(current)) return {value: null, uncertaintyMm: null};
  const value = current + address.value;
  return {
    value,
    uncertaintyMm: boundedSum(
      requiredUncertainty(currentUncertaintyMm),
      address.uncertaintyMm,
      numericUncertainty(value),
    ),
  };
}

function currentPoint(state) {
  return {x: state.x, y: state.y, z: state.z};
}

function currentAxisUncertainty(state) {
  return {x: state.xUncertaintyMm, y: state.yUncertaintyMm, z: state.zUncertaintyMm};
}

function resolveEndpoint(record, state) {
  const x = resolveCoordinate(state.x, state.xUncertaintyMm, scaledWord(word(record, "X"), state.scale), state.absolute);
  const y = resolveCoordinate(state.y, state.yUncertaintyMm, scaledWord(word(record, "Y"), state.scale), state.absolute);
  const z = resolveCoordinate(state.z, state.zUncertaintyMm, scaledWord(word(record, "Z"), state.scale), state.absolute);
  return {
    point: {x: x.value, y: y.value, z: z.value},
    uncertainty: {x: x.uncertaintyMm, y: y.uncertaintyMm, z: z.uncertaintyMm},
  };
}

function applyEndpoint(state, endpoint) {
  state.x = endpoint.point.x;
  state.y = endpoint.point.y;
  state.z = endpoint.point.z;
  state.xUncertaintyMm = endpoint.uncertainty.x;
  state.yUncertaintyMm = endpoint.uncertainty.y;
  state.zUncertaintyMm = endpoint.uncertainty.z;
}

function normalizedSweep(startAngle, endAngle, clockwise, fullCircle = false) {
  if (fullCircle) return clockwise ? -TAU : TAU;
  let sweep = endAngle - startAngle;
  if (clockwise) {
    while (sweep >= 0) sweep -= TAU;
  } else {
    while (sweep <= 0) sweep += TAU;
  }
  return sweep;
}

function arcPoints(start, end, center, radius, sweep, chordTolerance, maximumPoints = Infinity) {
  const ratio = Math.min(1, Math.max(0, chordTolerance / radius));
  const maximumAngle = ratio >= 1 ? Math.PI : 2 * Math.acos(Math.max(-1, 1 - ratio));
  const requiredPieces = Math.max(1, Math.ceil(Math.abs(sweep) / Math.max(maximumAngle, EPSILON)));
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  if (!Number.isSafeInteger(requiredPieces) || requiredPieces > MILL_MAX_ARC_POINTS - 1) {
    return {
      points: [clonePoint(start), clonePoint(end)],
      startAngle,
      displayBlocked: true,
      requiredPoints: Number.isSafeInteger(requiredPieces) ? requiredPieces + 1 : Number.MAX_SAFE_INTEGER,
    };
  }
  if (requiredPieces + 1 > maximumPoints) {
    return {
      points: [],
      startAngle,
      displayBlocked: false,
      aggregateBlocked: true,
      requiredPoints: requiredPieces + 1,
    };
  }
  const pieces = requiredPieces;
  const points = [];
  for (let index = 0; index <= pieces; index += 1) {
    const fraction = index / pieces;
    const angle = startAngle + sweep * fraction;
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
      z: start.z + (end.z - start.z) * fraction,
    });
  }
  points[0] = clonePoint(start);
  points[points.length - 1] = clonePoint(end);
  return {points, startAngle, displayBlocked: false, aggregateBlocked: false, requiredPoints: pieces + 1};
}

function boundedResourceLimit(value, fallback) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? Math.min(numeric, fallback) : fallback;
}

function sourceRecordCountThrough(text, maximum) {
  let count = 1;
  for (let index = 0; index < text.length && count <= maximum; index += 1) {
    if (text.charCodeAt(index) === 10) count += 1;
  }
  return count;
}

export function millSourceRecordSummary(source, {maxRecords = MILL_PARSE_LIMITS.maxRecords} = {}) {
  const maximum = boundedResourceLimit(maxRecords, MILL_PARSE_LIMITS.maxRecords);
  const text = String(source ?? "");
  let count = 1;
  for (let index = 0; index < text.length && count <= maximum; index += 1) {
    const character = text.charCodeAt(index);
    if (character === 13) {
      if (text.charCodeAt(index + 1) === 10) index += 1;
      count += 1;
    } else if (character === 10) {
      count += 1;
    }
  }
  return {count, exceeded: count > maximum, maxRecords: maximum};
}

function oversizedSourceBlockLine(text, maximumCharacters) {
  let line = 1;
  let length = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
      length = 0;
    } else {
      length += 1;
      if (length > maximumCharacters) return line;
    }
  }
  return null;
}

function sourceUtf8BytesThrough(text, maximum) {
  let bytes = 0;
  for (let index = 0; index < text.length && bytes <= maximum;) {
    const codePoint = text.codePointAt(index);
    index += codePoint > 0xffff ? 2 : 1;
    bytes += codePoint <= 0x7f ? 1 : (codePoint <= 0x7ff ? 2 : (codePoint <= 0xffff ? 3 : 4));
  }
  return bytes;
}

function lexicalWordCountThrough(text, maximum) {
  let count = 0;
  let commentDepth = 0;
  let semicolonComment = false;
  const isDigit = (code) => code >= 48 && code <= 57;
  const afterElidedWhitespace = (start) => {
    let cursor = start;
    let depth = 0;
    while (cursor < text.length) {
      const character = text.charCodeAt(cursor);
      if (character === 10 || (character === 59 && depth === 0)) break;
      if (character === 40) {
        depth += 1;
        cursor += 1;
        continue;
      }
      if (character === 41) {
        if (depth > 0) depth -= 1;
        cursor += 1;
        continue;
      }
      if (depth > 0 || /\s/.test(text[cursor])) {
        cursor += 1;
        continue;
      }
      break;
    }
    return cursor;
  };

  for (let index = 0; index < text.length && count <= maximum; index += 1) {
    const character = text.charCodeAt(index);
    if (character === 10) {
      commentDepth = 0;
      semicolonComment = false;
      continue;
    }
    if (semicolonComment) continue;
    if (character === 59 && commentDepth === 0) {
      semicolonComment = true;
      continue;
    }
    if (character === 40) {
      commentDepth += 1;
      continue;
    }
    if (character === 41) {
      if (commentDepth > 0) commentDepth -= 1;
      continue;
    }
    if (commentDepth > 0) continue;

    const upper = character >= 97 && character <= 122 ? character - 32 : character;
    if (upper < 65 || upper > 90) continue;
    let cursor = afterElidedWhitespace(index + 1);
    if (text.charCodeAt(cursor) === 43 || text.charCodeAt(cursor) === 45) cursor += 1;
    let digits = 0;
    while (isDigit(text.charCodeAt(cursor))) {
      cursor += 1;
      digits += 1;
    }
    if (text.charCodeAt(cursor) === 46) {
      cursor += 1;
      while (isDigit(text.charCodeAt(cursor))) {
        cursor += 1;
        digits += 1;
      }
    }
    if (!digits) continue;
    count += 1;
    index = cursor - 1;
  }
  return count;
}

export function millSourceByteSummary(source, {maxSourceBytes = MILL_PARSE_LIMITS.maxSourceBytes} = {}) {
  const maximum = boundedResourceLimit(maxSourceBytes, MILL_PARSE_LIMITS.maxSourceBytes);
  const countedBytes = sourceUtf8BytesThrough(String(source ?? ""), maximum);
  return {countedBytes, exceeded: countedBytes > maximum, maxSourceBytes: maximum};
}

function positiveAngle(angle) {
  const normalized = angle % TAU;
  return normalized < 0 ? normalized + TAU : normalized;
}

function analyticArc(segment) {
  return (segment?.type === "arc-cw" || segment?.type === "arc-ccw")
    && finitePoint(segment.start)
    && finitePoint(segment.end)
    && finite(segment?.center?.x)
    && finite(segment?.center?.y)
    && finite(segment.radius)
    && segment.radius > 0
    && finite(segment.startAngle)
    && finite(segment.sweep)
    && Math.abs(segment.sweep) > EPSILON;
}

function authoritativeSegmentPoints(segment) {
  if (!analyticArc(segment)) {
    if (!Array.isArray(segment?.points) || segment.points.some((point) => !finitePoint(point))) {
      throw new RangeError("Mill geometry requires finite XYZ segment points");
    }
    return segment.points;
  }

  const points = [clonePoint(segment.start), clonePoint(segment.end)];
  const sweepMagnitude = Math.abs(segment.sweep);
  const direction = Math.sign(segment.sweep);
  const angularTolerance = 64 * Number.EPSILON * Math.max(1, Math.abs(segment.startAngle), sweepMagnitude);
  for (const candidate of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const directedDelta = positiveAngle(direction > 0
      ? candidate - segment.startAngle
      : segment.startAngle - candidate);
    if (sweepMagnitude < TAU - angularTolerance && directedDelta > sweepMagnitude + angularTolerance) continue;
    const fraction = Math.min(1, directedDelta / sweepMagnitude);
    points.push({
      x: segment.center.x + Math.cos(candidate) * segment.radius,
      y: segment.center.y + Math.sin(candidate) * segment.radius,
      z: segment.start.z + (segment.end.z - segment.start.z) * fraction,
    });
  }
  return points;
}

/** Exact commanded-path length in canonical millimeters; display chords are never dimensional authority. */
export function millSegmentLengthMm(segment) {
  if (analyticArc(segment)) {
    return Math.hypot(segment.radius * Math.abs(segment.sweep), segment.end.z - segment.start.z);
  }
  const points = authoritativeSegmentPoints(segment);
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
      points[index].z - points[index - 1].z,
    );
  }
  return length;
}

/** Exact XYZ envelope for analytic mill arcs and canonical linear paths. */
export function millProgramBounds(segments = []) {
  if (!Array.isArray(segments)) throw new TypeError("Mill segments must be an array");
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let count = 0;
  for (const segment of segments) {
    for (const point of authoritativeSegmentPoints(segment)) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
      count += 1;
    }
  }
  return count ? {minX, maxX, minY, maxY, minZ, maxZ} : null;
}

/** Latest verified commanded XYZ at a stepped source position, including a pathless G00 baseline. */
export function millPositionAt(parsed, {sourceLine = Infinity, visibleCount = Infinity} = {}) {
  const numericLine = Number(sourceLine);
  const lineLimit = Number.isFinite(numericLine) ? numericLine : Infinity;
  const segments = Array.isArray(parsed?.segments) ? parsed.segments : [];
  const requestedCount = Number(visibleCount);
  const segmentLimit = requestedCount === Infinity
    ? segments.length
    : Math.max(0, Math.min(segments.length, Math.trunc(Number.isFinite(requestedCount) ? requestedCount : 0)));
  let latestLine = -Infinity;
  let latestPoint = null;
  for (const event of Array.isArray(parsed?.positionEvents) ? parsed.positionEvents : []) {
    const eventLine = Number(event?.line);
    if (eventLine > lineLimit || eventLine < latestLine) continue;
    latestLine = eventLine;
    latestPoint = finitePoint(event?.point) ? clonePoint(event.point) : null;
  }
  for (const segment of segments.slice(0, segmentLimit)) {
    const segmentLine = Number(segment?.line);
    if (segmentLine > lineLimit || segmentLine < latestLine) continue;
    const point = segment.verificationBlocked ? segment.start : segment.end;
    if (!finitePoint(point)) continue;
    latestLine = segmentLine;
    latestPoint = clonePoint(point);
  }
  return latestPoint;
}

function centerArcGeometry(record, state, start, end, startUncertainty, endUncertainty, clockwise) {
  const iWord = word(record, "I");
  const jWord = word(record, "J");
  if (!iWord && !jWord) return {error: "G02/G03 needs I/J center data or R radius data."};

  const scaledI = scaledWord(iWord, state.scale);
  const scaledJ = scaledWord(jWord, state.scale);
  let centerX;
  let centerY;
  let centerXUncertainty;
  let centerYUncertainty;
  if (state.arcCenterAbsolute) {
    if (!scaledI || !scaledJ) {
      return {error: "Absolute G90.1 arc centers require both I and J coordinates."};
    }
    centerX = scaledI.value;
    centerY = scaledJ.value;
    centerXUncertainty = scaledI.uncertaintyMm;
    centerYUncertainty = scaledJ.uncertaintyMm;
  } else {
    const i = scaledI || {value: 0, uncertaintyMm: 0};
    const j = scaledJ || {value: 0, uncertaintyMm: 0};
    centerX = start.x + i.value;
    centerY = start.y + j.value;
    centerXUncertainty = boundedSum(startUncertainty.x, i.uncertaintyMm, numericUncertainty(centerX));
    centerYUncertainty = boundedSum(startUncertainty.y, j.uncertaintyMm, numericUncertainty(centerY));
  }
  const center = {x: centerX, y: centerY};
  const startRadius = Math.hypot(start.x - center.x, start.y - center.y);
  const endRadius = Math.hypot(end.x - center.x, end.y - center.y);
  const centerUncertainty = Math.hypot(centerXUncertainty, centerYUncertainty);
  const startRadialUncertainty = boundedSum(
    Math.hypot(requiredUncertainty(startUncertainty.x), requiredUncertainty(startUncertainty.y)),
    centerUncertainty,
    numericUncertainty(startRadius, 16),
  );
  const endRadialUncertainty = boundedSum(
    Math.hypot(requiredUncertainty(endUncertainty.x), requiredUncertainty(endUncertainty.y)),
    centerUncertainty,
    numericUncertainty(endRadius, 16),
  );
  const mismatch = Math.abs(startRadius - endRadius);
  const permittedMismatch = boundedSum(startRadialUncertainty, endRadialUncertainty);
  if (!(startRadius > 0) || mismatch > permittedMismatch) {
    return {error: "I/J arc endpoints do not lie on one numerically consistent circle."};
  }
  const endpointSeparation = Math.hypot(end.x - start.x, end.y - start.y);
  const samePlanarEndpoint = endpointSeparation <= permittedMismatch;
  const fullCircle = !record.byLetter.has("X") && !record.byLetter.has("Y");
  if (samePlanarEndpoint && !fullCircle) {
    return {
      errorCode: "arc-endpoint-topology-ambiguous",
      error: "An I/J arc with an explicit X or Y endpoint is too close to the start to distinguish a tiny arc from a full circle; omit both planar endpoints to command a full circle.",
    };
  }
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  const sweep = normalizedSweep(startAngle, endAngle, clockwise, fullCircle);
  return {
    center,
    centerUncertaintyMm: centerUncertainty,
    radius: (startRadius + endRadius) / 2,
    radiusUncertaintyMm: Math.max(startRadialUncertainty, endRadialUncertainty, mismatch / 2),
    sweep,
    fullCircle,
  };
}

function radiusArcGeometry(record, state, start, end, startUncertainty, endUncertainty, clockwise) {
  const radiusWord = scaledWord(word(record, "R"), state.scale);
  if (!radiusWord || radiusWord.value === 0) return {error: "R-format G02/G03 needs a nonzero radius."};
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  const chordErrorX = boundedSum(
    requiredUncertainty(startUncertainty.x),
    requiredUncertainty(endUncertainty.x),
    numericUncertainty(dx, 16),
  );
  const chordErrorY = boundedSum(
    requiredUncertainty(startUncertainty.y),
    requiredUncertainty(endUncertainty.y),
    numericUncertainty(dy, 16),
  );
  const chordVectorUncertainty = Math.hypot(chordErrorX, chordErrorY);
  if (!(chord > chordVectorUncertainty)) return {error: "R-format same-endpoint arcs are ambiguous and are not modeled."};
  const radius = Math.abs(radiusWord.value);
  const halfChord = chord / 2;
  const radicand = radius * radius - halfChord * halfChord;
  const radicandUncertainty = boundedSum(
    2 * radius * radiusWord.uncertaintyMm,
    radiusWord.uncertaintyMm ** 2,
    chord * chordVectorUncertainty / 2,
    chordVectorUncertainty ** 2 / 4,
    numericUncertainty(radicand, 32),
  );
  if (radicand < -radicandUncertainty) return {error: "The programmed R radius is smaller than half of the XY chord."};
  const height = Math.sqrt(Math.max(0, radicand));
  const midpoint = {x: (start.x + end.x) / 2, y: (start.y + end.y) / 2};
  const perpendicular = {x: -dy / chord, y: dx / chord};
  const candidates = (height <= EPSILON ? [0] : [-1, 1]).map((sign) => {
    const center = {
      x: midpoint.x + perpendicular.x * height * sign,
      y: midpoint.y + perpendicular.y * height * sign,
    };
    const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
    const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
    const sweep = normalizedSweep(startAngle, endAngle, clockwise);
    return {center, sweep};
  });
  const wantsMajor = radiusWord.value < 0;
  const selected = candidates.find((candidate) => wantsMajor
    ? Math.abs(candidate.sweep) >= Math.PI - EPSILON
    : Math.abs(candidate.sweep) <= Math.PI + EPSILON);
  if (!selected) return {error: "The signed R word does not select an unambiguous directed arc."};

  const lowerHeight = Math.sqrt(Math.max(0, radicand - radicandUncertainty));
  const upperHeight = Math.sqrt(Math.max(0, radicand + radicandUncertainty));
  const heightUncertainty = Math.max(height - lowerHeight, upperHeight - height);
  const normalError = Math.min(2, 2 * chordVectorUncertainty / (chord - chordVectorUncertainty));
  const directionUncertainty = (height + heightUncertainty) * normalError;
  const centerUncertaintyMm = boundedSum(
    chordVectorUncertainty / 2,
    heightUncertainty,
    directionUncertainty,
    numericUncertainty(selected.center.x),
    numericUncertainty(selected.center.y),
  );
  return {
    ...selected,
    centerUncertaintyMm,
    radius,
    radiusUncertaintyMm: radiusWord.uncertaintyMm,
    fullCircle: false,
  };
}

function timingSnapshot(state) {
  return {
    feed: state.feed,
    feedMode: state.feedMode || "unknown",
    programUnits: state.units,
    unitScale: state.scale,
    spindleSpeed: state.spindleSpeed,
    spindleMode: "rpm",
    spindleRunning: state.spindleRunning,
    spindleDirection: state.spindleDirection,
  };
}

function segmentBase(record, state, start, end, startUncertainty, endUncertainty) {
  return {
    start: clonePoint(start),
    end: clonePoint(end),
    line: record.line,
    raw: record.raw.trim(),
    machiningMode: "mill",
    coordinateMode: "mill-xyz",
    xCoordinateMode: "radius",
    plane: state.plane || "unknown",
    workFrame: state.workFrame,
    pathOnly: true,
    toolKey: state.activeToolKey,
    toolCallLine: state.activeToolCallLine,
    toolLengthCompensation: state.toolLengthCompensation.active
      ? {active: true, mode: "G43", h: state.toolLengthCompensation.h, sourceLine: state.toolLengthCompensation.line}
      : {active: false, mode: "G49", h: null, sourceLine: state.toolLengthCompensation.line},
    ...timingSnapshot(state),
    coordinateUncertaintyMm: {
      start: {...startUncertainty},
      end: {...endUncertainty},
    },
  };
}

function blockedChord(record, state, start, end, startUncertainty, endUncertainty, sourceMotion, issue) {
  const points = finitePoint(start) && finitePoint(end) ? [clonePoint(start), clonePoint(end)] : [];
  return {
    ...segmentBase(record, state, start, end, startUncertainty, endUncertainty),
    type: "linear",
    sourceMotion,
    points,
    geometryUncertaintyMm: Math.max(pointUncertainty(startUncertainty), pointUncertainty(endUncertainty)),
    verificationBlocked: true,
    verificationIssues: [issue],
  };
}

function classifyUnsupportedG(code) {
  if (code === 41 || code === 42) return ["cutter-compensation-unsupported", `G${code} cutter compensation is not modeled.`];
  if (CANNED_CYCLE_CODES.has(code)) return ["canned-cycle-unsupported", `G${code} canned-cycle motion is not modeled.`];
  if (WORK_FRAME_CODES.has(code) && code !== 54) return ["work-frame-unsupported", `G${code} machine/work-frame positioning is not modeled; only G54 commanded coordinates are supported.`];
  if (code === 31 || (code > 38 && code < 39)) return ["probing-unsupported", `G${code} probing motion is not modeled.`];
  if (CONTROL_FLOW_G_CODES.has(code)) return ["macro-control-flow-unsupported", `G${code} macro or control-flow execution is not modeled.`];
  if (TRANSFORM_CODES.has(code)) return ["coordinate-transform-unsupported", `G${code} reference return, offset write, or coordinate transform is not modeled.`];
  if (code === 95) return ["feed-mode-unsupported", "G95 feed-per-revolution is not modeled for the bounded mill path."];
  return ["unsupported-g-code", `G${code} is not modeled for the configured Fanuc-style mill path.`];
}

function classifyUnsupportedM(code) {
  if (CONTROL_FLOW_M_CODES.has(code)) return ["subprogram-control-flow-unsupported", `M${code} subprogram/control-flow execution is not modeled.`];
  return ["unsupported-m-code", `M${code} has unmodeled machine-state semantics.`];
}

function invalidToolWord(sourceWord) {
  return !sourceWord || !/^\+?\d+$/.test(sourceWord.lexeme) || !Number.isSafeInteger(sourceWord.value) || sourceWord.value < 0;
}

function exactIntegerCodeWord(sourceWord) {
  return Boolean(sourceWord && /^\+?\d+(?:\.0*)?$/.test(sourceWord.lexeme));
}

function exactArcCenterModeWord(sourceWord) {
  return Boolean(sourceWord && /^\+?0*(?:90|91)\.10*$/.test(sourceWord.lexeme));
}

function validateRecord(record) {
  if (record.error) return [record.errorCode || "malformed-program-address", record.error];
  const duplicate = [...record.byLetter.entries()].find(([letter, entries]) => !["G", "M"].includes(letter) && entries.length > 1);
  if (duplicate) return ["duplicate-program-address", `The block contains more than one ${duplicate[0]} address.`];
  const nonIntegerM = words(record, "M").find((entry) => !exactIntegerCodeWord(entry));
  if (nonIntegerM) return ["non-integer-m-code", `M${nonIntegerM.lexeme} is not an exact supported M code.`];
  const mCodes = [...new Set(words(record, "M").map((entry) => entry.value))];
  if (mCodes.length > 1) return ["multiple-m-codes", "More than one M code in a block is outside this bounded Fanuc-style contract."];
  const unsupportedM = mCodes.find((code) => !SUPPORTED_M_CODES.has(code));
  if (unsupportedM !== undefined) return classifyUnsupportedM(unsupportedM);
  const nonCanonicalG = words(record, "G").find((entry) => !exactIntegerCodeWord(entry) && !exactArcCenterModeWord(entry));
  if (nonCanonicalG) return ["unsupported-g-code", `G${nonCanonicalG.lexeme} is not an exact supported G code.`];
  const unsupportedG = words(record, "G").map((entry) => entry.value).find((code) => !SUPPORTED_G_CODES.has(code));
  if (unsupportedG !== undefined) return classifyUnsupportedG(unsupportedG);
  const unsupportedAddress = [...record.byLetter.keys()].find((letter) => !ALLOWED_ADDRESSES.has(letter));
  if (unsupportedAddress) {
    if (ROTARY_OR_AUXILIARY_AXES.has(unsupportedAddress)) {
      return ["rotary-axis-unsupported", `${unsupportedAddress}-axis motion is outside the bounded three-axis XYZ mill model.`];
    }
    return ["unsupported-program-address", `${unsupportedAddress} address semantics are not modeled.`];
  }

  const modalGroups = [
    [new Set([0, 1, 2, 3, 4, 80]), "motion"],
    [new Set([17, 18, 19]), "plane"],
    [new Set([20, 21]), "units"],
    [new Set([40, 41, 42]), "cutter compensation"],
    [new Set([43, 49]), "tool-length compensation"],
    [new Set([53, 54, 55, 56, 57, 58, 59]), "work frame"],
    [new Set([90, 91]), "distance"],
    [new Set([90.1, 91.1]), "arc-center distance"],
  ];
  for (const [codes, label] of modalGroups) {
    const conflict = modalConflict(record, codes, label);
    if (conflict) return ["multiple-modal-codes", `The block selects more than one ${conflict} code.`];
  }

  const toolWord = word(record, "T");
  if (toolWord && invalidToolWord(toolWord)) return ["tool-number-invalid", `T${toolWord.lexeme} is not a supported integer tool selection.`];
  for (const label of ["N", "O"]) {
    const labelWord = word(record, label);
    if (labelWord && invalidToolWord(labelWord)) {
      return ["program-label-invalid", `${label}${labelWord.lexeme} is not a supported nonnegative integer program label.`];
    }
  }
  const hWord = word(record, "H");
  if (hWord && (invalidToolWord(hWord) || !hasG(record, 43))) {
    return ["tool-length-offset-unresolved", "H must be a nonnegative integer selected in the same block as G43."];
  }
  if (hasG(record, 43) && !hWord) return ["tool-length-offset-unresolved", "G43 requires an explicit nonnegative integer H offset in this bounded model."];
  if (hasG(record, 4)) {
    const invalidDwellAddress = ["Y", "Z", "I", "J", "R", "H"].find((letter) => record.byLetter.has(letter));
    if (invalidDwellAddress) return ["dwell-address-unsupported", `G04 does not support ${invalidDwellAddress} in this bounded Fanuc-style model.`];
  } else if (record.byLetter.has("P")) {
    return ["unsupported-program-address", "P is supported only for G04 dwell in the bounded mill model."];
  }
  if (hasG(record, 80) && ["X", "Y", "Z", "I", "J", "R"].some((letter) => record.byLetter.has(letter))) {
    return ["canned-cycle-cancel-motion-unsupported", "G80 cancellation combined with geometry words is not modeled as motion."];
  }
  if (mCodes.includes(6) && ["X", "Y", "Z", "I", "J", "R"].some((letter) => record.byLetter.has(letter))) {
    return ["tool-change-motion-unsupported", "M06 combined with geometry words has unresolved machine-builder execution order and positioning semantics."];
  }
  return null;
}

function programEnvelopeIssue(records) {
  const malformedEnvelope = records.find((record) => record.error && (
    record.clean?.includes("%") || record.clean?.includes("O")
  ));
  if (malformedEnvelope) {
    const percent = malformedEnvelope.clean.includes("%");
    return {
      line: malformedEnvelope.line,
      code: percent ? "program-envelope-unsupported" : "program-header-malformed",
      message: percent
        ? "A percent delimiter is malformed; delimiters must appear alone as one leading and one trailing line."
        : "An attempted O program header is malformed and cannot define the single bounded tape program.",
    };
  }
  const programHeaders = records.filter((record) => record.byLetter?.has("O"));
  if (programHeaders.length > 1) {
    return {
      line: programHeaders[1].line,
      code: "multiple-program-envelope-unsupported",
      message: "More than one O program definition is outside the bounded single-program execution model.",
    };
  }
  if (programHeaders.length) {
    const header = programHeaders[0];
    if (header.words.some((entry) => entry.letter !== "N" && entry.letter !== "O")) {
      return {
        line: header.line,
        code: "program-header-block-unsupported",
        message: "The one optional O program header must not share a block with executable commands.",
      };
    }
  }

  const delimiters = records.filter((record) => record.clean === "%");
  const meaningful = records.filter((record) => Boolean(record.clean));
  if (delimiters.length && delimiters.length !== 2) {
    return {
      line: delimiters[Math.min(1, delimiters.length - 1)]?.line || 1,
      code: "program-envelope-unsupported",
      message: "Percent-delimited input requires exactly one leading and one trailing % delimiter.",
    };
  }
  if (delimiters.length === 2 && (meaningful[0] !== delimiters[0] || meaningful.at(-1) !== delimiters[1])) {
    const outside = meaningful.find((record) => record.index < delimiters[0].index || record.index > delimiters[1].index);
    return {
      line: outside?.line || delimiters[1].line,
      code: "program-envelope-unsupported",
      message: "Executable program text cannot appear outside the leading and trailing % delimiters.",
    };
  }

  if (programHeaders.length) {
    const header = programHeaders[0];
    const firstProgramRecord = records.find((record) => (
      Boolean(record.clean) && record.clean !== "%"
    ));
    if (firstProgramRecord !== header) {
      return {
        line: header.line,
        code: "program-header-position-unsupported",
        message: "The optional O program definition must be the first program block after the leading delimiter.",
      };
    }
  }
  return null;
}

function toolSelections(records) {
  const calls = [];
  const indexByLine = new Map();
  for (const record of records) {
    const selected = word(record, "T");
    if (!selected || invalidToolWord(selected)) continue;
    const key = `T${selected.lexeme.toUpperCase()}`;
    indexByLine.set(record.line, calls.length);
    calls.push({
      line: record.line,
      raw: selected.lexeme,
      key,
      address: key,
      valueLexeme: selected.lexeme,
      sourceLexeme: `T${selected.lexeme}`,
      value: selected.value,
      toolNumber: selected.value,
      executable: false,
      changed: false,
      executionContext: "unreached",
    });
  }
  return {calls, indexByLine};
}

function dwellSeconds(record) {
  const x = word(record, "X");
  const p = word(record, "P");
  if (x && p) return NaN;
  if (x) return x.value;
  if (!p) return NaN;
  return p.lexeme.includes(".") ? p.value : p.value / 1000;
}

/**
 * Parse the deliberately bounded Fanuc-style three-axis mill subset.
 * Geometry is canonical millimetre XYZ commanded-tool-center path. It does
 * not apply physical tool length, cutter compensation, stock removal, or
 * machine kinematics.
 */
export function parseMillGcode(source, {
  dialect = "fanuc-mill",
  initialPosition = null,
  defaultUnits = "mm",
  warnOnAssumedUnits = false,
  arcChordTolerance = DEFAULT_ARC_CHORD_TOLERANCE_MM,
  numericalBudgetMm = MILL_NUMERICAL_BUDGET_MM,
  limits = null,
} = {}) {
  const rawText = String(source ?? "");
  const resourceLimits = Object.freeze({
    maxSourceBytes: boundedResourceLimit(limits?.maxSourceBytes, MILL_PARSE_LIMITS.maxSourceBytes),
    maxRecords: boundedResourceLimit(limits?.maxRecords, MILL_PARSE_LIMITS.maxRecords),
    maxBlockCharacters: boundedResourceLimit(limits?.maxBlockCharacters, MILL_PARSE_LIMITS.maxBlockCharacters),
    maxWords: boundedResourceLimit(limits?.maxWords, MILL_PARSE_LIMITS.maxWords),
    maxSegments: boundedResourceLimit(limits?.maxSegments, MILL_PARSE_LIMITS.maxSegments),
    maxPoints: boundedResourceLimit(limits?.maxPoints, MILL_PARSE_LIMITS.maxPoints),
  });
  const sourceBytes = sourceUtf8BytesThrough(rawText, resourceLimits.maxSourceBytes);
  const byteLimitExceeded = sourceBytes > resourceLimits.maxSourceBytes;
  const text = byteLimitExceeded ? "" : rawText.replace(/\r\n?/g, "\n");
  const countedSourceLines = sourceRecordCountThrough(text, resourceLimits.maxRecords);
  const oversizedBlockLine = byteLimitExceeded ? null : oversizedSourceBlockLine(text, resourceLimits.maxBlockCharacters);
  const sourceLimitIssue = byteLimitExceeded
    ? {
      line: null,
      code: "mill-source-byte-budget",
      message: `Mill source exceeds the bounded ${resourceLimits.maxSourceBytes.toLocaleString("en-US")}-byte parser limit.`,
    }
    : (countedSourceLines > resourceLimits.maxRecords ? {
      line: null,
      code: "mill-source-record-budget",
      message: `Mill source exceeds the bounded ${resourceLimits.maxRecords.toLocaleString("en-US")}-record parser limit.`,
    } : (oversizedBlockLine !== null ? {
      line: oversizedBlockLine,
      code: "mill-source-block-budget",
      message: `Line ${oversizedBlockLine} exceeds the bounded ${resourceLimits.maxBlockCharacters.toLocaleString("en-US")}-character block limit.`,
    } : null));
  const countedLexicalWords = sourceLimitIssue ? 0 : lexicalWordCountThrough(text, resourceLimits.maxWords);
  const preflightWordIssue = countedLexicalWords > resourceLimits.maxWords ? {
    line: null,
    code: "mill-source-word-budget",
    message: `Mill source exceeds the bounded ${resourceLimits.maxWords.toLocaleString("en-US")}-word parser limit.`,
  } : null;
  const lines = sourceLimitIssue || preflightWordIssue ? [] : text.split("\n");
  const sourceLines = sourceLimitIssue || preflightWordIssue ? countedSourceLines : lines.length;
  const wordTracker = {wordCount: 0, maxWords: resourceLimits.maxWords, exceeded: false};
  const records = lines.map((raw, index) => recordFor(raw, index, wordTracker));
  const wordLimitRecord = wordTracker.exceeded
    ? records.find((record) => record.errorCode === "mill-source-word-budget")
    : null;
  const resourceIssue = sourceLimitIssue || preflightWordIssue || (wordLimitRecord ? {
    line: wordLimitRecord.line,
    code: wordLimitRecord.errorCode,
    message: wordLimitRecord.error,
  } : null);
  const warnings = [];
  const segments = [];
  const timingEvents = [];
  const spindleEvents = [];
  const coolantEvents = [];
  const toolChangeEvents = [];
  const positionEvents = [];
  const unresolvedRapidLines = [];
  const baselineRapidLines = [];
  const toolChangePositionLines = [];
  let geometryPointCount = 0;
  const {calls: toolCalls, indexByLine: toolCallIndexByLine} = toolSelections(records);
  const envelopeIssue = resourceIssue ? null : programEnvelopeIssue(records);
  const normalizedDialect = String(dialect || "").toLowerCase();
  const supportedDialect = normalizedDialect === "fanuc-mill" || normalizedDialect === "fanuc-style-mill";
  const configuredUnits = normalizedUnits(defaultUnits);
  const budget = finite(Number(numericalBudgetMm)) && Number(numericalBudgetMm) > 0
    ? Math.min(Number(numericalBudgetMm), MILL_NUMERICAL_BUDGET_MM)
    : MILL_NUMERICAL_BUDGET_MM;
  const chordTolerance = finite(Number(arcChordTolerance)) && Number(arcChordTolerance) > 0
    ? Number(arcChordTolerance)
    : DEFAULT_ARC_CHORD_TOLERANCE_MM;
  const suppliedInitial = initialPosition && typeof initialPosition === "object"
    && [initialPosition.x, initialPosition.y, initialPosition.z].every((value) => typeof value === "number" && finite(value));
  const initial = suppliedInitial
    ? {x: initialPosition.x, y: initialPosition.y, z: initialPosition.z}
    : {x: null, y: null, z: null};
  const state = {
    x: initial.x,
    y: initial.y,
    z: initial.z,
    xUncertaintyMm: finite(initial.x) ? numericUncertainty(initial.x) : null,
    yUncertaintyMm: finite(initial.y) ? numericUncertainty(initial.y) : null,
    zUncertaintyMm: finite(initial.z) ? numericUncertainty(initial.z) : null,
    units: configuredUnits,
    scale: configuredUnits === "in" ? 25.4 : 1,
    sawUnits: false,
    assumedUnitsUsed: false,
    absolute: null,
    arcCenterAbsolute: null,
    motion: null,
    plane: null,
    workFrame: null,
    workFrameSource: null,
    feedMode: null,
    cutterCompensationCleared: false,
    cannedCycleCancelled: false,
    feed: null,
    spindleSpeed: null,
    spindleRunning: null,
    spindleDirection: "unknown",
    coolant: "unknown",
    pendingToolKey: null,
    pendingToolLine: null,
    pendingToolIndex: null,
    activeToolKey: null,
    activeToolCallLine: null,
    toolLengthCompensation: {active: false, h: null, line: null},
    toolLengthStateKnown: false,
    executionBlocked: false,
    programEnded: false,
  };

  let semanticExecutionStopLine = null;
  let currentTransaction = null;
  let programEndLine = null;
  if (resourceIssue) {
    warnings.push(warningFor(resourceIssue.line, resourceIssue.code, `${resourceIssue.message} No program semantics were executed.`));
    state.executionBlocked = true;
    semanticExecutionStopLine = resourceIssue.line || 1;
  } else if (!supportedDialect) {
    warnings.push(warningFor(null, "mill-dialect-required", "A configured Fanuc-style mill dialect is required before mill semantics can execute."));
    state.executionBlocked = true;
    semanticExecutionStopLine = 1;
  } else if (envelopeIssue) {
    warnings.push(warningFor(envelopeIssue.line, envelopeIssue.code, `${envelopeIssue.message} No program semantics were executed.`));
    state.executionBlocked = true;
    semanticExecutionStopLine = envelopeIssue.line;
  }

  const rollbackCurrentRecord = () => {
    if (!currentTransaction) return;
    Object.assign(state, currentTransaction.state, {
      toolLengthCompensation: {...currentTransaction.state.toolLengthCompensation},
    });
    timingEvents.length = currentTransaction.timingEventsLength;
    spindleEvents.length = currentTransaction.spindleEventsLength;
    coolantEvents.length = currentTransaction.coolantEventsLength;
    toolChangeEvents.length = currentTransaction.toolChangeEventsLength;
    positionEvents.length = currentTransaction.positionEventsLength;
    toolChangePositionLines.length = currentTransaction.toolChangePositionLinesLength;
    for (const [call, snapshot] of currentTransaction.toolCallSnapshots) {
      for (const key of Object.keys(call)) delete call[key];
      Object.assign(call, snapshot);
    }
    currentTransaction = null;
  };

  const stopAt = (record, code, message) => {
    rollbackCurrentRecord();
    warnings.push(warningFor(record.line, code, `${message} Downstream semantic execution is stopped.`));
    state.executionBlocked = true;
    semanticExecutionStopLine ??= record.line;
  };

  const appendSegment = (segment) => {
    const pointCount = Array.isArray(segment?.points) ? segment.points.length : 0;
    if (segments.length >= resourceLimits.maxSegments
      || pointCount > resourceLimits.maxPoints - geometryPointCount) return false;
    segments.push(segment);
    geometryPointCount += pointCount;
    return true;
  };

  const stopForGeometryBudget = (record) => {
    stopAt(
      record,
      "mill-geometry-budget",
      `Mill geometry exceeds the bounded parser limit of ${resourceLimits.maxSegments.toLocaleString("en-US")} segments or ${resourceLimits.maxPoints.toLocaleString("en-US")} sampled points.`,
    );
  };

  const snapshotToolCall = (call) => {
    if (!currentTransaction || !call || currentTransaction.toolCallSnapshots.has(call)) return;
    currentTransaction.toolCallSnapshots.set(call, {...call});
  };

  for (const record of records) {
    currentTransaction = null;
    if (state.executionBlocked) break;
    if (state.programEnded) break;
    if (!record.byLetter.size && !record.error) continue;
    const invalid = validateRecord(record);
    if (invalid) {
      stopAt(record, invalid[0], invalid[1]);
      break;
    }

    currentTransaction = {
      state: {...state, toolLengthCompensation: {...state.toolLengthCompensation}},
      timingEventsLength: timingEvents.length,
      spindleEventsLength: spindleEvents.length,
      coolantEventsLength: coolantEvents.length,
      toolChangeEventsLength: toolChangeEvents.length,
      positionEventsLength: positionEvents.length,
      toolChangePositionLinesLength: toolChangePositionLines.length,
      toolCallSnapshots: new Map(),
    };

    const selectedToolIndex = toolCallIndexByLine.get(record.line);
    const selectedTool = selectedToolIndex === undefined ? null : toolCalls[selectedToolIndex];
    if (selectedTool) {
      snapshotToolCall(selectedTool);
      selectedTool.executable = true;
      selectedTool.executionContext = "main";
      state.pendingToolKey = selectedTool.key;
      state.pendingToolLine = selectedTool.line;
      state.pendingToolIndex = selectedToolIndex;
    }

    if (hasG(record, 20) || hasG(record, 21)) {
      state.units = hasG(record, 20) ? "in" : "mm";
      state.scale = state.units === "in" ? 25.4 : 1;
      state.sawUnits = true;
    }
    if (hasG(record, 90)) state.absolute = true;
    if (hasG(record, 91)) state.absolute = false;
    if (hasG(record, 90.1)) state.arcCenterAbsolute = true;
    if (hasG(record, 91.1)) state.arcCenterAbsolute = false;
    if (hasG(record, 94)) state.feedMode = "per-minute";
    if (hasG(record, 17)) state.plane = "G17";
    if (hasG(record, 18)) state.plane = "G18";
    if (hasG(record, 19)) state.plane = "G19";
    if (hasG(record, 54)) {
      state.workFrame = "G54";
      state.workFrameSource = "program";
    }
    if (hasG(record, 40)) state.cutterCompensationCleared = true;
    if (hasG(record, 80)) state.cannedCycleCancelled = true;
    if (hasG(record, 43)) {
      const h = word(record, "H");
      state.toolLengthCompensation = {active: true, h: h.value, line: record.line};
      state.toolLengthStateKnown = true;
    }
    if (hasG(record, 49)) {
      state.toolLengthCompensation = {active: false, h: null, line: record.line};
      state.toolLengthStateKnown = true;
    }
    if (hasG(record, 80)) state.motion = null;
    for (const gWord of words(record, "G")) {
      if (MOTION_CODES.has(gWord.value)) state.motion = MOTION_CODES.get(gWord.value);
    }

    const sWord = word(record, "S");
    if (sWord) {
      if (sWord.value < 0) {
        stopAt(record, "spindle-speed-invalid", "S spindle speed must be nonnegative.");
        break;
      }
      state.spindleSpeed = sWord.value;
    }
    const fWord = word(record, "F");
    if (fWord) {
      if (fWord.value < 0) {
        stopAt(record, "feed-invalid", "F feed must be nonnegative.");
        break;
      }
      state.feed = fWord.value;
    }

    const mCode = word(record, "M")?.value;
    if (mCode === 6) {
      if (!state.pendingToolKey) {
        stopAt(record, "tool-change-selection-required", "M06 requires an executable T selection in or before the block.");
        break;
      }
      state.activeToolKey = state.pendingToolKey;
      state.activeToolCallLine = state.pendingToolLine;
      const selection = state.pendingToolIndex === null ? null : toolCalls[state.pendingToolIndex];
      if (selection) {
        snapshotToolCall(selection);
        selection.changed = true;
        selection.changedAtLine = record.line;
      }
      toolChangeEvents.push({line: record.line, toolKey: state.activeToolKey, toolCallLine: state.activeToolCallLine});
      state.x = null;
      state.y = null;
      state.z = null;
      state.xUncertaintyMm = null;
      state.yUncertaintyMm = null;
      state.zUncertaintyMm = null;
      toolChangePositionLines.push(record.line);
      positionEvents.push({
        type: "tool-change-position-invalidated",
        line: record.line,
        point: null,
        incomingPathKnown: false,
        reason: "M06 machine-builder positioning is unconfigured",
      });
    } else if (mCode === 3 || mCode === 4) {
      state.spindleDirection = mCode === 3 ? "m3" : "m4";
      state.spindleRunning = true;
      spindleEvents.push({line: record.line, direction: state.spindleDirection, running: true});
    } else if (mCode === 5) {
      state.spindleRunning = false;
      spindleEvents.push({line: record.line, direction: state.spindleDirection, running: false});
    } else if (mCode === 7 || mCode === 8 || mCode === 9) {
      state.coolant = mCode === 7 ? "mist" : (mCode === 8 ? "flood" : "off");
      coolantEvents.push({line: record.line, command: `M${mCode}`, mode: state.coolant});
    }

    if (hasG(record, 4)) {
      const seconds = dwellSeconds(record);
      if (!finite(seconds) || seconds < 0) {
        stopAt(record, "dwell-invalid", "G04 requires one nonnegative X-seconds or P-duration word (integer P milliseconds; decimal P seconds).");
        break;
      }
      timingEvents.push({type: "dwell", line: record.line, seconds});
    } else {
      const hasAxes = ["X", "Y", "Z"].some((letter) => record.byLetter.has(letter));
      const hasArcData = ["I", "J", "R"].some((letter) => record.byLetter.has(letter));
      const arcMotion = state.motion === "arc-cw" || state.motion === "arc-ccw";
      if (!arcMotion && hasArcData) {
        stopAt(record, "linear-arc-data-unsupported", "I/J/R geometry is valid only for an active G02/G03 motion.");
        break;
      }
      if (arcMotion && record.byLetter.has("P")) {
        stopAt(record, "arc-turns-unsupported", "Multi-turn arc P semantics are not modeled.");
        break;
      }
      if (hasAxes || (arcMotion && hasArcData)) {
        if (state.motion === null) {
          stopAt(record, "mill-motion-mode-required", "An explicit G00, G01, G02, or G03 motion mode is required after startup or G80 before XYZ geometry can be interpreted.");
          break;
        }
        if (state.absolute === null) {
          stopAt(record, "mill-distance-mode-required", "An explicit G90 or G91 distance mode is required before XYZ geometry can be interpreted.");
          break;
        }
        if (state.plane !== "G17") {
          const code = state.plane ? "mill-plane-unsupported" : "mill-plane-required";
          const message = state.plane
            ? `${state.plane} is outside the bounded XY mill path; select G17 explicitly.`
            : "Explicit G17 plane selection is required before XYZ path geometry can be interpreted.";
          stopAt(record, code, message);
          break;
        }
        if (state.workFrame !== "G54") {
          stopAt(record, "mill-work-frame-required", "Explicit G54 selection is required before XYZ geometry can be interpreted.");
          break;
        }
        if (!state.cutterCompensationCleared) {
          stopAt(record, "mill-cutter-comp-state-required", "Explicit G40 is required before XYZ geometry so inherited cutter compensation cannot change the commanded centerline.");
          break;
        }
        if (!state.cannedCycleCancelled) {
          stopAt(record, "mill-cycle-state-required", "Explicit G80 is required before XYZ geometry so an inherited canned cycle cannot reinterpret coordinate-only blocks.");
          break;
        }
        if (!state.toolLengthStateKnown) {
          stopAt(record, "mill-tool-length-state-required", "Explicit G49 or G43 H is required before XYZ geometry so inherited tool-length state is not guessed.");
          break;
        }
        if (state.feedMode !== "per-minute") {
          stopAt(record, "mill-feed-mode-required", "Explicit G94 feed-per-minute mode is required before XYZ path geometry can be interpreted.");
          break;
        }
        const overflowAddress = ["X", "Y", "Z", "I", "J", "R"].find((letter) => {
          const sourceWord = word(record, letter);
          return sourceWord && !finite(sourceWord.value * state.scale);
        });
        if (overflowAddress) {
          stopAt(record, "mill-numerical-resolution", `${overflowAddress} cannot be converted to canonical millimeters as a finite coordinate.`);
          break;
        }
        if (!state.sawUnits) state.assumedUnitsUsed = true;
        const start = currentPoint(state);
        const startUncertainty = currentAxisUncertainty(state);
        const endpoint = resolveEndpoint(record, state);
        const end = endpoint.point;
        const endUncertainty = endpoint.uncertainty;

        if (arcMotion) {
          const sourceMotion = state.motion;
          if (!finitePoint(start) || !finitePoint(end)) {
            stopAt(record, "arc-start-position-unresolved", "G02/G03 needs a complete known XYZ start and end before its path can be modeled.");
            break;
          }
          if (record.byLetter.has("R") && (record.byLetter.has("I") || record.byLetter.has("J"))) {
            const blocked = blockedChord(record, state, start, end, startUncertainty, endUncertainty, sourceMotion, "arc-definition-conflict");
            if (!appendSegment(blocked)) stopForGeometryBudget(record);
            else stopAt(record, "arc-definition-conflict", "G02/G03 cannot combine R with I/J center data in this bounded model.");
            break;
          }
          if (!record.byLetter.has("R") && state.arcCenterAbsolute === null) {
            const blocked = blockedChord(record, state, start, end, startUncertainty, endUncertainty, sourceMotion, "arc-center-mode-required");
            if (!appendSegment(blocked)) stopForGeometryBudget(record);
            else stopAt(record, "arc-center-mode-required", "I/J arc geometry requires explicit G90.1 or G91.1 center-distance mode.");
            break;
          }
          const clockwise = state.motion === "arc-cw";
          const geometry = record.byLetter.has("R")
            ? radiusArcGeometry(record, state, start, end, startUncertainty, endUncertainty, clockwise)
            : centerArcGeometry(record, state, start, end, startUncertainty, endUncertainty, clockwise);
          if (geometry.error) {
            const issue = geometry.errorCode || "arc-geometry-unresolved";
            const blocked = blockedChord(record, state, start, end, startUncertainty, endUncertainty, sourceMotion, issue);
            if (!appendSegment(blocked)) stopForGeometryBudget(record);
            else stopAt(record, issue, geometry.error);
            break;
          }
          const geometryUncertaintyMm = Math.max(
            pointUncertainty(startUncertainty),
            pointUncertainty(endUncertainty),
            geometry.centerUncertaintyMm,
            geometry.radiusUncertaintyMm,
            boundedSum(
              Math.hypot(requiredUncertainty(startUncertainty.x), requiredUncertainty(startUncertainty.y)),
              Math.hypot(requiredUncertainty(endUncertainty.x), requiredUncertainty(endUncertainty.y)),
              geometry.centerUncertaintyMm * 2,
              numericUncertainty(geometry.sweep, 32) * geometry.radius,
            ),
            numericUncertainty(end.z - start.z, 16),
          );
          const topologyMarginMm = geometry.fullCircle
            ? Number.MAX_VALUE
            : geometry.radius * Math.min(Math.abs(geometry.sweep), TAU - Math.abs(geometry.sweep));
          const numericalResolutionBlocked = geometryUncertaintyMm > budget
            || !finite(topologyMarginMm)
            || topologyMarginMm <= geometryUncertaintyMm;
          if (numericalResolutionBlocked) {
            const blocked = blockedChord(record, state, start, end, startUncertainty, endUncertainty, sourceMotion, "mill-numerical-resolution");
            blocked.geometryUncertaintyMm = geometryUncertaintyMm;
            if (!appendSegment(blocked)) stopForGeometryBudget(record);
            else stopAt(record, "mill-numerical-resolution", `Arc construction cannot retain the ${budget} mm numerical budget.`);
            break;
          }
          if (segments.length >= resourceLimits.maxSegments) {
            stopForGeometryBudget(record);
            break;
          }
          const sampled = arcPoints(
            start,
            end,
            geometry.center,
            geometry.radius,
            geometry.sweep,
            chordTolerance,
            resourceLimits.maxPoints - geometryPointCount,
          );
          if (sampled.aggregateBlocked) {
            stopForGeometryBudget(record);
            break;
          }
          const verificationIssues = sampled.displayBlocked ? ["mill-arc-display-budget"] : [];
          const segment = {
            ...segmentBase(record, state, start, end, startUncertainty, endUncertainty),
            type: sourceMotion,
            sourceMotion,
            points: sampled.points,
            center: {...geometry.center},
            radius: geometry.radius,
            startAngle: sampled.startAngle,
            sweep: geometry.sweep,
            fullCircle: geometry.fullCircle,
            helical: Math.abs(end.z - start.z) > Math.max(requiredUncertainty(startUncertainty.z), requiredUncertainty(endUncertainty.z)),
            displayBlocked: sampled.displayBlocked,
            requiredDisplayPoints: sampled.requiredPoints,
            geometryUncertaintyMm,
            verificationBlocked: verificationIssues.length > 0,
            verificationIssues,
          };
          if (!appendSegment(segment)) {
            stopForGeometryBudget(record);
            break;
          }
          applyEndpoint(state, endpoint);
          if (sampled.displayBlocked) {
            stopAt(record, "mill-arc-display-budget", `Arc display needs ${sampled.requiredPoints.toLocaleString("en-US")} points to honor the selected chord-error limit; the bounded maximum is ${MILL_MAX_ARC_POINTS.toLocaleString("en-US")}. The exact analytic arc is retained, but only a blocked review chord can be shown.`);
            break;
          }
        } else {
          const startKnown = finitePoint(start);
          const endKnown = finitePoint(end);
          if (!startKnown || !endKnown) {
            if (state.motion === "rapid" && state.absolute) {
              const knownEndpointUncertainty = Math.hypot(...["x", "y", "z"].map((axis) => (
                finite(end[axis]) ? requiredUncertainty(endUncertainty[axis]) : 0
              )));
              if (!finite(knownEndpointUncertainty) || knownEndpointUncertainty > budget) {
                stopAt(record, "mill-numerical-resolution", `The absolute G00 baseline cannot retain the ${budget} mm numerical budget.`);
                break;
              }
              applyEndpoint(state, endpoint);
              baselineRapidLines.push(record.line);
              if (endKnown) {
                positionEvents.push({
                  type: "absolute-rapid-baseline",
                  line: record.line,
                  point: clonePoint(end),
                  coordinateUncertaintyMm: {...endUncertainty},
                  incomingPathKnown: false,
                });
              }
            } else if (state.motion === "rapid") {
              warnings.push(warningFor(record.line, "mill-position-baseline-required", "Incremental XYZ rapid motion cannot be placed until every starting coordinate is known; use a complete absolute G00 to resynchronize."));
            } else {
              warnings.push(warningFor(record.line, "mill-cut-start-position-unresolved", "Cutting motion cannot establish an unknown XYZ baseline; use a complete absolute G00 before cutting."));
            }
          } else {
            applyEndpoint(state, endpoint);
            const geometryUncertaintyMm = Math.max(pointUncertainty(startUncertainty), pointUncertainty(endUncertainty));
            const movingAxes = ["x", "y", "z"].filter((axis) => Math.abs(end[axis] - start[axis]) > Math.max(
              EPSILON,
              requiredUncertainty(startUncertainty[axis]),
              requiredUncertainty(endUncertainty[axis]),
            ));
            const unresolvedRapid = state.motion === "rapid" && movingAxes.length > 1;
            const segment = {
              ...segmentBase(record, state, start, end, startUncertainty, endUncertainty),
              type: state.motion,
              points: [clonePoint(start), clonePoint(end)],
              rapidInterpolation: state.motion === "rapid"
                ? (unresolvedRapid ? "endpoint-connector" : "single-axis")
                : null,
              rapidInterpolationUnresolved: unresolvedRapid,
              rapidAxes: state.motion === "rapid" ? movingAxes.map((axis) => axis.toUpperCase()) : [],
              geometryUncertaintyMm,
              verificationBlocked: geometryUncertaintyMm > budget,
              verificationIssues: geometryUncertaintyMm > budget ? ["mill-numerical-resolution"] : [],
            };
            if (!appendSegment(segment)) {
              stopForGeometryBudget(record);
              break;
            }
            if (unresolvedRapid) unresolvedRapidLines.push(record.line);
            if (segment.verificationBlocked) {
              stopAt(record, "mill-numerical-resolution", `Linear coordinate arithmetic cannot retain the ${budget} mm numerical budget.`);
              break;
            }
          }
        }
      }
    }

    if (mCode === 2 || mCode === 30) {
      if (state.spindleRunning !== false) {
        state.spindleRunning = false;
        spindleEvents.push({
          line: record.line,
          direction: state.spindleDirection,
          running: false,
          command: `M${mCode}`,
          reason: "program-end",
        });
      }
      state.programEnded = true;
      programEndLine = record.line;
    }
    currentTransaction = null;
  }

  if (semanticExecutionStopLine !== null) {
    for (const call of toolCalls) {
      if (call.line >= semanticExecutionStopLine && !call.executable) {
        call.executionContext = "after-blocked-execution";
      }
    }
  }
  if (programEndLine !== null) {
    for (const call of toolCalls) {
      if (call.line > programEndLine && !call.executable) call.executionContext = "after-program-end";
    }
  }

  if (warnOnAssumedUnits && state.assumedUnitsUsed) {
    warnings.unshift(warningFor(null, "mill-units-assumed", `No G20/G21 preceded motion; the configured Fanuc-style mill profile supplied ${configuredUnits === "in" ? "inch" : "millimeter"} units.`, false));
  }
  if (unresolvedRapidLines.length) {
    warnings.unshift(warningFor(
      unresolvedRapidLines[0],
      "mill-rapid-interpolation-unresolved",
      `${unresolvedRapidLines.length} multi-axis G00 move${unresolvedRapidLines.length === 1 ? " is" : "s are"} displayed as dashed endpoint connector${unresolvedRapidLines.length === 1 ? "" : "s"}; coordinated-versus-dogleg interpolation, intermediate position, distance, and timing are unresolved.`,
      false,
    ));
  }
  if (toolChangePositionLines.length) {
    warnings.unshift(warningFor(
      toolChangePositionLines[0],
      "mill-tool-change-position-unresolved",
      `${toolChangePositionLines.length} M06 tool change${toolChangePositionLines.length === 1 ? " invalidated" : "s invalidated"} XYZ because machine-builder positioning is unconfigured; a complete absolute G00 is required to resynchronize before more path geometry.`,
      false,
    ));
  }
  if (baselineRapidLines.length) {
    warnings.unshift(warningFor(
      baselineRapidLines[0],
      "mill-rapid-baseline-established",
      `${baselineRapidLines.length} absolute G00 block${baselineRapidLines.length === 1 ? " established" : "s established"} the previously unknown XYZ position without inventing an incoming rapid path.`,
      false,
    ));
  }

  return {
    segments,
    warnings,
    cycles: [],
    sourceLines,
    toolCalls,
    executableToolCalls: toolCalls.filter((call) => call.executable),
    toolChangeEvents,
    positionEvents,
    spindleEvents,
    coolantEvents,
    timingEvents,
    liveToolEvents: [],
    liveToolAttempts: [],
    cAxisEvents: [],
    cAxisMotions: [],
    dwellSeconds: timingEvents.reduce((sum, event) => sum + Math.max(0, Number(event.seconds) || 0), 0),
    units: state.units,
    unitsSource: state.assumedUnitsUsed || !state.sawUnits ? "configured-default" : "program",
    machineState: {
      dialect: supportedDialect ? "fanuc-mill" : "unconfigured",
      executionBlocked: state.executionBlocked,
      semanticExecutionStopLine,
      programEnded: state.programEnded,
      position: currentPoint(state),
      motion: state.motion,
      plane: state.plane,
      distanceMode: state.absolute === null ? "unknown" : (state.absolute ? "absolute" : "incremental"),
      arcCenterMode: state.arcCenterAbsolute === null ? "unknown" : (state.arcCenterAbsolute ? "absolute" : "incremental"),
      feedMode: state.feedMode || "unknown",
      workFrame: state.workFrame,
      workFrameSource: state.workFrameSource,
      toolLengthCompensation: {...state.toolLengthCompensation},
      cutterCompensationCleared: state.cutterCompensationCleared,
      cannedCycleCancelled: state.cannedCycleCancelled,
      toolLengthStateKnown: state.toolLengthStateKnown,
      activeToolKey: state.activeToolKey,
      spindleSpeed: state.spindleSpeed,
      spindleRunning: state.spindleRunning,
      spindleDirection: state.spindleDirection,
      coolant: state.coolant,
      numericalBudgetMm: budget,
      geometryPointCount,
      resourceLimits: {...resourceLimits},
    },
  };
}
