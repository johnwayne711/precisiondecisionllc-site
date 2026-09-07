const TAU = Math.PI * 2;
const MAX_NUMERICAL_ERROR_MM = 0.00127;
const ARC_ANGLE_ROUNDING_ULPS = 8;
const DERIVED_GEOMETRY_ROUNDING_ULPS = 8;
const BULGE_DERIVATION_ROUNDING_ULPS = 4096;
const TRANSFORM_ROUNDING_ULPS = 256;
const MATERIAL_ROUNDING_ULPS = 512;
const MATERIAL_TRIG_ROUNDING_ULPS = 128;
export const DXF_MATERIAL_REGION_QUALIFICATION = "dxf-explicit-closed-contour-inside-v1";
export const MAX_DXF_MATERIAL_CONTOURS = 256;
export const MAX_DXF_MATERIAL_TOPOLOGY_TESTS = 250000;
const NUMBER_PATTERN = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eEdD][+-]?\d+)?$/;
const UNIT_DIAGNOSTIC_CODES = new Set([
  "units-invalid",
  "units-missing",
  "units-unitless",
  "units-unsupported",
]);

const INSUNITS = new Map([
  [0, {code: 0, name: "unitless", symbol: null, millimetersPerUnit: null}],
  [1, {code: 1, name: "inch", symbol: "in", millimetersPerUnit: 25.4}],
  [2, {code: 2, name: "foot", symbol: "ft", millimetersPerUnit: 304.8}],
  [3, {code: 3, name: "mile", symbol: "mi", millimetersPerUnit: 1609344}],
  [4, {code: 4, name: "millimeter", symbol: "mm", millimetersPerUnit: 1}],
  [5, {code: 5, name: "centimeter", symbol: "cm", millimetersPerUnit: 10}],
  [6, {code: 6, name: "meter", symbol: "m", millimetersPerUnit: 1000}],
  [7, {code: 7, name: "kilometer", symbol: "km", millimetersPerUnit: 1e6}],
  [8, {code: 8, name: "microinch", symbol: "uin", millimetersPerUnit: 0.0000254}],
  [9, {code: 9, name: "mil", symbol: "mil", millimetersPerUnit: 0.0254}],
  [10, {code: 10, name: "yard", symbol: "yd", millimetersPerUnit: 914.4}],
  [11, {code: 11, name: "angstrom", symbol: "A", millimetersPerUnit: 1e-7}],
  [12, {code: 12, name: "nanometer", symbol: "nm", millimetersPerUnit: 1e-6}],
  [13, {code: 13, name: "micron", symbol: "um", millimetersPerUnit: 0.001}],
  [14, {code: 14, name: "decimeter", symbol: "dm", millimetersPerUnit: 100}],
  [15, {code: 15, name: "decameter", symbol: "dam", millimetersPerUnit: 10000}],
  [16, {code: 16, name: "hectometer", symbol: "hm", millimetersPerUnit: 100000}],
  [17, {code: 17, name: "gigameter", symbol: "Gm", millimetersPerUnit: 1e12}],
  [18, {code: 18, name: "astronomical-unit", symbol: "au", millimetersPerUnit: 149597870700000}],
  [19, {code: 19, name: "light-year", symbol: "ly", millimetersPerUnit: 9.4607304725808e18}],
  [20, {code: 20, name: "parsec", symbol: "pc", millimetersPerUnit: Number("3.0856775814913673e19")}],
  [21, {code: 21, name: "us-survey-foot", symbol: "ftUS", millimetersPerUnit: 1200000 / 3937}],
  [22, {code: 22, name: "us-survey-inch", symbol: "inUS", millimetersPerUnit: 100000 / 3937}],
  [23, {code: 23, name: "us-survey-yard", symbol: "ydUS", millimetersPerUnit: 3600000 / 3937}],
  [24, {code: 24, name: "us-survey-mile", symbol: "miUS", millimetersPerUnit: 6336000000 / 3937}],
]);

const UNIT_ALIASES = new Map([
  ["in", 1], ["inch", 1], ["inches", 1],
  ["ft", 2], ["foot", 2], ["feet", 2],
  ["mi", 3], ["mile", 3], ["miles", 3],
  ["mm", 4], ["millimeter", 4], ["millimeters", 4], ["millimetre", 4], ["millimetres", 4],
  ["cm", 5], ["centimeter", 5], ["centimeters", 5], ["centimetre", 5], ["centimetres", 5],
  ["m", 6], ["meter", 6], ["meters", 6], ["metre", 6], ["metres", 6],
  ["km", 7], ["kilometer", 7], ["kilometers", 7], ["kilometre", 7], ["kilometres", 7],
  ["microinch", 8], ["microinches", 8], ["uin", 8],
  ["mil", 9], ["mils", 9],
  ["yard", 10], ["yards", 10], ["yd", 10],
  ["angstrom", 11], ["angstroms", 11],
  ["nanometer", 12], ["nanometers", 12], ["nm", 12],
  ["micron", 13], ["microns", 13], ["micrometer", 13], ["micrometers", 13], ["um", 13],
]);

for (const definition of INSUNITS.values()) {
  UNIT_ALIASES.set(definition.name.toLowerCase(), definition.code);
  if (definition.symbol) UNIT_ALIASES.set(definition.symbol.toLowerCase(), definition.code);
}

const NON_2D_ENTITY_TYPES = new Set([
  "3DFACE", "3DSOLID", "BODY", "HELIX", "MESH", "REGION", "SURFACE",
]);

export const DXF_IMPORT_LIMITS = Object.freeze({
  maxGroupPairs: 250000,
  maxEntityRecords: 50000,
  maxVerticesPerPolyline: 50000,
  maxTotalVertices: 100000,
  maxPrimitives: 100000,
  maxDiagnostics: 1000,
});

function boundedLimits(overrides = {}) {
  return Object.fromEntries(Object.entries(DXF_IMPORT_LIMITS).map(([name, ceiling]) => {
    const requested = Number(overrides?.[name]);
    return [name, Number.isInteger(requested) && requested > 0 ? Math.min(requested, ceiling) : ceiling];
  }));
}

function normalizedUpper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function sourceLineCount(text) {
  let count = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") count += 1;
    else if (text[index] === "\r") {
      count += 1;
      if (text[index + 1] === "\n") index += 1;
    }
  }
  return count;
}

function parseNumericLexeme(raw) {
  const value = String(raw ?? "").trim();
  if (!NUMBER_PATTERN.test(value)) return null;
  const parsed = Number(value.replace(/[dD]/, "E"));
  const mantissa = value.split(/[eEdD]/, 1)[0];
  if (parsed === 0 && /[1-9]/.test(mantissa)) return null;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedDecimalDegrees(raw) {
  const value = String(raw ?? "").trim();
  if (!NUMBER_PATTERN.test(value) || value.length > 256) return null;
  const match = value.match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eEdD]([+-]?\d+))?$/);
  if (!match) return null;
  const fraction = match[3] ?? match[4] ?? "";
  let digits = `${match[2] ?? ""}${fraction}`.replace(/^0+/, "") || "0";
  const exponent = Number(match[5] ?? "0");
  if (!Number.isSafeInteger(exponent)) return null;
  let scaleExponent = exponent - fraction.length;
  while (digits.length > 1 && digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    scaleExponent += 1;
  }
  // ARC topology only needs the exact decimal remainder modulo 360. Bound
  // adversarial lexemes before constructing BigInts; ordinary DXF angle
  // fields are many orders of magnitude smaller than these limits.
  if (digits.length > 128 || Math.abs(scaleExponent) > 400) return null;
  let coefficient = BigInt(digits);
  if (match[1] === "-") coefficient = -coefficient;
  if (coefficient === 0n) return {numerator: 0n, denominator: 1n};
  if (scaleExponent >= 0) {
    const modulus = 360n;
    const factor = 10n ** BigInt(scaleExponent);
    const numerator = ((coefficient * factor) % modulus + modulus) % modulus;
    return {numerator, denominator: 1n};
  }
  const denominator = 10n ** BigInt(-scaleExponent);
  const modulus = 360n * denominator;
  const numerator = (coefficient % modulus + modulus) % modulus;
  return {numerator, denominator};
}

function decimalArcSweepTopology(startRaw, endRaw) {
  const start = normalizedDecimalDegrees(startRaw);
  const end = normalizedDecimalDegrees(endRaw);
  if (!start || !end) return null;
  const comparison = end.numerator * start.denominator - start.numerator * end.denominator;
  if (comparison === 0n) return "zero";
  return comparison > 0n ? "nonwrap" : "wrap";
}

function binaryArcSweepTopology(startDegrees, endDegrees) {
  if (startDegrees === endDegrees) return "zero";
  return endDegrees > startDegrees ? "nonwrap" : "wrap";
}

function makeDiagnostic(severity, code, message, details = {}) {
  return {
    severity,
    code,
    message,
    line: details.line ?? null,
    entityType: details.entityType ?? null,
    entityId: details.entityId ?? null,
  };
}

function diagnosticState(maxDiagnostics) {
  const diagnostics = [];
  let errors = 0;
  let warnings = 0;
  let suppressed = 0;
  let limitReported = false;
  return {
    diagnostics,
    get errors() { return errors; },
    get warnings() { return warnings; },
    get suppressed() { return suppressed; },
    add(severity, code, message, details = {}) {
      if (severity === "error") errors += 1;
      if (severity === "warning") warnings += 1;
      if (diagnostics.length < maxDiagnostics - 1) {
        diagnostics.push(makeDiagnostic(severity, code, message, details));
        return;
      }
      suppressed += 1;
      if (!limitReported) {
        diagnostics.push(makeDiagnostic("error", "diagnostic-limit-exceeded", `DXF produced more than ${maxDiagnostics} diagnostics; remaining findings were suppressed.`));
        errors += 1;
        limitReported = true;
      }
    },
  };
}

function tokenizeAsciiDxf(text, state, maxGroupPairs) {
  const parseText = text.startsWith("\uFEFF") ? text.slice(1) : text;
  if (parseText.startsWith("AutoCAD Binary DXF") || parseText.includes("\0")) {
    state.add("error", "binary-dxf-unsupported", "Binary DXF is not supported; export an ASCII DXF file.", {line: 1});
    return [];
  }

  let logicalEnd = parseText.length;
  while (logicalEnd > 0 && /[\s]/.test(parseText[logicalEnd - 1])) logicalEnd -= 1;
  let cursor = 0;
  let lineNumber = 1;
  const readLine = () => {
    if (cursor >= logicalEnd) return null;
    const start = cursor;
    while (cursor < logicalEnd && parseText[cursor] !== "\r" && parseText[cursor] !== "\n") cursor += 1;
    const value = parseText.slice(start, cursor);
    if (cursor < logicalEnd) {
      if (parseText[cursor] === "\r" && parseText[cursor + 1] === "\n") cursor += 2;
      else cursor += 1;
    }
    const result = {value, line: lineNumber};
    lineNumber += 1;
    return result;
  };

  const pairs = [];
  while (cursor < logicalEnd) {
    if (pairs.length >= maxGroupPairs) {
      state.add("error", "group-pair-limit-exceeded", `DXF exceeds the ${maxGroupPairs}-group-pair complexity limit.`, {line: lineNumber});
      break;
    }
    const codeLine = readLine();
    const valueLine = readLine();
    if (!valueLine) {
      state.add("error", "incomplete-group-pair", "The final DXF group code has no value line.", {line: codeLine.line});
      break;
    }
    const rawCode = codeLine.value.trim();
    const candidateCode = /^[+-]?\d+$/.test(rawCode) ? Number(rawCode) : null;
    const parsedCode = Number.isInteger(candidateCode) && candidateCode >= 0 && candidateCode <= 1071
      ? candidateCode
      : null;
    if (parsedCode === null) {
      state.add("error", "invalid-group-code", `DXF group code '${rawCode}' is not an integer in the supported 0-1071 file range.`, {line: codeLine.line});
    }
    pairs.push({
      code: parsedCode,
      value: valueLine.value.trim(),
      rawValue: valueLine.value,
      line: codeLine.line,
      valueLine: valueLine.line,
    });
  }
  return pairs;
}

function partitionSections(pairs, state) {
  const sections = new Map();
  const sectionCounts = new Map();
  let currentSection = null;
  let sawEof = false;

  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    const marker = pair.code === 0 ? normalizedUpper(pair.value) : null;
    if (sawEof) {
      state.add("error", "data-after-eof", "DXF contains data after its EOF marker.", {line: pair.line});
      break;
    }
    if (marker === "SECTION") {
      if (currentSection !== null) {
        state.add("error", "nested-section", "A DXF SECTION began before the previous section ended.", {line: pair.line});
      }
      const namePair = pairs[index + 1];
      if (!namePair || namePair.code !== 2) {
        state.add("error", "missing-section-name", "DXF SECTION is missing its group 2 name.", {line: pair.line});
        currentSection = null;
        continue;
      }
      currentSection = normalizedUpper(namePair.value);
      const count = (sectionCounts.get(currentSection) ?? 0) + 1;
      sectionCounts.set(currentSection, count);
      if (count > 1) {
        state.add("error", "duplicate-section", `DXF contains more than one ${currentSection} section.`, {line: pair.line});
      }
      if (!sections.has(currentSection)) sections.set(currentSection, []);
      index += 1;
      continue;
    }
    if (marker === "ENDSEC") {
      if (currentSection === null) {
        state.add("error", "unexpected-endsec", "DXF ENDSEC appears outside a section.", {line: pair.line});
      }
      currentSection = null;
      continue;
    }
    if (marker === "EOF") {
      sawEof = true;
      if (currentSection !== null) {
        state.add("error", "eof-inside-section", "DXF EOF appears before ENDSEC.", {line: pair.line});
        currentSection = null;
      }
      continue;
    }
    if (currentSection !== null) sections.get(currentSection).push(pair);
    else if (pair.code !== 999) {
      state.add("error", "data-outside-section", "DXF contains an entity or data pair outside a SECTION.", {line: pair.line});
    }
  }

  if (currentSection !== null) {
    state.add("error", "unterminated-section", `DXF section ${currentSection} has no ENDSEC marker.`);
  }
  if (!sawEof) state.add("error", "missing-eof", "DXF file has no EOF marker.");
  return sections;
}

function recordContext(record, entityId) {
  return {line: record.line, entityType: record.type, entityId};
}

function groupsWithCode(groups, code) {
  return groups.filter((group) => group.code === code);
}

function readNumber(groups, code, label, state, context, {required = false, defaultValue = null} = {}) {
  const matches = groupsWithCode(groups, code);
  if (!matches.length) {
    if (required) state.add("error", "missing-entity-value", `${context.entityType} is missing ${label} (group ${code}).`, context);
    return defaultValue;
  }
  if (matches.length > 1) {
    state.add("error", "duplicate-entity-value", `${context.entityType} repeats ${label} (group ${code}).`, {...context, line: matches[1].line});
    return defaultValue;
  }
  const value = parseNumericLexeme(matches[0].value);
  if (value === null) {
    state.add("error", "invalid-number", `${context.entityType} has an invalid ${label} value '${matches[0].value}'.`, {...context, line: matches[0].valueLine});
    return defaultValue;
  }
  return value;
}

function readInteger(groups, code, label, state, context, options = {}) {
  const value = readNumber(groups, code, label, state, context, options);
  if (value !== null && !Number.isInteger(value)) {
    const match = groupsWithCode(groups, code)[0];
    state.add("error", "invalid-integer", `${context.entityType} ${label} must be an integer.`, {...context, line: match?.valueLine ?? context.line});
    return options.defaultValue ?? null;
  }
  return value;
}

function optionalString(groups, code) {
  const match = groupsWithCode(groups, code)[0];
  return match ? match.value : null;
}

function validatePlanarEntity(groups, state, context, {zCodes = []} = {}) {
  for (const code of zCodes) {
    const value = readNumber(groups, code, `Z coordinate`, state, context, {defaultValue: 0});
    if (value !== 0) {
      state.add("error", "non-2d-entity", `${context.entityType} has a nonzero Z coordinate and cannot be used as 2D geometry.`, context);
    }
  }

  const thickness = readNumber(groups, 39, "thickness", state, context, {defaultValue: 0});
  if (thickness !== 0) {
    state.add("error", "non-2d-entity", `${context.entityType} has nonzero thickness and cannot be used as 2D geometry.`, context);
  }

  const hasExtrusion = [210, 220, 230].some((code) => groupsWithCode(groups, code).length > 0);
  if (hasExtrusion) {
    const nx = readNumber(groups, 210, "extrusion X", state, context, {defaultValue: 0});
    const ny = readNumber(groups, 220, "extrusion Y", state, context, {defaultValue: 0});
    const nz = readNumber(groups, 230, "extrusion Z", state, context, {defaultValue: 1});
    if (nx !== 0 || ny !== 0 || nz !== 1) {
      state.add("error", "non-2d-entity", `${context.entityType} uses a non-default extrusion plane.`, context);
    }
  }
}

function uniqueEntityString(groups, code, label, state, context) {
  const matches = groupsWithCode(groups, code);
  if (matches.length > 1) {
    state.add("error", "duplicate-entity-value", `${context.entityType} repeats ${label} (group ${code}).`, {...context, line: matches[1].line});
  }
  return matches[0]?.value ?? null;
}

function validateEntityContext(groups, state, context) {
  const layer = uniqueEntityString(groups, 8, "layer", state, context);
  const layout = uniqueEntityString(groups, 410, "layout", state, context);
  if (layer !== null && layer === "") {
    state.add("error", "blank-entity-layer", `${context.entityType} has a blank group 8 layer name.`, context);
  }
  if (layout !== null && layout === "") {
    state.add("error", "blank-entity-layout", `${context.entityType} has a blank group 410 layout name.`, context);
  }
  const paperSpace = readInteger(groups, 67, "paper-space flag", state, context, {defaultValue: 0});
  if (paperSpace !== 0 && paperSpace !== 1) {
    state.add("error", "invalid-entity-space", `${context.entityType} has an invalid group 67 space flag.`, context);
  } else if (paperSpace === 1) {
    state.add("error", "paper-space-entity", `${context.entityType} is paper-space geometry and cannot define the part profile.`, context);
  }
  if (layout && normalizedUpper(layout) !== "MODEL") {
    state.add("error", "paper-space-entity", `${context.entityType} belongs to paper-space layout '${layout}'.`, context);
  }
  const visibility = readInteger(groups, 60, "visibility", state, context, {defaultValue: 0});
  if (visibility !== 0 && visibility !== 1) {
    state.add("error", "invalid-entity-visibility", `${context.entityType} has an invalid group 60 visibility value.`, context);
  } else if (visibility === 1) {
    state.add("error", "invisible-entity", `${context.entityType} is marked invisible and cannot silently enter dimensional profile geometry.`, context);
  }
}

function validatePolylineFlags(flags, state, context, entityType) {
  if (!Number.isInteger(flags) || flags < 0 || flags > 255) {
    state.add("error", "invalid-polyline-flags", `${entityType} flags must fit the defined nonnegative 8-bit flag field.`, context);
    return 0;
  }
  return flags;
}

function sourceMetadata(record, entityId, extra = {}) {
  return {
    entityId,
    dxfType: record.type,
    line: record.line,
    handle: optionalString(record.groups, 5),
    ...extra,
  };
}

function entityLayer(record) {
  return optionalString(record.groups, 8);
}

function point(x, y) {
  return {x, y};
}

function arcPoint(center, radius, angle) {
  return point(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius);
}

function parseLineEntity(record, entityId, state) {
  const context = recordContext(record, entityId);
  const errorStart = state.errors;
  const start = point(
    readNumber(record.groups, 10, "start X", state, context, {required: true}),
    readNumber(record.groups, 20, "start Y", state, context, {required: true}),
  );
  const end = point(
    readNumber(record.groups, 11, "end X", state, context, {required: true}),
    readNumber(record.groups, 21, "end Y", state, context, {required: true}),
  );
  validatePlanarEntity(record.groups, state, context, {zCodes: [30, 31]});
  validateEntityContext(record.groups, state, context);
  if (state.errors === errorStart && start.x === end.x && start.y === end.y) {
    state.add("error", "degenerate-line", "LINE start and end points are identical.", context);
  }
  if (state.errors > errorStart) return null;
  const entity = {
    id: entityId,
    type: "line",
    layer: entityLayer(record),
    start,
    end,
    source: sourceMetadata(record, entityId),
  };
  return {entity, primitives: [entity]};
}

function parseArcEntity(record, entityId, state) {
  const context = recordContext(record, entityId);
  const errorStart = state.errors;
  const center = point(
    readNumber(record.groups, 10, "center X", state, context, {required: true}),
    readNumber(record.groups, 20, "center Y", state, context, {required: true}),
  );
  const radius = readNumber(record.groups, 40, "radius", state, context, {required: true});
  const startAngleDegrees = readNumber(record.groups, 50, "start angle", state, context, {required: true});
  const endAngleDegrees = readNumber(record.groups, 51, "end angle", state, context, {required: true});
  const startAngleLexeme = groupsWithCode(record.groups, 50)[0]?.value ?? null;
  const endAngleLexeme = groupsWithCode(record.groups, 51)[0]?.value ?? null;
  validatePlanarEntity(record.groups, state, context, {zCodes: [30]});
  validateEntityContext(record.groups, state, context);
  if (state.errors === errorStart && radius <= 0) {
    state.add("error", "invalid-radius", "ARC radius must be greater than zero.", context);
  }
  const normalizedStartDegrees = ((startAngleDegrees % 360) + 360) % 360;
  const normalizedEndDegrees = ((endAngleDegrees % 360) + 360) % 360;
  const exactSweepTopology = decimalArcSweepTopology(startAngleLexeme, endAngleLexeme);
  const binarySweepTopology = binaryArcSweepTopology(normalizedStartDegrees, normalizedEndDegrees);
  if (state.errors === errorStart && (
    exactSweepTopology === null || exactSweepTopology !== binarySweepTopology
  )) {
    state.add(
      "error",
      "arc-angle-topology-resolution",
      "ARC group-50/51 decimal angles lose their directed sweep topology during numeric range reduction.",
      context,
    );
  }
  const sweepDegrees = ((normalizedEndDegrees - normalizedStartDegrees) + 360) % 360;
  if (state.errors === errorStart && sweepDegrees === 0) {
    state.add("error", "degenerate-arc", "ARC start and end angles describe no bounded arc; use CIRCLE for a full circle.", context);
  }
  if (state.errors > errorStart) return null;
  const startAngle = normalizedStartDegrees * Math.PI / 180;
  const sweep = sweepDegrees * Math.PI / 180;
  const entity = {
    id: entityId,
    type: "arc",
    layer: entityLayer(record),
    center,
    radius,
    startAngle,
    sweep,
    start: arcPoint(center, radius, startAngle),
    end: arcPoint(center, radius, startAngle + sweep),
    source: sourceMetadata(record, entityId, {
      startAngleDegrees,
      endAngleDegrees,
      startAngleLexeme,
      endAngleLexeme,
      sweepTopology: exactSweepTopology,
    }),
  };
  return {entity, primitives: [entity]};
}

function parseCircleEntity(record, entityId, state) {
  const context = recordContext(record, entityId);
  const errorStart = state.errors;
  const center = point(
    readNumber(record.groups, 10, "center X", state, context, {required: true}),
    readNumber(record.groups, 20, "center Y", state, context, {required: true}),
  );
  const radius = readNumber(record.groups, 40, "radius", state, context, {required: true});
  validatePlanarEntity(record.groups, state, context, {zCodes: [30]});
  validateEntityContext(record.groups, state, context);
  if (state.errors === errorStart && radius <= 0) {
    state.add("error", "invalid-radius", "CIRCLE radius must be greater than zero.", context);
  }
  if (state.errors > errorStart) return null;
  const entity = {
    id: entityId,
    type: "circle",
    layer: entityLayer(record),
    center,
    radius,
    source: sourceMetadata(record, entityId),
  };
  return {entity, primitives: [entity]};
}

function parseNumberPair(pair, label, state, context) {
  const value = parseNumericLexeme(pair.value);
  if (value === null) {
    state.add("error", "invalid-number", `${context.entityType} has an invalid ${label} value '${pair.value}'.`, {...context, line: pair.valueLine});
    return null;
  }
  return value;
}

function flagUnsupportedPolylineWidth(groups, state, context, codes = [40, 41, 43]) {
  for (const code of codes) {
    for (const group of groupsWithCode(groups, code)) {
      const width = parseNumberPair(group, "polyline width", state, context);
      if (width !== null && width !== 0) {
        state.add("error", "unsupported-polyline-width", "Wide polylines are not supported as dimensional profile geometry.", {...context, line: group.line});
      }
    }
  }
}

function bulgeArcParameters(start, end, bulge) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  const centerOffset = chord * (1 - bulge * bulge) / (4 * bulge);
  const center = point(
    start.x + dx / 2 - dy / chord * centerOffset,
    start.y + dy / 2 + dx / chord * centerOffset,
  );
  const radius = chord * (1 + bulge * bulge) / (4 * Math.abs(bulge));
  return {
    center,
    radius,
    startAngle: Math.atan2(start.y - center.y, start.x - center.x),
    sweep: 4 * Math.atan(bulge),
  };
}

function polylinePrimitive(entityId, layer, start, end, bulge, index, source) {
  const primitiveSource = {...source, entityId, polylineSegment: index, bulge};
  if (bulge === 0) {
    return {
      id: `${entityId}:segment-${index + 1}`,
      type: "line",
      layer,
      start: point(start.x, start.y),
      end: point(end.x, end.y),
      source: primitiveSource,
    };
  }

  const {center, radius, startAngle, sweep} = bulgeArcParameters(start, end, bulge);
  const primitive = {
    id: `${entityId}:segment-${index + 1}`,
    type: "arc",
    layer,
    center,
    radius,
    startAngle,
    sweep,
    start: point(start.x, start.y),
    end: point(end.x, end.y),
    source: primitiveSource,
  };
  return {
    ...primitive,
    geometryUncertaintyNative: bulgeDerivationUncertainty(primitive, "x", "y"),
  };
}

function buildPolyline(record, entityId, vertices, closed, state) {
  const context = recordContext(record, entityId);
  const errorStart = state.errors;
  if (vertices.length < 2) {
    state.add("error", "insufficient-polyline-vertices", `${record.type} needs at least two vertices.`, context);
  }
  const segmentCount = closed ? vertices.length : Math.max(0, vertices.length - 1);
  const primitives = [];
  const source = sourceMetadata(record, entityId);
  for (let index = 0; index < segmentCount; index += 1) {
    const vertex = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    if (vertex.x === next.x && vertex.y === next.y) {
      state.add("error", "degenerate-polyline-segment", `${record.type} segment ${index + 1} has identical endpoints.`, context);
      continue;
    }
    const segmentSource = record.type === "POLYLINE"
      ? {
        ...source,
        classicPolylineHeaderLayer: entityLayer(record),
        classicPolylineVertexLayers: [vertex.layer ?? null, next.layer ?? null],
        classicPolylineVertexLines: [vertex.sourceLine ?? null, next.sourceLine ?? null],
      }
      : source;
    const primitive = polylinePrimitive(
      entityId,
      entityLayer(record),
      vertex,
      next,
      vertex.bulge,
      index,
      segmentSource,
    );
    if (!Number.isFinite(primitive.radius ?? 1)
      || (primitive.center && (!Number.isFinite(primitive.center.x) || !Number.isFinite(primitive.center.y)))) {
      state.add("error", "invalid-bulge-arc", `${record.type} segment ${index + 1} cannot form a finite bulge arc.`, context);
      continue;
    }
    primitives.push(primitive);
  }
  if (state.errors > errorStart) return null;
  return {
    entity: {
      id: entityId,
      type: "polyline",
      dxfType: record.type,
      layer: entityLayer(record),
      closed,
      vertices: vertices.map(({x, y, bulge, layer, sourceLine}) => ({
        x,
        y,
        bulge,
        ...(record.type === "POLYLINE" ? {layer: layer ?? null, sourceLine: sourceLine ?? null} : {}),
      })),
      primitiveIds: primitives.map((primitive) => primitive.id),
      source,
    },
    primitives,
  };
}

function reservePolylineVertices(count, budget, state, context) {
  const previousTotal = budget.totalVertices;
  budget.totalVertices += count;
  if (count > budget.limits.maxVerticesPerPolyline) {
    state.add("error", "polyline-vertex-limit-exceeded", `${context.entityType} exceeds the ${budget.limits.maxVerticesPerPolyline}-vertex per-polyline limit.`, context);
    return false;
  }
  if (previousTotal + count > budget.limits.maxTotalVertices) {
    state.add("error", "total-vertex-limit-exceeded", `DXF exceeds the ${budget.limits.maxTotalVertices}-vertex total complexity limit.`, context);
    return false;
  }
  return true;
}

function parseLwPolyline(record, entityId, state, budget) {
  const context = recordContext(record, entityId);
  const errorStart = state.errors;
  const sourceVertexCount = record.groups.reduce((count, group) => count + (group.code === 10 ? 1 : 0), 0);
  if (!reservePolylineVertices(sourceVertexCount, budget, state, context)) return null;
  const declaredCount = readInteger(record.groups, 90, "vertex count", state, context, {required: true});
  const flags = validatePolylineFlags(
    readInteger(record.groups, 70, "flags", state, context, {defaultValue: 0}), state, context, "LWPOLYLINE",
  );
  const unsupportedFlags = flags & ~(1 | 128);
  if (unsupportedFlags) {
    const code = unsupportedFlags & (8 | 16 | 32 | 64) ? "non-2d-entity" : "unsupported-polyline-flags";
    state.add("error", code, `LWPOLYLINE flags ${flags} are not supported as a simple 2D profile.`, context);
  }
  const elevation = readNumber(record.groups, 38, "elevation", state, context, {defaultValue: 0});
  if (elevation !== 0) state.add("error", "non-2d-entity", "LWPOLYLINE has a nonzero elevation.", context);
  validatePlanarEntity(record.groups, state, context, {zCodes: [30]});
  validateEntityContext(record.groups, state, context);
  flagUnsupportedPolylineWidth(record.groups, state, context);

  const vertices = [];
  let current = null;
  const used = new Set();
  const finishVertex = () => {
    if (!current) return;
    if (!used.has(20)) state.add("error", "missing-polyline-coordinate", "LWPOLYLINE vertex is missing its Y coordinate (group 20).", context);
    vertices.push(current);
  };
  for (const group of record.groups) {
    if (group.code === 10) {
      finishVertex();
      current = {x: parseNumberPair(group, "vertex X", state, context), y: null, bulge: 0};
      used.clear();
      used.add(10);
      continue;
    }
    if (![20, 30, 40, 41, 42].includes(group.code)) continue;
    if (!current) {
      if ([20, 42].includes(group.code)) {
        state.add("error", "orphan-polyline-value", `LWPOLYLINE group ${group.code} appears before its vertex X coordinate.`, {...context, line: group.line});
      }
      continue;
    }
    if (used.has(group.code)) {
      state.add("error", "duplicate-polyline-value", `LWPOLYLINE repeats group ${group.code} within one vertex.`, {...context, line: group.line});
      continue;
    }
    used.add(group.code);
    const value = parseNumberPair(group, `vertex group ${group.code}`, state, context);
    if (group.code === 20) current.y = value;
    if (group.code === 30 && value !== 0) state.add("error", "non-2d-entity", "LWPOLYLINE vertex has a nonzero Z coordinate.", context);
    if (group.code === 42) current.bulge = value;
  }
  finishVertex();

  if (declaredCount !== null && declaredCount !== vertices.length) {
    state.add("error", "polyline-count-mismatch", `LWPOLYLINE declares ${declaredCount} vertices but contains ${vertices.length}.`, context);
  }
  if (state.errors > errorStart) return null;
  return buildPolyline(record, entityId, vertices, Boolean(flags & 1), state);
}

function parseClassicPolyline(record, vertexRecords, hasSeqend, entityId, state, budget) {
  const context = recordContext(record, entityId);
  const errorStart = state.errors;
  if (!reservePolylineVertices(vertexRecords.length, budget, state, context)) return null;
  if (!hasSeqend) state.add("error", "missing-seqend", "POLYLINE has no terminating SEQEND record.", context);
  const flags = validatePolylineFlags(
    readInteger(record.groups, 70, "flags", state, context, {defaultValue: 0}), state, context, "POLYLINE",
  );
  const unsupportedFlags = flags & ~(1 | 128);
  if (unsupportedFlags) {
    const code = unsupportedFlags & (8 | 16 | 32 | 64) ? "non-2d-entity" : "unsupported-polyline-flags";
    state.add("error", code, `POLYLINE flags ${flags} are not supported as a simple 2D profile.`, context);
  }
  validatePlanarEntity(record.groups, state, context, {zCodes: [30]});
  validateEntityContext(record.groups, state, context);
  flagUnsupportedPolylineWidth(record.groups, state, context, [40, 41]);

  const vertices = [];
  for (const vertexRecord of vertexRecords) {
    const vertexContext = recordContext(vertexRecord, entityId);
    validateEntityContext(vertexRecord.groups, state, vertexContext);
    const vertexFlags = validatePolylineFlags(
      readInteger(vertexRecord.groups, 70, "vertex flags", state, vertexContext, {defaultValue: 0}),
      state, vertexContext, "VERTEX",
    );
    if (vertexFlags !== 0) {
      const code = vertexFlags & (16 | 32 | 64 | 128) ? "non-2d-entity" : "unsupported-polyline-flags";
      state.add("error", code, `VERTEX flags ${vertexFlags} are not supported as a simple 2D profile.`, vertexContext);
    }
    const x = readNumber(vertexRecord.groups, 10, "vertex X", state, vertexContext, {required: true});
    const y = readNumber(vertexRecord.groups, 20, "vertex Y", state, vertexContext, {required: true});
    const z = readNumber(vertexRecord.groups, 30, "vertex Z", state, vertexContext, {defaultValue: 0});
    const bulge = readNumber(vertexRecord.groups, 42, "bulge", state, vertexContext, {defaultValue: 0});
    if (z !== 0) state.add("error", "non-2d-entity", "VERTEX has a nonzero Z coordinate.", vertexContext);
    flagUnsupportedPolylineWidth(vertexRecord.groups, state, vertexContext, [40, 41]);
    vertices.push({
      x,
      y,
      bulge,
      layer: entityLayer(vertexRecord),
      sourceLine: vertexRecord.line,
    });
  }
  if (state.errors > errorStart) return null;
  return buildPolyline(record, entityId, vertices, Boolean(flags & 1), state);
}

function splitEntityRecords(entityPairs, state, maxEntityRecords) {
  const records = [];
  let current = null;
  let recordLimitExceeded = false;
  const finishRecord = () => {
    if (!current) return;
    const allGroups = current.groups;
    const groups = [];
    let applicationDepth = 0;
    for (const group of allGroups) {
      if (group.code === 102) {
        if (group.value.startsWith("{")) applicationDepth += 1;
        else if (group.value === "}") {
          if (applicationDepth === 0) {
            state.add("error", "unbalanced-application-group", `${current.type} has an unmatched group 102 closing brace.`, {
              line: group.line, entityType: current.type,
            });
          } else applicationDepth -= 1;
        } else {
          state.add("error", "invalid-application-group", `${current.type} has an invalid group 102 control string.`, {
            line: group.line, entityType: current.type,
          });
        }
        continue;
      }
      if (applicationDepth === 0) groups.push(group);
    }
    if (applicationDepth !== 0) {
      state.add("error", "unbalanced-application-group", `${current.type} has an unterminated group 102 application-defined group.`, {
        line: current.line, entityType: current.type,
      });
    }
    records.push({...current, groups, allGroups});
  };
  for (const pair of entityPairs) {
    if (pair.code === 0) {
      finishRecord();
      current = null;
      if (records.length >= maxEntityRecords) {
        if (!recordLimitExceeded) {
          state.add("error", "entity-record-limit-exceeded", `DXF exceeds the ${maxEntityRecords}-entity-record complexity limit.`, {line: pair.line});
          recordLimitExceeded = true;
        }
        break;
      }
      current = {type: normalizedUpper(pair.value), line: pair.line, groups: []};
      continue;
    }
    if (!current) {
      if (pair.code !== 999) {
        state.add("error", "entity-data-before-marker", "ENTITIES data appears before an entity type marker.", {line: pair.line});
      }
      continue;
    }
    current.groups.push(pair);
  }
  if (!recordLimitExceeded) finishRecord();
  return records;
}

function extractHeaderVariable(headerPairs, variableName) {
  const values = [];
  for (let index = 0; index < headerPairs.length; index += 1) {
    const pair = headerPairs[index];
    if (pair.code !== 9 || normalizedUpper(pair.value) !== variableName) continue;
    const variablePairs = [];
    for (index += 1; index < headerPairs.length && headerPairs[index].code !== 9; index += 1) {
      variablePairs.push(headerPairs[index]);
    }
    index -= 1;
    values.push({line: pair.line, pairs: variablePairs});
  }
  return values;
}

function parseUnits(headerPairs, state) {
  const declarations = extractHeaderVariable(headerPairs, "$INSUNITS");
  if (!declarations.length) {
    state.add("error", "units-missing", "DXF HEADER does not declare $INSUNITS; select source units explicitly before dimensional use.");
    return {status: "missing", code: null, name: null, symbol: null, millimetersPerUnit: null, source: null};
  }
  if (declarations.length > 1) {
    state.add("error", "units-conflict", "DXF HEADER contains more than one $INSUNITS declaration.", {line: declarations[1].line});
  }
  const declaration = declarations[0];
  const codePairs = declaration.pairs.filter((pair) => pair.code === 70);
  if (codePairs.length !== 1) {
    state.add("error", "units-invalid", "$INSUNITS must contain exactly one group 70 value.", {line: declaration.line});
    return {status: "invalid", code: null, name: null, symbol: null, millimetersPerUnit: null, source: "$INSUNITS"};
  }
  const code = parseNumericLexeme(codePairs[0].value);
  if (code === null || !Number.isInteger(code)) {
    state.add("error", "units-invalid", `$INSUNITS value '${codePairs[0].value}' is not an integer.`, {line: codePairs[0].valueLine});
    return {status: "invalid", code: null, name: null, symbol: null, millimetersPerUnit: null, source: "$INSUNITS"};
  }
  const definition = INSUNITS.get(code);
  if (!definition) {
    state.add("error", "units-unsupported", `$INSUNITS code ${code} is not supported.`, {line: codePairs[0].valueLine});
    return {status: "unsupported", code, name: null, symbol: null, millimetersPerUnit: null, source: "$INSUNITS"};
  }
  if (code === 0) {
    state.add("error", "units-unitless", "$INSUNITS is unitless; select source units explicitly before dimensional use.", {line: codePairs[0].valueLine});
    return {...definition, status: "unitless", source: "$INSUNITS"};
  }
  return {...definition, status: "declared", source: "$INSUNITS"};
}

function parseVersion(headerPairs) {
  const declaration = extractHeaderVariable(headerPairs, "$ACADVER")[0];
  return declaration?.pairs.find((pair) => pair.code === 1)?.value ?? null;
}

function tableRecords(pairs, recordType) {
  const records = [];
  let current = null;
  for (const pair of pairs) {
    if (pair.code === 0) {
      if (current) records.push(current);
      current = normalizedUpper(pair.value) === recordType
        ? {line: pair.line, groups: []}
        : null;
      continue;
    }
    if (current) current.groups.push(pair);
  }
  if (current) records.push(current);
  return records;
}

function uniqueTableValue(groups, code) {
  const matches = groups.filter((group) => group.code === code);
  return matches.length === 1 ? matches[0] : null;
}

function parseLayerTable(tablePairs) {
  const layerTables = [];
  for (let index = 0; index < tablePairs.length; index += 1) {
    const pair = tablePairs[index];
    if (pair.code !== 0 || normalizedUpper(pair.value) !== "TABLE") continue;
    const namePair = tablePairs[index + 1];
    const tableName = namePair?.code === 2 ? normalizedUpper(namePair.value) : null;
    let endIndex = index + 1;
    while (endIndex < tablePairs.length
      && !(tablePairs[endIndex].code === 0 && normalizedUpper(tablePairs[endIndex].value) === "ENDTAB")) {
      endIndex += 1;
    }
    if (tableName === "LAYER") {
      layerTables.push({
        line: pair.line,
        closed: endIndex < tablePairs.length,
        pairs: tablePairs.slice(index + 2, endIndex),
      });
    }
    index = endIndex;
  }
  if (layerTables.length !== 1 || !layerTables[0].closed) {
    return {
      status: layerTables.length > 1 ? "duplicate-table" : "missing-table",
      tableCount: layerTables.length,
      records: [],
    };
  }

  const records = tableRecords(layerTables[0].pairs, "LAYER").map((record) => {
    const namePair = uniqueTableValue(record.groups, 2);
    const flagsPair = uniqueTableValue(record.groups, 70);
    const colorPair = uniqueTableValue(record.groups, 62);
    const plotPairs = record.groups.filter((group) => group.code === 290);
    const name = namePair?.value ?? null;
    const flags = flagsPair ? parseNumericLexeme(flagsPair.value) : null;
    const color = colorPair ? parseNumericLexeme(colorPair.value) : null;
    const plot = plotPairs.length === 0 ? true : parseNumericLexeme(plotPairs[0].value);
    const issues = [];
    if (!namePair || !name) issues.push("name");
    if (!flagsPair || !Number.isInteger(flags) || flags < 0 || flags > 255) issues.push("flags");
    if (!colorPair || !Number.isInteger(color) || color === 0 || Math.abs(color) > 255) issues.push("color");
    if (plotPairs.length > 1 || (plotPairs.length === 1 && plot !== 0 && plot !== 1)) issues.push("plot");
    return {
      name,
      normalizedName: name ? normalizedUpper(name) : null,
      line: record.line,
      flags,
      color,
      plot: plot === 1 || plot === true,
      plotValueSupplied: plotPairs.length > 0,
      issues,
    };
  });
  const counts = new Map();
  for (const record of records) {
    if (!record.normalizedName) continue;
    counts.set(record.normalizedName, (counts.get(record.normalizedName) || 0) + 1);
  }
  for (const record of records) {
    if (record.normalizedName && counts.get(record.normalizedName) !== 1) record.issues.push("duplicate");
  }
  return {status: "ready", tableCount: 1, records};
}

function moduloTau(angle) {
  return ((angle % TAU) + TAU) % TAU;
}

function angleFallsOnArc(angle, startAngle, sweep) {
  const tolerance = 1e-12;
  if (sweep >= 0) return moduloTau(angle - startAngle) <= sweep + tolerance;
  return moduloTau(startAngle - angle) <= -sweep + tolerance;
}

function nativePrimitiveIsFinite(primitive) {
  const finitePoint = (candidate) => Number.isFinite(candidate?.x) && Number.isFinite(candidate?.y);
  if (primitive.type === "line") {
    return finitePoint(primitive.start) && finitePoint(primitive.end)
      && Number.isFinite(primitive.end.x - primitive.start.x)
      && Number.isFinite(primitive.end.y - primitive.start.y)
      && (primitive.start.x !== primitive.end.x || primitive.start.y !== primitive.end.y);
  }
  if (!finitePoint(primitive.center) || !Number.isFinite(primitive.radius) || primitive.radius <= 0) return false;
  if (![primitive.center.x - primitive.radius, primitive.center.x + primitive.radius,
    primitive.center.y - primitive.radius, primitive.center.y + primitive.radius].every(Number.isFinite)) return false;
  if ((primitive.center.x - primitive.radius === primitive.center.x && primitive.center.x + primitive.radius === primitive.center.x)
    || (primitive.center.y - primitive.radius === primitive.center.y && primitive.center.y + primitive.radius === primitive.center.y)) return false;
  if (primitive.type === "circle") return true;
  return finitePoint(primitive.start) && finitePoint(primitive.end)
    && (primitive.start.x !== primitive.end.x || primitive.start.y !== primitive.end.y)
    && Number.isFinite(primitive.startAngle) && Number.isFinite(primitive.sweep) && primitive.sweep !== 0;
}

function analyticArcEndpointsAreConsistent(primitive, firstCoordinate, secondCoordinate, absoluteBudget = Number.POSITIVE_INFINITY) {
  if (primitive.type !== "arc") return true;
  const reconstructed = [primitive.startAngle, primitive.startAngle + primitive.sweep].map((angle) => ({
    [firstCoordinate]: primitive.center[firstCoordinate] + Math.cos(angle) * primitive.radius,
    [secondCoordinate]: primitive.center[secondCoordinate] + Math.sin(angle) * primitive.radius,
  }));
  const expected = [primitive.start, primitive.end];
  const localScale = Math.hypot(
    expected[1][firstCoordinate] - expected[0][firstCoordinate],
    expected[1][secondCoordinate] - expected[0][secondCoordinate],
  );
  const relativeBudget = Number.EPSILON * 4096 * Math.max(localScale, Number.MIN_VALUE);
  const endpointMagnitude = Math.max(1, ...expected.flatMap((candidate) => [
    Math.abs(candidate[firstCoordinate]), Math.abs(candidate[secondCoordinate]),
  ]));
  const coordinateUlpAllowance = Number.EPSILON * 4 * endpointMagnitude;
  const budget = Math.min(Math.max(relativeBudget, coordinateUlpAllowance), absoluteBudget);
  return reconstructed.every((candidate, index) => (
    Math.abs(candidate[firstCoordinate] - expected[index][firstCoordinate]) <= budget
    && Math.abs(candidate[secondCoordinate] - expected[index][secondCoordinate]) <= budget
  ));
}

function analyticArcEndpointUncertainty(primitive, firstCoordinate, secondCoordinate) {
  if (primitive.type !== "arc") return 0;
  const reconstructed = [primitive.startAngle, primitive.startAngle + primitive.sweep].map((angle) => ({
    [firstCoordinate]: primitive.center[firstCoordinate] + Math.cos(angle) * primitive.radius,
    [secondCoordinate]: primitive.center[secondCoordinate] + Math.sin(angle) * primitive.radius,
  }));
  return Math.max(...reconstructed.map((candidate, index) => Math.hypot(
    candidate[firstCoordinate] - [primitive.start, primitive.end][index][firstCoordinate],
    candidate[secondCoordinate] - [primitive.start, primitive.end][index][secondCoordinate],
  )));
}

function primitiveCoordinateMagnitude(primitive, firstCoordinate, secondCoordinate) {
  const points = primitive.type === "line"
    ? [primitive.start, primitive.end]
    : [primitive.center, ...(primitive.type === "arc" ? [primitive.start, primitive.end] : [])];
  const values = points.flatMap((candidate) => [
    candidate?.[firstCoordinate], candidate?.[secondCoordinate],
  ]);
  if (primitive.radius !== undefined) {
    values.push(
      primitive.radius,
      primitive.center[firstCoordinate] - primitive.radius,
      primitive.center[firstCoordinate] + primitive.radius,
      primitive.center[secondCoordinate] - primitive.radius,
      primitive.center[secondCoordinate] + primitive.radius,
    );
  }
  if (!values.every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  return Math.max(1, ...values.map(Math.abs));
}

function bulgeDerivationUncertainty(primitive, firstCoordinate, secondCoordinate) {
  const bulge = Number(primitive.source?.bulge);
  const magnitude = Math.abs(bulge);
  if (primitive.type !== "arc" || !Number.isFinite(magnitude) || magnitude === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const endpointMagnitude = Math.max(1, ...[primitive.start, primitive.end].flatMap((candidate) => [
    Math.abs(candidate[firstCoordinate]), Math.abs(candidate[secondCoordinate]),
  ]));
  const inputUlp = Number.EPSILON * endpointMagnitude;
  // For b = tan(sweep/4), radius/chord is (|b| + 1/|b|) / 4.
  // Endpoint and bulge quantization are therefore amplified for both shallow
  // and near-full arcs. The factor 16 bounds midpoint, chord-vector,
  // center/radius, start-angle, and sweep perturbations from one-ULP inputs.
  const condition = (magnitude + 1 / magnitude) / 4;
  const inputConditioningUncertainty = 16 * inputUlp * (1 + condition);
  const derivedRoundoffUncertainty = Number.EPSILON
    * BULGE_DERIVATION_ROUNDING_ULPS
    * primitiveCoordinateMagnitude(primitive, firstCoordinate, secondCoordinate);
  const endpointReconstructionUncertainty = analyticArcEndpointUncertainty(
    primitive,
    firstCoordinate,
    secondCoordinate,
  );
  const total = inputConditioningUncertainty
    + derivedRoundoffUncertainty
    + endpointReconstructionUncertainty;
  return Number.isFinite(total) ? total : Number.POSITIVE_INFINITY;
}

function sourceArcAngleUncertainty(primitive) {
  if (primitive.type !== "arc" || primitive.source?.dxfType !== "ARC") return 0;
  const startDegrees = primitive.source.startAngleDegrees;
  const endDegrees = primitive.source.endAngleDegrees;
  if (!Number.isFinite(startDegrees) || !Number.isFinite(endDegrees)) return Number.POSITIVE_INFINITY;
  // Parsing, range reduction, sweep subtraction, and degree-to-radian
  // conversion all operate on binary64 values. Bound their combined angular
  // uncertainty from the original (not normalized) angle magnitudes so a huge
  // group-50/51 value cannot appear precise merely because `% 360` is small.
  const uncertaintyDegrees = Number.EPSILON * ARC_ANGLE_ROUNDING_ULPS * (
    Math.max(360, Math.abs(startDegrees)) + Math.max(360, Math.abs(endDegrees))
  );
  const endpointUncertainty = primitive.radius * uncertaintyDegrees * Math.PI / 180;
  return Number.isFinite(endpointUncertainty) ? endpointUncertainty : Number.POSITIVE_INFINITY;
}

function sourceArcAnglesMeetNumericalBudget(primitive, nativeBudget) {
  return sourceArcAngleUncertainty(primitive) <= nativeBudget;
}

function primitiveSourceGeometryUncertainty(primitive, firstCoordinate, secondCoordinate) {
  if (primitive.source?.bulge) {
    return bulgeDerivationUncertainty(primitive, firstCoordinate, secondCoordinate);
  }
  const coordinateUncertainty = Number.EPSILON
    * DERIVED_GEOMETRY_ROUNDING_ULPS
    * primitiveCoordinateMagnitude(primitive, firstCoordinate, secondCoordinate);
  const angleUncertainty = sourceArcAngleUncertainty(primitive);
  const endpointUncertainty = analyticArcEndpointUncertainty(
    primitive,
    firstCoordinate,
    secondCoordinate,
  );
  const total = coordinateUncertainty + angleUncertainty + endpointUncertainty;
  return Number.isFinite(total) ? total : Number.POSITIVE_INFINITY;
}

function primitiveCoordinatesMeetNumericalBudget(primitives, budget, firstCoordinate, secondCoordinate) {
  for (const primitive of primitives) {
    const withinBudget = (value) => Number.isFinite(value)
      && Number.EPSILON * DERIVED_GEOMETRY_ROUNDING_ULPS * Math.max(1, Math.abs(value)) <= budget;
    const candidates = primitive.type === "line"
      ? [primitive.start, primitive.end]
      : [primitive.center, ...(primitive.type === "arc" ? [primitive.start, primitive.end] : [])];
    if (candidates.some((candidate) => (
      !withinBudget(candidate[firstCoordinate]) || !withinBudget(candidate[secondCoordinate])
    ))) return false;
    if (primitive.radius !== undefined) {
      const radialValues = [
        primitive.radius,
        primitive.center[firstCoordinate] - primitive.radius,
        primitive.center[firstCoordinate] + primitive.radius,
        primitive.center[secondCoordinate] - primitive.radius,
        primitive.center[secondCoordinate] + primitive.radius,
      ];
      if (radialValues.some((value) => !withinBudget(value))) return false;
    }
  }
  return true;
}

function latheCoordinatesMeetNumericalBudget(primitives, budget) {
  return primitiveCoordinatesMeetNumericalBudget(primitives, budget, "z", "x");
}

function nativeCoordinatesMeetNumericalBudget(primitives, budget) {
  return primitiveCoordinatesMeetNumericalBudget(primitives, budget, "x", "y");
}

function lathePrimitiveIsFinite(primitive) {
  const finitePoint = (candidate) => Number.isFinite(candidate?.z) && Number.isFinite(candidate?.x);
  if (primitive.type === "line") {
    return finitePoint(primitive.start) && finitePoint(primitive.end)
      && Number.isFinite(primitive.end.z - primitive.start.z)
      && Number.isFinite(primitive.end.x - primitive.start.x)
      && (primitive.start.z !== primitive.end.z || primitive.start.x !== primitive.end.x);
  }
  if (!finitePoint(primitive.center) || !Number.isFinite(primitive.radius) || primitive.radius <= 0) return false;
  if (![primitive.center.z - primitive.radius, primitive.center.z + primitive.radius,
    primitive.center.x - primitive.radius, primitive.center.x + primitive.radius].every(Number.isFinite)) return false;
  if ((primitive.center.z - primitive.radius === primitive.center.z && primitive.center.z + primitive.radius === primitive.center.z)
    || (primitive.center.x - primitive.radius === primitive.center.x && primitive.center.x + primitive.radius === primitive.center.x)) return false;
  if (primitive.type === "circle") return true;
  return finitePoint(primitive.start) && finitePoint(primitive.end)
    && (primitive.start.z !== primitive.end.z || primitive.start.x !== primitive.end.x)
    && Number.isFinite(primitive.startAngle) && Number.isFinite(primitive.sweep) && primitive.sweep !== 0;
}

function nativeBounds(primitives) {
  if (!primitives.length) return null;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const include = (candidate) => {
    minX = Math.min(minX, candidate.x);
    maxX = Math.max(maxX, candidate.x);
    minY = Math.min(minY, candidate.y);
    maxY = Math.max(maxY, candidate.y);
  };
  for (const primitive of primitives) {
    if (primitive.type === "line") {
      include(primitive.start);
      include(primitive.end);
      continue;
    }
    if (primitive.type === "circle") {
      include(point(primitive.center.x - primitive.radius, primitive.center.y - primitive.radius));
      include(point(primitive.center.x + primitive.radius, primitive.center.y + primitive.radius));
      continue;
    }
    include(primitive.start);
    include(primitive.end);
    for (const angle of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
      if (angleFallsOnArc(angle, primitive.startAngle, primitive.sweep)) {
        include(arcPoint(primitive.center, primitive.radius, angle));
      }
    }
  }
  return {minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY};
}

function summarizeDiagnostics(state) {
  const summary = {errors: state.errors, warnings: state.warnings, total: state.diagnostics.length};
  if (state.suppressed) summary.suppressed = state.suppressed;
  return summary;
}

function resolveUnit(value) {
  if (Number.isInteger(value)) return INSUNITS.get(value) ?? null;
  const code = UNIT_ALIASES.get(String(value ?? "").trim().toLowerCase());
  return code === undefined ? null : INSUNITS.get(code);
}

function transformedBounds(primitives) {
  const bounds = nativeBounds(primitives.map((primitive) => {
    const swapPoint = (candidate) => point(candidate.z, candidate.x);
    if (primitive.type === "line") return {...primitive, start: swapPoint(primitive.start), end: swapPoint(primitive.end)};
    if (primitive.type === "circle") return {...primitive, center: swapPoint(primitive.center)};
    return {
      ...primitive,
      center: swapPoint(primitive.center),
      start: swapPoint(primitive.start),
      end: swapPoint(primitive.end),
    };
  }));
  return bounds ? {
    minZ: bounds.minX,
    maxZ: bounds.maxX,
    minX: bounds.minY,
    maxX: bounds.maxY,
    zSpan: bounds.width,
    xSpan: bounds.height,
  } : null;
}

/**
 * Parse an ASCII DXF file without changing its native X/Y coordinate system.
 * The returned primitives are analytic; callers must explicitly call
 * toLatheGeometry before treating DXF X as Z and DXF Y as radial X.
 */
export function parseDxf(text, {sourceName = null, sourceHash = null, limits: limitOverrides = {}} = {}) {
  if (typeof text !== "string") throw new TypeError("DXF source must be a string.");
  const limits = boundedLimits(limitOverrides);
  const state = diagnosticState(limits.maxDiagnostics);
  const pairs = tokenizeAsciiDxf(text, state, limits.maxGroupPairs);
  const sections = partitionSections(pairs, state);
  const headerPairs = sections.get("HEADER") ?? [];
  const tablePairs = sections.get("TABLES") ?? [];
  const entityPairs = sections.get("ENTITIES");
  const units = parseUnits(headerPairs, state);
  const layers = parseLayerTable(tablePairs);
  const entities = [];
  const primitives = [];
  const budget = {limits, totalVertices: 0};
  const nativeNumericalBudget = units.millimetersPerUnit
    ? MAX_NUMERICAL_ERROR_MM / units.millimetersPerUnit
    : Number.POSITIVE_INFINITY;
  let entityRecordCount = 0;

  if (!entityPairs) {
    state.add("error", "entities-section-missing", "DXF file has no ENTITIES section.");
  } else {
    const records = splitEntityRecords(entityPairs, state, limits.maxEntityRecords);
    entityRecordCount = records.length;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const entityId = `dxf-entity-${index + 1}`;
      let parsed = null;
      if (record.type === "LINE") parsed = parseLineEntity(record, entityId, state);
      else if (record.type === "ARC") parsed = parseArcEntity(record, entityId, state);
      else if (record.type === "CIRCLE") parsed = parseCircleEntity(record, entityId, state);
      else if (record.type === "LWPOLYLINE") parsed = parseLwPolyline(record, entityId, state, budget);
      else if (record.type === "POLYLINE") {
        const vertexRecords = [];
        let cursor = index + 1;
        while (cursor < records.length && records[cursor].type === "VERTEX") {
          vertexRecords.push(records[cursor]);
          cursor += 1;
        }
        const hasSeqend = cursor < records.length && records[cursor].type === "SEQEND";
        parsed = parseClassicPolyline(record, vertexRecords, hasSeqend, entityId, state, budget);
        index = hasSeqend ? cursor : cursor - 1;
      } else if (record.type === "VERTEX" || record.type === "SEQEND") {
        state.add("error", "orphan-polyline-record", `${record.type} appears outside a POLYLINE sequence.`, {line: record.line, entityType: record.type, entityId});
      } else if (NON_2D_ENTITY_TYPES.has(record.type)) {
        state.add("error", "non-2d-entity", `${record.type} is not accepted as 2D profile geometry.`, {line: record.line, entityType: record.type, entityId});
      } else {
        state.add("error", "unsupported-entity", `${record.type || "Unknown entity"} is not supported for 2D profile import.`, {line: record.line, entityType: record.type || null, entityId});
      }
      if (parsed && primitives.length + parsed.primitives.length > limits.maxPrimitives) {
        state.add("error", "primitive-limit-exceeded", `DXF exceeds the ${limits.maxPrimitives}-primitive complexity limit.`, {
          line: record.line, entityType: record.type, entityId,
        });
        break;
      }
      if (parsed && !parsed.primitives.every(nativePrimitiveIsFinite)) {
        state.add("error", "non-finite-derived-geometry", `${record.type} produces geometry outside the finite numeric range.`, {
          line: record.line, entityType: record.type, entityId,
        });
        parsed = null;
      }
      if (parsed) {
        for (const primitive of parsed.primitives) {
          primitive.geometryUncertaintyNative = primitiveSourceGeometryUncertainty(
            primitive,
            "x",
            "y",
          );
        }
      }
      if (parsed && parsed.primitives.some((primitive) => (
        !sourceArcAnglesMeetNumericalBudget(primitive, nativeNumericalBudget)
      ))) {
        state.add("error", "ill-conditioned-arc-angle", `${record.type} group-50/51 angles cannot retain the required 0.00005 in endpoint budget at this radius.`, {
          line: record.line, entityType: record.type, entityId,
        });
        parsed = null;
      }
      if (parsed && parsed.primitives.some((primitive) => (
        primitive.source?.bulge
        && (
          !Number.isFinite(primitive.geometryUncertaintyNative)
          || primitive.geometryUncertaintyNative > nativeNumericalBudget
          || !analyticArcEndpointsAreConsistent(primitive, "x", "y", nativeNumericalBudget)
          || analyticArcEndpointUncertainty(primitive, "x", "y") > nativeNumericalBudget
        )
      ))) {
        state.add("error", "ill-conditioned-bulge-arc", `${record.type} contains a bulge arc whose whole-curve derivation cannot retain the required numeric precision.`, {
          line: record.line, entityType: record.type, entityId,
        });
        parsed = null;
      }
      if (parsed && parsed.primitives.some((primitive) => (
        !Number.isFinite(primitive.geometryUncertaintyNative)
        || primitive.geometryUncertaintyNative > nativeNumericalBudget
      ))) {
        state.add("error", "source-coordinate-resolution", `${record.type} source and derived geometry cannot retain the required 0.00005 in numerical budget.`, {
          line: record.line, entityType: record.type, entityId,
        });
        parsed = null;
      }
      if (parsed && Number.isFinite(nativeNumericalBudget)
        && !nativeCoordinatesMeetNumericalBudget(parsed.primitives, nativeNumericalBudget)) {
        state.add("error", "source-coordinate-resolution", `${record.type} coordinates or derived arc extrema cannot retain the required 0.00005 in numerical budget.`, {
          line: record.line, entityType: record.type, entityId,
        });
        parsed = null;
      }
      if (parsed) {
        entities.push(parsed.entity);
        primitives.push(...parsed.primitives);
      }
    }
  }

  if (!primitives.length) state.add("error", "no-supported-geometry", "DXF contains no usable LINE, ARC, CIRCLE, or polyline geometry.");
  let bounds = nativeBounds(primitives);
  if (bounds && !Object.values(bounds).every(Number.isFinite)) {
    state.add("error", "non-finite-bounds", "DXF geometry spans outside the finite numeric range.");
    bounds = null;
  }
  return {
    schemaVersion: 1,
    format: "ascii-dxf",
    coordinateSystem: "dxf-xy",
    source: {
      name: sourceName,
      hash: sourceHash,
      characterLength: text.length,
      lineCount: sourceLineCount(text),
      originalText: text,
    },
    dxfVersion: parseVersion(headerPairs),
    units,
    layers,
    entities,
    primitives,
    bounds,
    diagnostics: state.diagnostics,
    diagnosticSummary: summarizeDiagnostics(state),
    complexity: {
      groupPairs: pairs.length,
      entityRecords: entityRecordCount,
      vertices: budget.totalVertices,
      primitives: primitives.length,
      limits,
    },
    authorized: state.errors === 0,
  };
}

export const parseAsciiDxf = parseDxf;

function materialFinitePoint(candidate) {
  return Number.isFinite(candidate?.z) && Number.isFinite(candidate?.x);
}

function materialDistance(first, second) {
  return Math.hypot(second.z - first.z, second.x - first.x);
}

function materialSubtract(first, second) {
  return {z: first.z - second.z, x: first.x - second.x};
}

function materialDot(first, second) {
  return first.z * second.z + first.x * second.x;
}

function materialCross(first, second) {
  return first.z * second.x - first.x * second.z;
}

function materialRoundingBound(values, ulps = MATERIAL_ROUNDING_ULPS) {
  const magnitude = Math.max(1, ...values.filter(Number.isFinite).map(Math.abs));
  const result = magnitude * Number.EPSILON * ulps;
  return Number.isFinite(result) ? result : Number.POSITIVE_INFINITY;
}

function materialNormalizeAngle(angle) {
  const result = angle % TAU;
  return result < 0 ? result + TAU : result;
}

function materialArcContainsAngle(primitive, angle) {
  if (primitive.type === "circle") return true;
  const magnitude = Math.abs(primitive.sweep);
  const delta = primitive.sweep >= 0
    ? materialNormalizeAngle(angle - primitive.startAngle)
    : materialNormalizeAngle(primitive.startAngle - angle);
  const allowance = materialRoundingBound(
    [angle, primitive.startAngle, primitive.sweep],
    MATERIAL_TRIG_ROUNDING_ULPS,
  );
  return delta <= magnitude + allowance;
}

function materialArcContainsPoint(primitive, candidate) {
  if (primitive.type !== "circle") {
    const endpointAllowance = materialRoundingBound([
      candidate.z, candidate.x,
      primitive.start?.z, primitive.start?.x,
      primitive.end?.z, primitive.end?.x,
    ]);
    if (materialDistance(candidate, primitive.start) <= endpointAllowance
      || materialDistance(candidate, primitive.end) <= endpointAllowance) return true;
  }
  const angle = Math.atan2(candidate.x - primitive.center.x, candidate.z - primitive.center.z);
  return Number.isFinite(angle) && materialArcContainsAngle(primitive, angle);
}

function uniqueMaterialIntersections(points) {
  const unique = [];
  for (const candidate of points) {
    const allowance = materialRoundingBound([candidate.z, candidate.x], 128);
    if (!unique.some((existing) => materialDistance(existing, candidate) <= allowance)) unique.push(candidate);
  }
  return unique;
}

function materialLineLineIntersections(first, second) {
  const firstDirection = materialSubtract(first.end, first.start);
  const secondDirection = materialSubtract(second.end, second.start);
  const offset = materialSubtract(second.start, first.start);
  const denominatorTerms = [
    firstDirection.z * secondDirection.x,
    firstDirection.x * secondDirection.z,
  ];
  const denominator = denominatorTerms[0] - denominatorTerms[1];
  const denominatorRoundoff = materialRoundingBound(denominatorTerms, 64);
  if (Math.abs(denominator) <= denominatorRoundoff) {
    const collinearTerms = [offset.z * firstDirection.x, offset.x * firstDirection.z];
    if (Math.abs(collinearTerms[0] - collinearTerms[1]) > materialRoundingBound(collinearTerms, 64)) {
      return {points: [], overlap: false};
    }
    const component = Math.abs(firstDirection.z) >= Math.abs(firstDirection.x) ? "z" : "x";
    const divisor = firstDirection[component];
    if (!Number.isFinite(divisor) || divisor === 0) return {points: [], overlap: true};
    const firstParameter = (second.start[component] - first.start[component]) / divisor;
    const secondParameter = (second.end[component] - first.start[component]) / divisor;
    const overlapStart = Math.max(0, Math.min(firstParameter, secondParameter));
    const overlapEnd = Math.min(1, Math.max(firstParameter, secondParameter));
    const parameterRoundoff = materialRoundingBound([firstParameter, secondParameter], 64);
    if (overlapStart > overlapEnd + parameterRoundoff) return {points: [], overlap: false};
    return {
      points: [{
        z: first.start.z + firstDirection.z * overlapStart,
        x: first.start.x + firstDirection.x * overlapStart,
      }],
      overlap: overlapEnd - overlapStart > parameterRoundoff,
    };
  }
  const firstParameter = materialCross(offset, secondDirection) / denominator;
  const secondParameter = materialCross(offset, firstDirection) / denominator;
  const parameterRoundoff = materialRoundingBound([firstParameter, secondParameter], 64);
  if (firstParameter < -parameterRoundoff || firstParameter > 1 + parameterRoundoff
    || secondParameter < -parameterRoundoff || secondParameter > 1 + parameterRoundoff) {
    return {points: [], overlap: false};
  }
  const boundedParameter = Math.max(0, Math.min(1, firstParameter));
  return {
    points: [{
      z: first.start.z + firstDirection.z * boundedParameter,
      x: first.start.x + firstDirection.x * boundedParameter,
    }],
    overlap: false,
  };
}

function materialLineArcIntersections(linePrimitive, arcPrimitive) {
  const direction = materialSubtract(linePrimitive.end, linePrimitive.start);
  const offset = materialSubtract(linePrimitive.start, arcPrimitive.center);
  const quadratic = materialDot(direction, direction);
  const linear = 2 * materialDot(offset, direction);
  const constant = materialDot(offset, offset) - arcPrimitive.radius ** 2;
  const discriminantTerms = [linear ** 2, 4 * quadratic * constant];
  const discriminant = discriminantTerms[0] - discriminantTerms[1];
  const discriminantRoundoff = materialRoundingBound(discriminantTerms, 128);
  if (discriminant < -discriminantRoundoff) return {points: [], overlap: false};
  const root = Math.sqrt(Math.max(0, discriminant));
  const parameters = root <= materialRoundingBound([root], 32)
    ? [-linear / (2 * quadratic)]
    : [(-linear - root) / (2 * quadratic), (-linear + root) / (2 * quadratic)];
  const points = [];
  for (const parameter of parameters) {
    const parameterRoundoff = materialRoundingBound([parameter], 64);
    if (parameter < -parameterRoundoff || parameter > 1 + parameterRoundoff) continue;
    const boundedParameter = Math.max(0, Math.min(1, parameter));
    const candidate = {
      z: linePrimitive.start.z + direction.z * boundedParameter,
      x: linePrimitive.start.x + direction.x * boundedParameter,
    };
    if (materialArcContainsPoint(arcPrimitive, candidate)) points.push(candidate);
  }
  return {points: uniqueMaterialIntersections(points), overlap: false};
}

function materialArcStrictlyContainsAngle(primitive, angle) {
  if (primitive.type === "circle") return true;
  const magnitude = Math.abs(primitive.sweep);
  const delta = primitive.sweep >= 0
    ? materialNormalizeAngle(angle - primitive.startAngle)
    : materialNormalizeAngle(primitive.startAngle - angle);
  const allowance = materialRoundingBound(
    [angle, primitive.startAngle, primitive.sweep],
    MATERIAL_TRIG_ROUNDING_ULPS,
  );
  return delta > allowance && delta < magnitude - allowance;
}

function materialArcMidpoint(primitive) {
  const angle = primitive.startAngle + primitive.sweep / 2;
  return {
    angle,
    point: {
      z: primitive.center.z + Math.cos(angle) * primitive.radius,
      x: primitive.center.x + Math.sin(angle) * primitive.radius,
    },
  };
}

function materialCircularIntersections(first, second) {
  const centerOffset = materialSubtract(second.center, first.center);
  const centerDistance = Math.hypot(centerOffset.z, centerOffset.x);
  const linearRoundoff = materialRoundingBound([
    first.center.z, first.center.x, second.center.z, second.center.x,
    first.radius, second.radius, centerDistance,
  ], 128);
  if (centerDistance <= linearRoundoff) {
    if (Math.abs(first.radius - second.radius) > linearRoundoff) return {points: [], overlap: false};
    if (centerDistance !== 0 || first.radius !== second.radius) return {points: [], overlap: true};
    if (first.type === "circle" || second.type === "circle") return {points: [], overlap: true};
    const sharedEndpoints = [
      ...[first.start, first.end].filter((candidate) => materialArcContainsPoint(second, candidate)),
      ...[second.start, second.end].filter((candidate) => materialArcContainsPoint(first, candidate)),
    ];
    const firstMiddle = materialArcMidpoint(first);
    const secondMiddle = materialArcMidpoint(second);
    const overlap = [first.start, first.end].some((candidate) => (
      materialArcStrictlyContainsAngle(
        second,
        Math.atan2(candidate.x - second.center.x, candidate.z - second.center.z),
      )
    )) || [second.start, second.end].some((candidate) => (
      materialArcStrictlyContainsAngle(
        first,
        Math.atan2(candidate.x - first.center.x, candidate.z - first.center.z),
      )
    )) || materialArcStrictlyContainsAngle(second, firstMiddle.angle)
      || materialArcStrictlyContainsAngle(first, secondMiddle.angle);
    return {points: uniqueMaterialIntersections(sharedEndpoints), overlap};
  }
  const radiusSum = first.radius + second.radius;
  const radiusDifference = Math.abs(first.radius - second.radius);
  if (centerDistance > radiusSum + linearRoundoff || centerDistance < radiusDifference - linearRoundoff) {
    return {points: [], overlap: false};
  }
  const along = (first.radius ** 2 - second.radius ** 2 + centerDistance ** 2) / (2 * centerDistance);
  const heightSquared = first.radius ** 2 - along ** 2;
  const squaredRoundoff = materialRoundingBound([first.radius ** 2, along ** 2], 128);
  if (heightSquared < -squaredRoundoff) return {points: [], overlap: false};
  if (heightSquared < 0) return {points: [], overlap: true};
  const height = Math.sqrt(Math.max(0, heightSquared));
  const base = {
    z: first.center.z + centerOffset.z * along / centerDistance,
    x: first.center.x + centerOffset.x * along / centerDistance,
  };
  const perpendicular = {z: -centerOffset.x / centerDistance, x: centerOffset.z / centerDistance};
  const points = height <= linearRoundoff
    ? [base]
    : [
      {z: base.z + perpendicular.z * height, x: base.x + perpendicular.x * height},
      {z: base.z - perpendicular.z * height, x: base.x - perpendicular.x * height},
    ];
  return {
    points: points.filter((candidate) => (
      materialArcContainsPoint(first, candidate) && materialArcContainsPoint(second, candidate)
    )),
    overlap: false,
  };
}

function materialPrimitiveIntersections(first, second) {
  if (first.type === "line" && second.type === "line") return materialLineLineIntersections(first, second);
  if (first.type === "line") return materialLineArcIntersections(first, second);
  if (second.type === "line") return materialLineArcIntersections(second, first);
  return materialCircularIntersections(first, second);
}

function materialPointToLineDistance(candidate, primitive) {
  const direction = materialSubtract(primitive.end, primitive.start);
  const denominator = materialDot(direction, direction);
  const parameter = Math.max(
    0,
    Math.min(1, materialDot(materialSubtract(candidate, primitive.start), direction) / denominator),
  );
  return materialDistance(candidate, {
    z: primitive.start.z + direction.z * parameter,
    x: primitive.start.x + direction.x * parameter,
  });
}

function materialPointToArcDistance(candidate, primitive) {
  const centerOffset = materialSubtract(candidate, primitive.center);
  const distanceFromCenter = Math.hypot(centerOffset.z, centerOffset.x);
  if (distanceFromCenter > 0) {
    const angle = Math.atan2(centerOffset.x, centerOffset.z);
    if (materialArcContainsAngle(primitive, angle)) return Math.abs(distanceFromCenter - primitive.radius);
  }
  if (primitive.type === "circle") return primitive.radius;
  return Math.min(
    materialDistance(candidate, primitive.start),
    materialDistance(candidate, primitive.end),
  );
}

function materialPointToPrimitiveDistance(candidate, primitive) {
  return primitive.type === "line"
    ? materialPointToLineDistance(candidate, primitive)
    : materialPointToArcDistance(candidate, primitive);
}

function materialMinimumLineArcDistance(linePrimitive, arcPrimitive) {
  let minimum = Math.min(
    materialPointToArcDistance(linePrimitive.start, arcPrimitive),
    materialPointToArcDistance(linePrimitive.end, arcPrimitive),
    ...(arcPrimitive.type === "circle" ? [] : [
      materialPointToLineDistance(arcPrimitive.start, linePrimitive),
      materialPointToLineDistance(arcPrimitive.end, linePrimitive),
    ]),
  );
  const direction = materialSubtract(linePrimitive.end, linePrimitive.start);
  const denominator = materialDot(direction, direction);
  const centerParameter = materialDot(
    materialSubtract(arcPrimitive.center, linePrimitive.start),
    direction,
  ) / denominator;
  if (centerParameter >= 0 && centerParameter <= 1) {
    const projection = {
      z: linePrimitive.start.z + direction.z * centerParameter,
      x: linePrimitive.start.x + direction.x * centerParameter,
    };
    const radial = materialSubtract(projection, arcPrimitive.center);
    const radialLength = Math.hypot(radial.z, radial.x);
    if (radialLength > 0) {
      for (const sign of [-1, 1]) {
        const candidate = {
          z: arcPrimitive.center.z + sign * radial.z * arcPrimitive.radius / radialLength,
          x: arcPrimitive.center.x + sign * radial.x * arcPrimitive.radius / radialLength,
        };
        if (materialArcContainsPoint(arcPrimitive, candidate)) {
          minimum = Math.min(minimum, materialPointToLineDistance(candidate, linePrimitive));
        }
      }
    }
  }
  return minimum;
}

function materialCircularEndpoints(primitive) {
  return primitive.type === "circle" ? [] : [primitive.start, primitive.end];
}

function materialMinimumCircularDistance(first, second) {
  let minimum = Number.POSITIVE_INFINITY;
  for (const candidate of materialCircularEndpoints(first)) {
    minimum = Math.min(minimum, materialPointToArcDistance(candidate, second));
  }
  for (const candidate of materialCircularEndpoints(second)) {
    minimum = Math.min(minimum, materialPointToArcDistance(candidate, first));
  }
  const centerOffset = materialSubtract(second.center, first.center);
  const centerDistance = Math.hypot(centerOffset.z, centerOffset.x);
  if (centerDistance === 0) {
    const firstCandidates = first.type === "circle" ? [] : [first.start, first.end];
    const overlappingAngle = first.type === "circle" || second.type === "circle"
      || firstCandidates.some((candidate) => materialArcContainsPoint(second, candidate))
      || materialCircularEndpoints(second).some((candidate) => materialArcContainsPoint(first, candidate));
    if (overlappingAngle) minimum = Math.min(minimum, Math.abs(first.radius - second.radius));
    return minimum;
  }
  const unit = {z: centerOffset.z / centerDistance, x: centerOffset.x / centerDistance};
  for (const firstSign of [-1, 1]) {
    const firstPoint = {
      z: first.center.z + firstSign * unit.z * first.radius,
      x: first.center.x + firstSign * unit.x * first.radius,
    };
    if (!materialArcContainsPoint(first, firstPoint)) continue;
    for (const secondSign of [-1, 1]) {
      const secondPoint = {
        z: second.center.z + secondSign * unit.z * second.radius,
        x: second.center.x + secondSign * unit.x * second.radius,
      };
      if (materialArcContainsPoint(second, secondPoint)) {
        minimum = Math.min(minimum, materialDistance(firstPoint, secondPoint));
      }
    }
  }
  return minimum;
}

function materialMinimumPrimitiveDistance(first, second) {
  if (first.type === "line" && second.type === "line") {
    return Math.min(
      materialPointToLineDistance(first.start, second),
      materialPointToLineDistance(first.end, second),
      materialPointToLineDistance(second.start, first),
      materialPointToLineDistance(second.end, first),
    );
  }
  if (first.type === "line") return materialMinimumLineArcDistance(first, second);
  if (second.type === "line") return materialMinimumLineArcDistance(second, first);
  return materialMinimumCircularDistance(first, second);
}

function materialAnalyticEndpoint(primitive, atStart) {
  if (primitive.type === "line") return atStart ? primitive.start : primitive.end;
  if (primitive.type !== "arc") return null;
  const angle = atStart ? primitive.startAngle : primitive.startAngle + primitive.sweep;
  return {
    z: primitive.center.z + Math.cos(angle) * primitive.radius,
    x: primitive.center.x + Math.sin(angle) * primitive.radius,
  };
}

function materialAdjacentJoints(primitives, firstIndex, secondIndex) {
  const joints = [];
  if (secondIndex === firstIndex + 1) {
    joints.push([
      materialAnalyticEndpoint(primitives[firstIndex], false),
      materialAnalyticEndpoint(primitives[secondIndex], true),
    ]);
  }
  if (firstIndex === 0 && secondIndex === primitives.length - 1) {
    joints.push([
      materialAnalyticEndpoint(primitives[firstIndex], true),
      materialAnalyticEndpoint(primitives[secondIndex], false),
    ]);
  }
  return joints;
}

function materialExpectedJointIntersection(candidate, joints) {
  return joints.some(([first, second]) => {
    const allowance = materialRoundingBound([
      candidate.z, candidate.x, first?.z, first?.x, second?.z, second?.x,
    ]);
    return materialFinitePoint(first) && materialFinitePoint(second)
      && materialDistance(candidate, first) <= allowance
      && materialDistance(candidate, second) <= allowance;
  });
}

function materialExpectedJointCoincides([first, second]) {
  if (!materialFinitePoint(first) || !materialFinitePoint(second)) return false;
  const allowance = materialRoundingBound([first.z, first.x, second.z, second.x]);
  return materialDistance(first, second) <= allowance;
}

function cloneClosedDxfMaterialBoundary(primitives) {
  if (primitives.length === 1 && primitives[0].type === "circle") {
    return [{
      ...primitives[0],
      center: {...primitives[0].center},
      source: {...primitives[0].source},
    }];
  }
  const boundary = primitives.map((primitive) => ({
    ...primitive,
    ...(primitive.start ? {start: {...primitive.start}} : {}),
    ...(primitive.end ? {end: {...primitive.end}} : {}),
    ...(primitive.center ? {center: {...primitive.center}} : {}),
    ...(primitive.source ? {source: {...primitive.source}} : {}),
  }));
  const connectors = new Map();
  const closeLineEndpoint = (primitive, key, candidate, closureLengthMm) => {
    primitive[key] = {...candidate};
    primitive.geometryUncertaintyMm = (Number(primitive.geometryUncertaintyMm) || 0) + closureLengthMm;
    primitive.source = {
      ...primitive.source,
      numericalJoinAdjustment: true,
      numericalJoinAdjustmentMm: closureLengthMm,
    };
  };
  for (let index = 0; index < boundary.length; index += 1) {
    const primitive = boundary[index];
    const next = boundary[(index + 1) % boundary.length];
    const end = materialAnalyticEndpoint(primitive, false);
    const nextStart = materialAnalyticEndpoint(next, true);
    if (!materialFinitePoint(end) || !materialFinitePoint(nextStart)) continue;
    const closureLengthMm = materialDistance(end, nextStart);
    if (closureLengthMm === 0) continue;
    if (primitive.type === "line") {
      closeLineEndpoint(primitive, "end", nextStart, closureLengthMm);
      continue;
    }
    if (next.type === "line") {
      closeLineEndpoint(next, "start", end, closureLengthMm);
      continue;
    }
    connectors.set(index, {
      id: `dxf-calculation-closure-${index}`,
      type: "line",
      start: {...end},
      end: {...nextStart},
      geometryUncertaintyMm: Math.max(
        Number(primitive.geometryUncertaintyMm) || 0,
        Number(next.geometryUncertaintyMm) || 0,
      ) + closureLengthMm,
      source: {
        format: "ascii-dxf",
        numericalClosure: true,
        precedingPrimitiveId: primitive.id ?? index,
        followingPrimitiveId: next.id ?? ((index + 1) % primitives.length),
      },
    });
  }
  return boundary.flatMap((primitive, index) => (
    connectors.has(index) ? [primitive, connectors.get(index)] : [primitive]
  ));
}

function qualifySimpleDxfMaterialBoundary(primitives) {
  const pairCount = primitives.length * (primitives.length - 1) / 2;
  if (!Number.isSafeInteger(pairCount) || pairCount > MAX_DXF_MATERIAL_TOPOLOGY_TESTS) {
    return {qualified: false, reason: "workload"};
  }
  for (let firstIndex = 0; firstIndex < primitives.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < primitives.length; secondIndex += 1) {
      const adjacent = secondIndex === firstIndex + 1
        || (firstIndex === 0 && secondIndex === primitives.length - 1);
      const first = primitives[firstIndex];
      const second = primitives[secondIndex];
      const joints = adjacent ? materialAdjacentJoints(primitives, firstIndex, secondIndex) : [];
      if (joints.some((joint) => !materialExpectedJointCoincides(joint))) {
        return {qualified: false, reason: "gap", firstIndex, secondIndex};
      }
      const intersections = materialPrimitiveIntersections(first, second);
      if (intersections.overlap
        || intersections.points.some((candidate) => !materialExpectedJointIntersection(candidate, joints))) {
        return {qualified: false, reason: "intersection", firstIndex, secondIndex};
      }
      if (!adjacent) {
        const minimumDistanceMm = intersections.points.length
          ? 0
          : materialMinimumPrimitiveDistance(first, second);
        const combinedUncertaintyMm = Math.max(0, Number(first.geometryUncertaintyMm) || 0)
          + Math.max(0, Number(second.geometryUncertaintyMm) || 0);
        const clearanceRoundoffMm = materialRoundingBound([
          minimumDistanceMm,
          first.start?.z, first.start?.x, first.end?.z, first.end?.x,
          first.center?.z, first.center?.x, first.radius,
          second.start?.z, second.start?.x, second.end?.z, second.end?.x,
          second.center?.z, second.center?.x, second.radius,
        ], 256);
        if (!Number.isFinite(minimumDistanceMm)
          || minimumDistanceMm <= combinedUncertaintyMm + clearanceRoundoffMm) {
          return {qualified: false, reason: "clearance", firstIndex, secondIndex};
        }
      }
    }
  }
  return {qualified: true, reason: null, boundary: cloneClosedDxfMaterialBoundary(primitives)};
}

function materialEndpointKey(candidate) {
  const z = Object.is(candidate.z, -0) ? 0 : candidate.z;
  const x = Object.is(candidate.x, -0) ? 0 : candidate.x;
  return `${z}\u0000${x}`;
}

function materialJoinRoundoff(firstEndpoint, secondEndpoint, records) {
  const values = [
    firstEndpoint.point.z, firstEndpoint.point.x,
    secondEndpoint.point.z, secondEndpoint.point.x,
  ];
  for (const endpoint of [firstEndpoint, secondEndpoint]) {
    if (!endpoint.sourceDerived) continue;
    const primitive = records[endpoint.edgeIndex]?.primitive;
    values.push(primitive?.center?.z, primitive?.center?.x, primitive?.radius);
  }
  const magnitude = Math.max(Number.MIN_VALUE, ...values.filter(Number.isFinite).map(Math.abs));
  const result = magnitude * Number.EPSILON * 32;
  return Number.isFinite(result) ? result : Number.POSITIVE_INFINITY;
}

function orientedMaterialPrimitive(primitive, reversed) {
  const source = {...primitive.source, ...(reversed ? {materialBoundaryReversed: true} : {})};
  if (!reversed) {
    return {
      ...primitive,
      ...(primitive.start ? {start: {...primitive.start}} : {}),
      ...(primitive.end ? {end: {...primitive.end}} : {}),
      ...(primitive.center ? {center: {...primitive.center}} : {}),
      source,
    };
  }
  if (primitive.type === "line") {
    return {...primitive, start: {...primitive.end}, end: {...primitive.start}, source};
  }
  return {
    ...primitive,
    start: {...primitive.end},
    end: {...primitive.start},
    center: {...primitive.center},
    startAngle: primitive.startAngle + primitive.sweep,
    sweep: -primitive.sweep,
    source,
  };
}

function deterministicDxfContourId(model, primitives) {
  const sourceIdentity = typeof model.source?.hash === "string" && model.source.hash
    ? model.source.hash
    : `unhashed-${model.source?.characterLength ?? 0}-${model.source?.lineCount ?? 0}`;
  const ids = primitives.map((primitive) => String(primitive.id)).sort();
  return `dxf-contour:${encodeURIComponent(sourceIdentity)}:${ids.map(encodeURIComponent).join(",")}`;
}

function orderedClosedComponent(component, records, nodeIncidence) {
  const sorted = [...component].sort((firstIndex, secondIndex) => (
    String(records[firstIndex].primitive.id).localeCompare(String(records[secondIndex].primitive.id))
  ));
  const firstIndex = sorted[0];
  const firstRecord = records[firstIndex];
  const reverseFirst = firstRecord.endKey.localeCompare(firstRecord.startKey) < 0;
  const startingNode = reverseFirst ? firstRecord.endKey : firstRecord.startKey;
  let currentNode = reverseFirst ? firstRecord.startKey : firstRecord.endKey;
  let currentIndex = firstIndex;
  let reversed = reverseFirst;
  const visited = new Set();
  const ordered = [];
  while (true) {
    if (visited.has(currentIndex)) return null;
    visited.add(currentIndex);
    ordered.push(orientedMaterialPrimitive(records[currentIndex].primitive, reversed));
    const nextEndpoints = (nodeIncidence.get(currentNode) || []).filter((entry) => entry.edgeIndex !== currentIndex);
    if (nextEndpoints.length !== 1) return null;
    const next = nextEndpoints[0];
    if (visited.has(next.edgeIndex)) {
      return next.edgeIndex === firstIndex
        && currentNode === startingNode
        && visited.size === component.size
        ? ordered
        : null;
    }
    currentIndex = next.edgeIndex;
    reversed = next.atStart === false;
    const nextRecord = records[currentIndex];
    currentNode = reversed ? nextRecord.startKey : nextRecord.endKey;
  }
}

function dxfMaterialLayerQualification(model, primitives) {
  const rawLayers = [...new Set(primitives.flatMap((primitive) => [
    primitive.layer,
    ...(primitive.source?.dxfType === "POLYLINE"
      ? (Array.isArray(primitive.source.classicPolylineVertexLayers)
        ? primitive.source.classicPolylineVertexLayers
        : [null])
      : []),
  ]))];
  const normalizedLayers = [...new Set(rawLayers.map((layer) => (
    typeof layer === "string" && layer ? normalizedUpper(layer) : null
  )))];
  if (normalizedLayers.length !== 1 || normalizedLayers[0] === null) {
    return {
      qualified: false,
      layers: rawLayers,
      reason: {
        code: "material-region-single-layer-required",
        message: "The selected DXF contour must be entirely on one explicitly named layer; cross-layer and unspecified-layer joins are not material authority.",
      },
    };
  }
  if (model.layers?.status !== "ready") {
    return {
      qualified: false,
      layers: rawLayers,
      reason: {
        code: "material-region-layer-table-required",
        message: "The DXF LAYER table is missing, duplicated, or unterminated, so the selected contour's visible layer state is not proven.",
      },
    };
  }
  const matching = model.layers.records.filter((record) => record.normalizedName === normalizedLayers[0]);
  if (matching.length !== 1 || matching[0].issues.length) {
    return {
      qualified: false,
      layers: rawLayers,
      reason: {
        code: "material-region-layer-record-ambiguous",
        message: "The selected contour's LAYER record is missing, duplicated, or malformed, so its visibility state is not authoritative.",
      },
    };
  }
  const layer = matching[0];
  if (layer.color < 0) {
    return {
      qualified: false,
      layers: rawLayers,
      reason: {
        code: "material-region-layer-off",
        message: `Layer '${layer.name}' is marked off by its negative color value and cannot define nominal material.`,
      },
    };
  }
  if (layer.flags & 1) {
    return {
      qualified: false,
      layers: rawLayers,
      reason: {
        code: "material-region-layer-frozen",
        message: `Layer '${layer.name}' is frozen and cannot define nominal material.`,
      },
    };
  }
  if (layer.flags !== 0) {
    return {
      qualified: false,
      layers: rawLayers,
      reason: {
        code: "material-region-layer-state-unsupported",
        message: `Layer '${layer.name}' uses unsupported state flags ${layer.flags}; its material visibility is not proven.`,
      },
    };
  }
  if (layer.plotValueSupplied && !layer.plot) {
    return {
      qualified: false,
      layers: rawLayers,
      reason: {
        code: "material-region-layer-not-plotted",
        message: `Layer '${layer.name}' is explicitly marked not plotted and cannot define nominal material.`,
      },
    };
  }
  return {
    qualified: true,
    layers: rawLayers,
    layer: {
      name: layer.name,
      flags: layer.flags,
      color: layer.color,
      plot: layer.plot,
      plotValueSupplied: layer.plotValueSupplied,
      sourceLine: layer.line,
    },
    reason: null,
  };
}

function dxfMaterialBoundaryReason(result) {
  if (result.reason === "workload") {
    return {
      code: "material-region-intersection-workload-exceeded",
      message: `The selected DXF contour exceeds the ${MAX_DXF_MATERIAL_TOPOLOGY_TESTS.toLocaleString()}-pair analytic topology limit.`,
    };
  }
  if (result.reason === "clearance") {
    return {
      code: "material-region-self-intersection-clearance",
      message: "Non-adjacent DXF contour edges are closer than their combined geometry-uncertainty envelope, so one simple boundary is not proven.",
    };
  }
  if (result.reason === "gap") {
    return {
      code: "material-region-boundary-gap",
      message: `DXF contour edges ${result.firstIndex + 1} and ${result.secondIndex + 1} do not share one endpoint within calculation roundoff.`,
    };
  }
  return {
    code: "material-region-self-intersection",
    message: `The selected DXF contour has an unexpected analytic intersection or overlap between edges ${result.firstIndex + 1} and ${result.secondIndex + 1}.`,
  };
}

function discoverDxfMaterialContours(model, primitives) {
  const records = [];
  const endpoints = [];
  const circles = [];
  const invalidPrimitiveIds = [];
  for (const primitive of primitives) {
    if (!["line", "arc", "circle"].includes(primitive.type) || !primitive.id) {
      invalidPrimitiveIds.push(primitive.id ?? null);
      continue;
    }
    if (primitive.type === "circle") {
      circles.push(primitive);
      continue;
    }
    if (!materialFinitePoint(primitive.start) || !materialFinitePoint(primitive.end)) {
      invalidPrimitiveIds.push(primitive.id);
      continue;
    }
    const record = {
      primitive,
      startKey: null,
      endKey: null,
    };
    const edgeIndex = records.length;
    records.push(record);
    endpoints.push({
      edgeIndex,
      atStart: true,
      point: primitive.start,
      sourceDerived: primitive.source?.dxfType === "ARC",
    }, {
      edgeIndex,
      atStart: false,
      point: primitive.end,
      sourceDerived: primitive.source?.dxfType === "ARC",
    });
  }

  const graphPairTests = endpoints.length * (endpoints.length - 1) / 2;
  const graphWorkloadBlocked = !Number.isSafeInteger(graphPairTests)
    || graphPairTests > MAX_DXF_MATERIAL_TOPOLOGY_TESTS;
  const nodeIncidence = new Map();
  if (!graphWorkloadBlocked) {
    const parents = endpoints.map((_, index) => index);
    const root = (index) => {
      let cursor = index;
      while (parents[cursor] !== cursor) cursor = parents[cursor];
      while (parents[index] !== index) {
        const next = parents[index];
        parents[index] = cursor;
        index = next;
      }
      return cursor;
    };
    const join = (first, second) => {
      const firstRoot = root(first);
      const secondRoot = root(second);
      if (firstRoot !== secondRoot) parents[secondRoot] = firstRoot;
    };
    for (let firstIndex = 0; firstIndex < endpoints.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < endpoints.length; secondIndex += 1) {
        const first = endpoints[firstIndex];
        const second = endpoints[secondIndex];
        const exact = materialEndpointKey(first.point) === materialEndpointKey(second.point);
        if (!exact && !first.sourceDerived && !second.sourceDerived) continue;
        const arithmeticAllowance = materialJoinRoundoff(first, second, records);
        if (exact || materialDistance(first.point, second.point) <= arithmeticAllowance) {
          join(firstIndex, secondIndex);
        }
      }
    }
    endpoints.forEach((endpoint, endpointIndex) => {
      const key = `node-${root(endpointIndex)}`;
      const record = records[endpoint.edgeIndex];
      if (endpoint.atStart) record.startKey = key;
      else record.endKey = key;
      if (!nodeIncidence.has(key)) nodeIncidence.set(key, []);
      nodeIncidence.get(key).push({edgeIndex: endpoint.edgeIndex, atStart: endpoint.atStart});
    });
  }

  const components = [];
  const visited = new Set();
  for (let seed = 0; !graphWorkloadBlocked && seed < records.length; seed += 1) {
    if (visited.has(seed)) continue;
    const component = new Set();
    const pending = [seed];
    while (pending.length) {
      const edgeIndex = pending.pop();
      if (visited.has(edgeIndex)) continue;
      visited.add(edgeIndex);
      component.add(edgeIndex);
      const record = records[edgeIndex];
      for (const key of [record.startKey, record.endKey]) {
        for (const incident of nodeIncidence.get(key) || []) {
          if (!visited.has(incident.edgeIndex)) pending.push(incident.edgeIndex);
        }
      }
    }
    components.push(component);
  }

  const closedComponents = [];
  let openComponentCount = graphWorkloadBlocked ? records.length : 0;
  let branchedComponentCount = 0;
  for (const component of components) {
    const componentNodes = new Set();
    for (const edgeIndex of component) {
      componentNodes.add(records[edgeIndex].startKey);
      componentNodes.add(records[edgeIndex].endKey);
    }
    const degrees = [...componentNodes].map((key) => (
      (nodeIncidence.get(key) || []).filter((entry) => component.has(entry.edgeIndex)).length
    ));
    if (degrees.some((degree) => degree > 2)) {
      branchedComponentCount += 1;
      continue;
    }
    if (degrees.some((degree) => degree !== 2)) {
      openComponentCount += 1;
      continue;
    }
    const ordered = orderedClosedComponent(component, records, nodeIncidence);
    if (ordered) closedComponents.push(ordered);
    else branchedComponentCount += 1;
  }
  const closedContourCount = closedComponents.length + circles.length;
  const contourLimitExceeded = closedContourCount > MAX_DXF_MATERIAL_CONTOURS;
  if (!contourLimitExceeded) {
    closedComponents.push(...circles.map((circle) => [orientedMaterialPrimitive(circle, false)]));
    closedComponents.sort((first, second) => (
      deterministicDxfContourId(model, first).localeCompare(deterministicDxfContourId(model, second))
    ));
  }

  const requiredPairTests = graphPairTests + closedComponents.reduce(
    (total, boundary) => total + boundary.length * (boundary.length - 1) / 2,
    0,
  );
  const workloadBlocked = !Number.isSafeInteger(requiredPairTests)
    || requiredPairTests > MAX_DXF_MATERIAL_TOPOLOGY_TESTS;
  const candidates = (contourLimitExceeded ? [] : closedComponents).map((orderedPrimitives) => {
    const contourId = deterministicDxfContourId(model, orderedPrimitives);
    const simple = workloadBlocked
      ? {qualified: false, reason: "workload"}
      : qualifySimpleDxfMaterialBoundary(orderedPrimitives);
    const layerQualification = dxfMaterialLayerQualification(model, orderedPrimitives);
    const primitiveIds = orderedPrimitives.map((primitive) => String(primitive.id));
    const sourceEntityIds = [...new Set(orderedPrimitives.map((primitive) => (
      primitive.source?.entityId ?? null
    )).filter(Boolean))].sort();
    const sourceEntityTypes = [...new Set(orderedPrimitives.map((primitive) => (
      primitive.source?.dxfType ?? null
    )).filter(Boolean))].sort();
    const topologyReason = simple.qualified ? null : dxfMaterialBoundaryReason(simple);
    return {
      contourId,
      primitiveIds,
      sourceEntityIds,
      sourceEntityTypes,
      layers: layerQualification.layers,
      layerState: layerQualification.layer ?? null,
      primitiveCount: orderedPrimitives.length,
      bounds: transformedBounds(orderedPrimitives),
      closed: true,
      eligible: simple.qualified && layerQualification.qualified,
      unqualifiedReason: topologyReason || layerQualification.reason,
      orderedPrimitives,
      simpleBoundary: simple.qualified ? simple.boundary : null,
      simpleTopologyQualified: simple.qualified,
    };
  });
  return {
    candidates,
    summary: {
      qualified: !workloadBlocked && !contourLimitExceeded,
      closedContours: closedContourCount,
      openComponents: openComponentCount,
      branchedComponents: branchedComponentCount,
      invalidPrimitives: invalidPrimitiveIds.length,
      maximumContours: MAX_DXF_MATERIAL_CONTOURS,
      contourLimitExceeded,
      requiredPairTests,
      maximumPairTests: MAX_DXF_MATERIAL_TOPOLOGY_TESTS,
      workloadBlocked,
    },
  };
}

function materialRepresentativePoint(boundary) {
  const primitive = boundary[0];
  if (primitive.type === "line") {
    return {
      z: (primitive.start.z + primitive.end.z) / 2,
      x: (primitive.start.x + primitive.end.x) / 2,
    };
  }
  const angle = primitive.type === "circle" ? 0 : primitive.startAngle + primitive.sweep / 2;
  return {
    z: primitive.center.z + Math.cos(angle) * primitive.radius,
    x: primitive.center.x + Math.sin(angle) * primitive.radius,
  };
}

function materialRayArcMembership(primitive, angle) {
  if (primitive.type === "circle") return {onArc: true, ambiguous: false};
  const magnitude = Math.abs(primitive.sweep);
  const delta = primitive.sweep >= 0
    ? materialNormalizeAngle(angle - primitive.startAngle)
    : materialNormalizeAngle(primitive.startAngle - angle);
  const angularRoundoff = materialRoundingBound(
    [angle, primitive.startAngle, primitive.sweep],
    MATERIAL_TRIG_ROUNDING_ULPS,
  );
  const dimensionalAllowance = (
    Math.max(0, Number(primitive.geometryUncertaintyMm) || 0)
    + materialRoundingBound([
      primitive.center.z, primitive.center.x, primitive.radius,
      primitive.start?.z, primitive.start?.x, primitive.end?.z, primitive.end?.x,
    ])
  ) / primitive.radius;
  const endpointAllowance = Math.max(angularRoundoff, dimensionalAllowance);
  const fromStart = Math.min(delta, TAU - delta);
  const fromEnd = Math.abs(delta - magnitude);
  if (fromStart <= endpointAllowance || fromEnd <= endpointAllowance) {
    return {onArc: delta <= magnitude + endpointAllowance, ambiguous: true};
  }
  return {onArc: delta < magnitude, ambiguous: false};
}

function materialRayParityAt(candidate, boundary) {
  let crossings = 0;
  let ambiguous = false;
  for (const primitive of boundary) {
    if (primitive.type === "line") {
      const endpointAllowance = materialRoundingBound([
        candidate.z, candidate.x,
        primitive.start.z, primitive.start.x, primitive.end.z, primitive.end.x,
      ]);
      if (Math.abs(candidate.z - primitive.start.z) <= endpointAllowance
        || Math.abs(candidate.z - primitive.end.z) <= endpointAllowance) {
        ambiguous = true;
      }
      const startAbove = primitive.start.z > candidate.z;
      const endAbove = primitive.end.z > candidate.z;
      if (startAbove === endAbove) continue;
      const parameter = (candidate.z - primitive.start.z) / (primitive.end.z - primitive.start.z);
      const crossingX = primitive.start.x + (primitive.end.x - primitive.start.x) * parameter;
      if (!Number.isFinite(crossingX)) return {inside: null, ambiguous: true};
      if (Math.abs(crossingX - candidate.x) <= endpointAllowance) ambiguous = true;
      else if (crossingX > candidate.x) crossings += 1;
      continue;
    }
    const ratio = (candidate.z - primitive.center.z) / primitive.radius;
    if (!Number.isFinite(ratio)) return {inside: null, ambiguous: true};
    const ratioAllowance = materialRoundingBound([
      candidate.z, primitive.center.z, primitive.radius,
    ]) / primitive.radius;
    if (ratio < -1 - ratioAllowance || ratio > 1 + ratioAllowance) continue;
    if (Math.abs(Math.abs(ratio) - 1) <= ratioAllowance) {
      ambiguous = true;
      continue;
    }
    const angle = Math.acos(Math.max(-1, Math.min(1, ratio)));
    for (const possibleAngle of [angle, -angle]) {
      const membership = materialRayArcMembership(primitive, possibleAngle);
      if (!membership.onArc) continue;
      if (membership.ambiguous) {
        ambiguous = true;
        continue;
      }
      const crossingX = primitive.center.x + Math.sin(possibleAngle) * primitive.radius;
      const crossingAllowance = Math.max(
        Math.max(0, Number(primitive.geometryUncertaintyMm) || 0),
        materialRoundingBound([crossingX, candidate.x, primitive.center.x, primitive.radius]),
      );
      if (Math.abs(crossingX - candidate.x) <= crossingAllowance) ambiguous = true;
      else if (crossingX > candidate.x) crossings += 1;
    }
  }
  return {inside: crossings % 2 === 1, ambiguous};
}

function classifyPointAgainstMaterialBoundary(candidate, boundary) {
  const boundaryUncertaintyMm = Math.max(
    0,
    ...boundary.map((primitive) => Number(primitive.geometryUncertaintyMm) || 0),
  );
  const nearestDistanceMm = Math.min(
    ...boundary.map((primitive) => materialPointToPrimitiveDistance(candidate, primitive)),
  );
  const localRoundoffMm = materialRoundingBound([
    candidate.z, candidate.x, nearestDistanceMm,
    ...boundary.flatMap((primitive) => [
      primitive.start?.z, primitive.start?.x, primitive.end?.z, primitive.end?.x,
      primitive.center?.z, primitive.center?.x, primitive.radius,
    ]),
  ]);
  if (!Number.isFinite(nearestDistanceMm)
    || nearestDistanceMm <= boundaryUncertaintyMm + localRoundoffMm) return "ambiguous";
  const shiftMm = Math.max(localRoundoffMm * 8, Number.MIN_VALUE);
  if (!Number.isFinite(shiftMm) || shiftMm >= nearestDistanceMm / 2) return "ambiguous";
  const classifications = [-shiftMm, 0, shiftMm].map((shift) => (
    materialRayParityAt({z: candidate.z + shift, x: candidate.x}, boundary)
  ));
  if (classifications.some((classification) => classification.ambiguous || classification.inside === null)) {
    return "ambiguous";
  }
  const first = classifications[0].inside;
  return classifications.every((classification) => classification.inside === first)
    ? (first ? "inside" : "outside")
    : "ambiguous";
}

function selectedContourAmbiguity(selected, candidates) {
  const others = candidates.filter((candidate) => (
    candidate !== selected && candidate.simpleTopologyQualified && candidate.simpleBoundary?.length
  ));
  const requiredPairTests = others.reduce(
    (total, candidate) => total + selected.simpleBoundary.length * candidate.simpleBoundary.length,
    0,
  );
  if (!Number.isSafeInteger(requiredPairTests)
    || requiredPairTests > MAX_DXF_MATERIAL_TOPOLOGY_TESTS) {
    return {
      code: "material-region-contour-relationship-workload-exceeded",
      message: `The selected contour's relationship to other closed DXF contours exceeds the ${MAX_DXF_MATERIAL_TOPOLOGY_TESTS.toLocaleString()}-pair topology limit.`,
    };
  }
  for (const other of others) {
    let minimumDistanceMm = Number.POSITIVE_INFINITY;
    for (const first of selected.simpleBoundary) {
      for (const second of other.simpleBoundary) {
        const intersections = materialPrimitiveIntersections(first, second);
        if (intersections.overlap || intersections.points.length) {
          return {
            code: "material-region-other-contour-intersection",
            message: "The explicitly selected contour intersects or touches another closed contour, so inside material versus a hole is ambiguous.",
          };
        }
        minimumDistanceMm = Math.min(
          minimumDistanceMm,
          materialMinimumPrimitiveDistance(first, second),
        );
      }
    }
    const combinedUncertaintyMm = Math.max(
      ...selected.simpleBoundary.map((primitive) => Number(primitive.geometryUncertaintyMm) || 0),
    ) + Math.max(
      ...other.simpleBoundary.map((primitive) => Number(primitive.geometryUncertaintyMm) || 0),
    );
    const clearanceRoundoffMm = materialRoundingBound([
      minimumDistanceMm,
      selected.bounds?.minZ, selected.bounds?.maxZ, selected.bounds?.minX, selected.bounds?.maxX,
      other.bounds?.minZ, other.bounds?.maxZ, other.bounds?.minX, other.bounds?.maxX,
    ], 256);
    if (!Number.isFinite(minimumDistanceMm)
      || minimumDistanceMm <= combinedUncertaintyMm + clearanceRoundoffMm) {
      return {
        code: "material-region-other-contour-clearance",
        message: "Another closed DXF contour is inside the combined geometry-uncertainty clearance of the selection, so material topology is ambiguous.",
      };
    }
    const otherAgainstSelected = classifyPointAgainstMaterialBoundary(
      materialRepresentativePoint(other.simpleBoundary),
      selected.simpleBoundary,
    );
    const selectedAgainstOther = classifyPointAgainstMaterialBoundary(
      materialRepresentativePoint(selected.simpleBoundary),
      other.simpleBoundary,
    );
    if (otherAgainstSelected === "ambiguous" || selectedAgainstOther === "ambiguous") {
      return {
        code: "material-region-contour-relationship-ambiguous",
        message: "The selected DXF contour's relationship to another closed contour cannot be bounded without guessing hole/material topology.",
      };
    }
    if (otherAgainstSelected === "inside" || selectedAgainstOther === "inside") {
      return {
        code: "material-region-nested-contour-ambiguous",
        message: "The selected DXF contour is nested with another closed contour; this bounded workflow cannot infer which loop is a hole or nominal material.",
      };
    }
  }
  return null;
}

function unqualifiedDxfMaterialRegion(code, message, {selection = null, provenance = null} = {}) {
  return {
    schemaVersion: 1,
    qualification: DXF_MATERIAL_REGION_QUALIFICATION,
    qualified: false,
    coordinateSystem: "lathe-xz",
    sourceContourId: selection?.contourId ?? null,
    profileSide: selection?.materialSide === "inside" ? "explicit-inside" : null,
    materialSide: selection?.materialSide ?? null,
    boundary: null,
    boundaryClosed: false,
    axisEndpoints: [],
    geometryUncertaintyMm: null,
    provenance,
    unqualifiedReason: {code, message},
  };
}

function buildDxfMaterialRegion(
  model,
  primitives,
  transform,
  mappedAuthorized,
  canonicalMillimeters,
  materialSelection,
) {
  const discovery = discoverDxfMaterialContours(model, primitives);
  const publicContours = discovery.candidates.map((candidate) => ({
    contourId: candidate.contourId,
    primitiveIds: [...candidate.primitiveIds],
    sourceEntityIds: [...candidate.sourceEntityIds],
    sourceEntityTypes: [...candidate.sourceEntityTypes],
    layers: [...candidate.layers],
    layerState: candidate.layerState ? {...candidate.layerState} : null,
    primitiveCount: candidate.primitiveCount,
    bounds: candidate.bounds ? {...candidate.bounds} : null,
    closed: true,
    eligible: candidate.eligible,
    unqualifiedReason: candidate.unqualifiedReason ? {...candidate.unqualifiedReason} : null,
    layerVisibilityAuthority: "explicit-visible-layer-record-required-for-material-only",
  }));
  const sourceHash = typeof model.source?.hash === "string" && model.source.hash
    ? model.source.hash
    : null;
  const selected = discovery.candidates.find((candidate) => (
    candidate.contourId === materialSelection?.contourId
  ));
  const provenance = selected ? {
    format: "ascii-dxf",
    sourceName: model.source?.name ?? null,
    sourceHash,
    contourId: selected.contourId,
    primitiveIds: [...selected.primitiveIds],
    sourceEntityIds: [...selected.sourceEntityIds],
    sourceEntityTypes: [...selected.sourceEntityTypes],
    layers: [...selected.layers],
    layerState: selected.layerState ? {...selected.layerState} : null,
    transform: transform ? {
      mapping: transform.mapping,
      origin: {...transform.origin},
      offset: {...transform.offset},
      zDirection: transform.zDirection,
      radialDirection: transform.radialDirection,
    } : null,
    selectionAuthority: "explicit-closed-contour-and-inside-material-confirmation",
    layerVisibilityAuthority: "resolved-visible-modelspace-layer-record",
  } : null;
  let materialRegion;
  if (!mappedAuthorized) {
    materialRegion = unqualifiedDxfMaterialRegion(
      "material-region-mapping-unauthorized",
      "The mapped DXF is not authorized, so it cannot define a nominal-material region.",
      {selection: materialSelection, provenance},
    );
  } else if (!canonicalMillimeters) {
    materialRegion = unqualifiedDxfMaterialRegion(
      "material-region-canonical-millimeters-required",
      "Signed DXF material entry requires mapped boundary coordinates in canonical millimeters.",
      {selection: materialSelection, provenance},
    );
  } else if (discovery.summary.contourLimitExceeded) {
    materialRegion = unqualifiedDxfMaterialRegion(
      "material-region-contour-limit-exceeded",
      `DXF contains ${discovery.summary.closedContours.toLocaleString()} closed contours; signed material selection supports at most ${MAX_DXF_MATERIAL_CONTOURS.toLocaleString()}. Export a profile-only DXF. The ordinary overlay remains available.`,
      {selection: materialSelection},
    );
  } else if (!materialSelection) {
    materialRegion = unqualifiedDxfMaterialRegion(
      "material-region-explicit-selection-required",
      "Select one closed DXF contour and explicitly confirm that its inside is nominal material.",
    );
  } else if (typeof materialSelection.contourId !== "string"
    || materialSelection.materialSide !== "inside") {
    materialRegion = unqualifiedDxfMaterialRegion(
      "material-region-inside-confirmation-required",
      "DXF material entry requires one current contour ID and an explicit 'inside is nominal material' confirmation.",
      {selection: materialSelection},
    );
  } else if (!selected) {
    materialRegion = unqualifiedDxfMaterialRegion(
      "material-region-selection-invalid",
      "The selected DXF contour does not exist in the current source and mapping; select it again.",
      {selection: materialSelection},
    );
  } else if (!sourceHash) {
    materialRegion = unqualifiedDxfMaterialRegion(
      "material-region-source-hash-required",
      "Signed DXF material entry requires the retained exact source SHA-256 before a contour selection can be authoritative.",
      {selection: materialSelection, provenance},
    );
  } else if (!selected.eligible) {
    materialRegion = unqualifiedDxfMaterialRegion(
      selected.unqualifiedReason.code,
      selected.unqualifiedReason.message,
      {selection: materialSelection, provenance},
    );
  } else {
    const ambiguity = selectedContourAmbiguity(selected, discovery.candidates);
    if (ambiguity) {
      materialRegion = unqualifiedDxfMaterialRegion(
        ambiguity.code,
        ambiguity.message,
        {selection: materialSelection, provenance},
      );
    } else {
      const boundary = selected.simpleBoundary;
      const geometryUncertaintyMm = Math.max(
        0,
        ...boundary.map((primitive) => Number(primitive.geometryUncertaintyMm) || 0),
      );
      materialRegion = {
        schemaVersion: 1,
        qualification: DXF_MATERIAL_REGION_QUALIFICATION,
        qualified: true,
        coordinateSystem: "lathe-xz",
        sourceContourId: selected.contourId,
        profileSide: "explicit-inside",
        materialSide: "inside",
        boundary,
        boundaryClosed: true,
        axisEndpoints: [],
        geometryUncertaintyMm,
        provenance,
        unqualifiedReason: null,
      };
    }
  }
  return {materialContours: publicContours, materialTopology: discovery.summary, materialRegion};
}

function failedTransform(model, diagnostics, sourceUnit = null, targetUnit = null, transform = null) {
  return {
    schemaVersion: 1,
    format: "dxf-profile",
    coordinateSystem: "lathe-xz",
    source: model.source,
    sourceModel: model,
    units: {
      source: sourceUnit ? {...sourceUnit} : null,
      target: targetUnit ? {...targetUnit} : null,
      scale: null,
    },
    transform,
    primitives: [],
    geometry: [],
    materialContours: [],
    materialTopology: null,
    materialRegion: unqualifiedDxfMaterialRegion(
      "material-region-mapping-unauthorized",
      "The mapped DXF is not authorized, so it cannot define a nominal-material region.",
    ),
    bounds: null,
    diagnostics,
    authorized: false,
  };
}

function transformRoundoffUncertaintyMm(
  sourcePrimitive,
  mappedPrimitive,
  {origin, offset, scale, targetMillimetersPerUnit},
) {
  const sourcePoints = sourcePrimitive.type === "line"
    ? [sourcePrimitive.start, sourcePrimitive.end]
    : [sourcePrimitive.center, ...(sourcePrimitive.type === "arc"
      ? [sourcePrimitive.start, sourcePrimitive.end]
      : [])];
  const sourceValuesInTargetUnits = sourcePoints.flatMap((candidate) => [
    Math.abs(candidate.x * scale), Math.abs(candidate.y * scale),
  ]);
  sourceValuesInTargetUnits.push(
    Math.abs(origin.x * scale),
    Math.abs(origin.y * scale),
    Math.abs(offset.z),
    Math.abs(offset.x),
  );
  if (sourcePrimitive.radius !== undefined) {
    sourceValuesInTargetUnits.push(Math.abs(sourcePrimitive.radius * scale));
  }
  const targetMagnitude = primitiveCoordinateMagnitude(mappedPrimitive, "z", "x");
  const magnitude = Math.max(1, targetMagnitude, ...sourceValuesInTargetUnits);
  const targetUnitUncertainty = Number.EPSILON * TRANSFORM_ROUNDING_ULPS * magnitude;
  const physicalUncertainty = targetUnitUncertainty * targetMillimetersPerUnit;
  return Number.isFinite(physicalUncertainty) ? physicalUncertainty : Number.POSITIVE_INFINITY;
}

/**
 * Explicitly normalize parsed native DXF coordinates into the lathe plane.
 * Defaults map DXF X -> lathe Z and DXF Y -> radial X without inferring an
 * origin from the drawing. All output values use targetUnits (millimeters by
 * default). Unknown source units block output unless sourceUnits is supplied.
 */
export function toLatheGeometry(model, {
  sourceUnits = null,
  targetUnits = "millimeter",
  overrideDeclaredUnits = false,
  origin = {x: 0, y: 0},
  offset = {z: 0, x: 0},
  zDirection = 1,
  radialDirection = 1,
  materialSelection = null,
} = {}) {
  if (!model || model.format !== "ascii-dxf" || !Array.isArray(model.primitives)) {
    throw new TypeError("toLatheGeometry requires a parsed DXF model.");
  }

  const diagnostics = model.diagnostics.map((diagnostic) => ({...diagnostic}));
  const explicitSource = sourceUnits === null ? null : resolveUnit(sourceUnits);
  const declaredSource = model.units?.status === "declared" ? resolveUnit(model.units.code) : null;
  const targetUnit = resolveUnit(targetUnits);
  let sourceUnit = declaredSource;

  if (sourceUnits !== null && (!explicitSource || explicitSource.code === 0)) {
    diagnostics.push(makeDiagnostic("error", "transform-source-units-invalid", `Explicit source units '${sourceUnits}' are not supported physical units.`));
    return failedTransform(model, diagnostics, null, targetUnit);
  }
  if (!targetUnit || targetUnit.code === 0) {
    diagnostics.push(makeDiagnostic("error", "transform-target-units-invalid", `Target units '${targetUnits}' are not supported physical units.`));
    return failedTransform(model, diagnostics, explicitSource ?? declaredSource, null);
  }
  if (declaredSource && explicitSource && declaredSource.code !== explicitSource.code && !overrideDeclaredUnits) {
    diagnostics.push(makeDiagnostic("error", "transform-units-conflict", `DXF declares ${declaredSource.name}; set overrideDeclaredUnits only after explicitly confirming a different source unit.`));
    return failedTransform(model, diagnostics, declaredSource, targetUnit);
  }
  if (explicitSource) sourceUnit = explicitSource;
  if (!sourceUnit) {
    diagnostics.push(makeDiagnostic("error", "transform-source-units-required", "Source units are unresolved; provide sourceUnits explicitly."));
    return failedTransform(model, diagnostics, null, targetUnit);
  }

  const sourceNumericalBudget = MAX_NUMERICAL_ERROR_MM / sourceUnit.millimetersPerUnit;
  if (model.primitives.some((primitive) => !sourceArcAnglesMeetNumericalBudget(primitive, sourceNumericalBudget))) {
    diagnostics.push(makeDiagnostic("error", "source-angular-resolution", "The DXF ARC angle magnitude cannot retain the required 0.00005 in endpoint budget at its radius; export ordinary 0-360 degree angles."));
    return failedTransform(model, diagnostics, sourceUnit, targetUnit);
  }
  if (model.primitives.some((primitive) => (
    primitive.source?.bulge
    && (!Number.isFinite(primitive.geometryUncertaintyNative)
      || primitive.geometryUncertaintyNative > sourceNumericalBudget)
  ))) {
    diagnostics.push(makeDiagnostic("error", "source-bulge-resolution", "A DXF bulge arc cannot retain the required 0.00005 in whole-curve numerical budget; export a better-conditioned arc near its intended origin."));
    return failedTransform(model, diagnostics, sourceUnit, targetUnit);
  }
  if (model.primitives.some((primitive) => (
    !Number.isFinite(primitive.geometryUncertaintyNative)
    || primitive.geometryUncertaintyNative > sourceNumericalBudget
  ))) {
    diagnostics.push(makeDiagnostic("error", "source-coordinate-resolution", "The DXF source or derived geometry cannot retain the required 0.00005 in numerical budget; export a numerically conditioned profile near its intended origin."));
    return failedTransform(model, diagnostics, sourceUnit, targetUnit);
  }
  if (!nativeCoordinatesMeetNumericalBudget(model.primitives, sourceNumericalBudget)) {
    diagnostics.push(makeDiagnostic("error", "source-coordinate-resolution", "The DXF coordinates or derived arc extrema cannot retain the required 0.00005 in numerical budget; export a numerically conditioned profile near its intended origin."));
    return failedTransform(model, diagnostics, sourceUnit, targetUnit);
  }

  const values = [origin?.x, origin?.y, offset?.z, offset?.x];
  if (!values.every(Number.isFinite) || ![zDirection, radialDirection].every((value) => value === 1 || value === -1)) {
    diagnostics.push(makeDiagnostic("error", "transform-invalid", "Origin/offset values must be finite and axis directions must be 1 or -1."));
    return failedTransform(model, diagnostics, sourceUnit, targetUnit);
  }

  const scale = sourceUnit.millimetersPerUnit / targetUnit.millimetersPerUnit;
  const transform = {
    mapping: "dxf-x-to-lathe-z/dxf-y-to-radial-x",
    origin: {x: origin.x, y: origin.y},
    offset: {z: offset.z, x: offset.x},
    zDirection,
    radialDirection,
  };
  const transformPoint = (candidate) => ({
    z: (candidate.x - origin.x) * scale * zDirection + offset.z,
    x: (candidate.y - origin.y) * scale * radialDirection + offset.x,
  });
  const determinant = zDirection * radialDirection;
  const primitives = model.primitives.map((primitive) => {
    if (primitive.type === "line") {
      return {...primitive, start: transformPoint(primitive.start), end: transformPoint(primitive.end)};
    }
    const center = transformPoint(primitive.center);
    const radius = primitive.radius * scale;
    if (primitive.type === "circle") return {...primitive, center, radius};
    const start = transformPoint(primitive.start);
    const end = transformPoint(primitive.end);
    return {
      ...primitive,
      center,
      radius,
      start,
      end,
      startAngle: Math.atan2(start.x - center.x, start.z - center.z),
      sweep: primitive.sweep * determinant,
    };
  }).map((primitive, index) => {
    const sourceGeometryUncertaintyMm = model.primitives[index].geometryUncertaintyNative
      * sourceUnit.millimetersPerUnit;
    const mappedRoundoffUncertaintyMm = transformRoundoffUncertaintyMm(
      model.primitives[index],
      primitive,
      {
        origin,
        offset,
        scale,
        targetMillimetersPerUnit: targetUnit.millimetersPerUnit,
      },
    );
    const endpointUncertaintyMm = primitive.type === "arc"
      ? analyticArcEndpointUncertainty(primitive, "z", "x") * targetUnit.millimetersPerUnit
      : 0;
    return {
      ...primitive,
      geometryUncertaintyMm: sourceGeometryUncertaintyMm
        + mappedRoundoffUncertaintyMm
        + endpointUncertaintyMm,
      ...(primitive.type === "arc" ? {endpointUncertaintyMm} : {}),
    };
  });
  if (!primitives.every(lathePrimitiveIsFinite)) {
    diagnostics.push(makeDiagnostic("error", "transform-non-finite-geometry", "The selected units or transform produce geometry outside the finite numeric range."));
    return failedTransform(model, diagnostics, sourceUnit, targetUnit, transform);
  }
  const targetNumericalBudget = MAX_NUMERICAL_ERROR_MM / targetUnit.millimetersPerUnit;
  if (!latheCoordinatesMeetNumericalBudget(primitives, targetNumericalBudget)) {
    diagnostics.push(makeDiagnostic("error", "transform-coordinate-resolution", "The transformed coordinates or derived arc extrema cannot retain the required 0.00005 in numerical budget; choose a numerically conditioned scale and origin."));
    return failedTransform(model, diagnostics, sourceUnit, targetUnit, transform);
  }
  if (primitives.some((primitive) => (
    !Number.isFinite(primitive.geometryUncertaintyMm)
    || primitive.geometryUncertaintyMm > MAX_NUMERICAL_ERROR_MM
  ))) {
    diagnostics.push(makeDiagnostic("error", "transform-precision-loss", "The selected transform cannot preserve the geometry within the required whole-curve numerical budget."));
    return failedTransform(model, diagnostics, sourceUnit, targetUnit, transform);
  }
  if (primitives.some((primitive) => (
    primitive.type === "arc" && (
      !analyticArcEndpointsAreConsistent(primitive, "z", "x", targetNumericalBudget)
      || !Number.isFinite(primitive.endpointUncertaintyMm)
      || primitive.endpointUncertaintyMm > MAX_NUMERICAL_ERROR_MM
    )
  ))) {
    diagnostics.push(makeDiagnostic("error", "transform-precision-loss", "The selected transform cannot preserve the analytic arc within the required whole-curve numerical budget."));
    return failedTransform(model, diagnostics, sourceUnit, targetUnit, transform);
  }

  const bounds = transformedBounds(primitives);
  if (bounds && !Object.values(bounds).every(Number.isFinite)) {
    diagnostics.push(makeDiagnostic("error", "transform-non-finite-bounds", "The transformed geometry spans outside the finite numeric range."));
    return failedTransform(model, diagnostics, sourceUnit, targetUnit, transform);
  }

  const explicitResolvedUnknownUnits = Boolean(explicitSource && !declaredSource);
  if (explicitResolvedUnknownUnits) {
    for (const diagnostic of diagnostics) {
      if (UNIT_DIAGNOSTIC_CODES.has(diagnostic.code)) diagnostic.resolved = true;
    }
    diagnostics.push(makeDiagnostic("warning", "units-explicitly-supplied", `Source units were explicitly set to ${sourceUnit.name}.`));
  }
  if (declaredSource && explicitSource && declaredSource.code !== explicitSource.code && overrideDeclaredUnits) {
    diagnostics.push(makeDiagnostic("warning", "units-explicitly-overridden", `Declared ${declaredSource.name} units were explicitly overridden with ${sourceUnit.name}.`));
  }
  const authorized = !diagnostics.some((diagnostic) => diagnostic.severity === "error" && !diagnostic.resolved);
  const material = buildDxfMaterialRegion(
    model,
    primitives,
    transform,
    authorized,
    targetUnit.millimetersPerUnit === 1,
    materialSelection,
  );
  return {
    schemaVersion: 1,
    format: "dxf-profile",
    coordinateSystem: "lathe-xz",
    source: model.source,
    sourceModel: model,
    units: {
      source: {...sourceUnit},
      target: {...targetUnit},
      scale,
    },
    transform,
    primitives,
    geometry: primitives,
    bounds,
    ...material,
    diagnostics,
    authorized,
  };
}

export function dxfUnitDefinition(value) {
  const unit = resolveUnit(value);
  return unit ? {...unit} : null;
}
