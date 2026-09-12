import {commandedSpindleGear} from "./machine-semantics.mjs";

export const GCODE_LANGUAGE_LIMITS = Object.freeze({
  maxSourceCharacters: 8 * 1024 * 1024,
  maxTokens: 500_000,
});

const AXIS_AND_GEOMETRY_ADDRESSES = new Set([
  "A", "B", "C", "I", "J", "K", "R", "U", "V", "W", "X", "Y", "Z",
]);
const SEPARATOR_TYPES = new Set(["whitespace", "newline", "unparsed"]);
const PUNCTUATION = new Set([
  "%", "$", "/", "#", "[", "]", "=", "+", "-", "*", ",", ":", ".", "(", ")",
]);

const ALL_PATH_CONTEXTS = Object.freeze([
  "lathe:generic",
  "lathe:haas-lathe-ngc",
  "mill:fanuc-style",
]);
const LATHE_CONTEXTS = Object.freeze(["lathe:generic", "lathe:haas-lathe-ngc"]);
const HAAS_LATHE_CONTEXT = Object.freeze(["lathe:haas-lathe-ngc"]);
const MILL_CONTEXT = Object.freeze(["mill:fanuc-style"]);

function entry(title, description, scope, contexts, variants = {}) {
  const contextualVariants = Object.fromEntries(Object.entries(variants).map(([key, value]) => [
    key,
    Object.freeze({...value}),
  ]));
  return Object.freeze({
    title,
    description,
    scope,
    contexts: Object.freeze([...contexts]),
    variants: Object.freeze(contextualVariants),
  });
}

// This table intentionally describes only behavior implemented by the local engine.
// A code being common in the industry is not enough to put it here.
const CODE_HELP = new Map([
  ["G0", entry("Rapid positioning", "Moves along the modeled rapid command centerline.", "Modeled for lathe and 3-axis mill paths; machine-specific rapid interpolation still follows the configured path contract.", ALL_PATH_CONTEXTS)],
  ["G1", entry("Linear interpolation", "Moves in a straight line at the active feed state.", "Modeled for lathe and 3-axis mill command centerlines.", ALL_PATH_CONTEXTS)],
  ["G2", entry("Clockwise circular interpolation", "Creates a clockwise arc in the active supported plane.", "Modeled only when the active plane, start point, center/radius data, and numerical bounds are supported.", ALL_PATH_CONTEXTS)],
  ["G3", entry("Counterclockwise circular interpolation", "Creates a counterclockwise arc in the active supported plane.", "Modeled only when the active plane, start point, center/radius data, and numerical bounds are supported.", ALL_PATH_CONTEXTS)],
  ["G4", entry("Dwell", "Pauses for the programmed dwell value.", "Modeled for the bounded lathe and mill timing contracts; address interpretation remains controller-context dependent.", ALL_PATH_CONTEXTS)],
  ["G17", entry("XY plane selection", "Selects the XY interpolation plane.", "Motion is modeled in this plane only for the bounded mill path and supported Haas G112 face motion.", Object.freeze(["lathe:haas-lathe-ngc", "mill:fanuc-style"]))],
  ["G18", entry("XZ plane selection", "Selects the XZ interpolation plane.", "Motion is modeled in this plane for ordinary lathe turning; the mill parser tracks but does not model G18 path geometry.", LATHE_CONTEXTS)],
  ["G19", entry("YZ plane selection", "Selects the YZ interpolation plane.", "The local parsers recognize the modal selection only to keep unsupported geometry fail-closed; no current path engine models G19 motion.", Object.freeze([]))],
  ["G20", entry("Inch units", "Selects inch program units.", "Modeled at the parser boundary and converted to canonical millimeters internally.", ALL_PATH_CONTEXTS)],
  ["G21", entry("Metric units", "Selects millimeter program units.", "Modeled at the parser boundary; internal geometry remains canonical millimeters.", ALL_PATH_CONTEXTS)],
  ["G28", entry("Reference return", "Uses the configured estimated machine-reference behavior for the supported lathe form.", "Only the bounded lathe G28 form is modeled; it does not invent an unconfigured machine-to-work transform.", LATHE_CONTEXTS)],
  ["G32", entry("Thread cutting command", "Retains the commanded nominal threading reference-point line and programmed lead under the explicit Haas lathe contract.", "Modeled only for the configured Haas lathe NGC subset. Encoder synchronization, phase, physical helix, pitch accuracy, and machine execution are not verified; generic or Fanuc behavior is not inferred.", HAAS_LATHE_CONTEXT)],
  ["G40", entry("Cutter compensation cancel", "Cancels cutter compensation state.", "Recognized by the lathe and mill engines; physical compensation effects remain limited to explicitly modeled contracts.", ALL_PATH_CONTEXTS)],
  ["G41", entry("Cutter compensation left", "Enables the locally modeled left compensation state when its required setup is confirmed.", "Motion is modeled only by the explicit bounded Haas lathe nose-compensation contract; otherwise it remains unsupported.", HAAS_LATHE_CONTEXT)],
  ["G42", entry("Cutter compensation right", "Enables the locally modeled right compensation state when its required setup is confirmed.", "Motion is modeled only by the explicit bounded Haas lathe nose-compensation contract; otherwise it remains unsupported.", HAAS_LATHE_CONTEXT)],
  ["G43", entry("Tool length compensation on", "Records commanded positive tool-length compensation with an H register.", "Recognized only by the bounded 3-axis mill contract; the physical machine-axis/tool-tip transform is not calculated.", MILL_CONTEXT)],
  ["G49", entry("Tool length compensation cancel", "Records cancellation of tool-length compensation.", "Recognized by the bounded 3-axis mill contract.", MILL_CONTEXT)],
  ["G50", entry("Spindle speed limit", "Applies the supported S-only spindle-speed limit form.", "Only the bounded lathe S-only form is modeled; G50 with axis words is an unresolved coordinate shift and blocks execution.", LATHE_CONTEXTS)],
  ["G54", entry("Work coordinate system 1", "Records the commanded G54 work-frame selection.", "Recognized only by the bounded 3-axis mill contract; no physical work-offset transform is applied or proved.", MILL_CONTEXT)],
  ["G70", entry("Finishing cycle", "Finishes a referenced P-Q contour using retained source geometry.", "Modeled for the bounded lathe contour-cycle contract.", LATHE_CONTEXTS)],
  ["G71", entry("Longitudinal roughing cycle", "Expands a supported longitudinal roughing cycle over a referenced contour.", "Modeled for bounded common Fanuc two-block and Haas-style single-block lathe forms.", LATHE_CONTEXTS)],
  ["G72", entry("Facing roughing cycle", "Expands a supported facing roughing cycle over a referenced contour.", "Modeled for bounded common Fanuc two-block and Haas-style single-block lathe forms.", LATHE_CONTEXTS)],
  ["G76", entry("Threading cycle", "Expands the configured nominal straight radial-infeed threading schedule into commanded reference-point passes.", "Modeled only by the explicit bounded Haas lathe NGC G76 contract with declared controller settings. Encoder phase, physical helix, pitch/fit, runout dynamics, and machine execution are not verified; other G76 dialects are not inferred.", HAAS_LATHE_CONTEXT)],
  ["G80", entry("Canned-cycle cancel", "Cancels the tracked canned-cycle state.", "Recognized by the Haas lathe and bounded mill contracts; it does not add support for an otherwise unsupported cycle.", Object.freeze(["lathe:haas-lathe-ngc", "mill:fanuc-style"]))],
  ["G90", entry("Absolute positioning", "Interprets supported coordinates as absolute positions.", "Modeled for generic/Fanuc-style lathe and bounded mill contexts.", Object.freeze(["lathe:generic", "mill:fanuc-style"]), {
    "lathe:haas-lathe-ngc": {title: "Unsupported Haas Group 01 motion", description: "The configured Haas lathe model does not interpret G90 as absolute positioning; it classifies G90 as an unsupported Group 01 motion.", scope: "Execution is blocked until a modeled Group 01 motion replaces it. Haas lathe absolute positioning uses G390."},
  })],
  ["G91", entry("Incremental positioning", "Interprets supported coordinates as incremental moves.", "Modeled for generic/Fanuc-style lathe and bounded mill contexts.", Object.freeze(["lathe:generic", "mill:fanuc-style"]), {
    "lathe:haas-lathe-ngc": {title: "Invalid Haas lathe position-mode code", description: "The configured Haas lathe model does not interpret G91 as incremental positioning.", scope: "Execution is blocked at this code. Haas lathe incremental positioning uses G391."},
  })],
  ["G90.1", entry("Absolute arc-center mode", "Interprets I/J arc centers as absolute coordinates.", "Modeled only by the bounded 3-axis mill arc contract.", MILL_CONTEXT)],
  ["G91.1", entry("Incremental arc-center mode", "Interprets I/J arc centers relative to the arc start.", "Modeled only by the bounded 3-axis mill arc contract.", MILL_CONTEXT)],
  ["G92", entry("Unsupported context-dependent command", "The current engines do not execute G92; its controller-specific operation is not inferred.", "The configured Haas lathe classifies it as an unsupported Group 01 motion, and the mill parser blocks it as an unmodeled coordinate transform.", Object.freeze([]), {
    "lathe:haas-lathe-ngc": {title: "Unsupported Haas Group 01 motion", description: "The configured Haas lathe model classifies G92 as an unsupported Group 01 motion.", scope: "Execution is blocked until a modeled Group 01 motion replaces it; no coordinate or cycle behavior is guessed."},
    "mill:fanuc-style": {title: "Unsupported coordinate transform", description: "The bounded mill parser recognizes G92 as an unmodeled coordinate-transform command.", scope: "Execution is blocked; no coordinate shift or machine position is invented."},
  })],
  ["G94", entry("Feed per minute", "Selects feed-per-minute interpretation.", "Modeled for generic/Fanuc-style lathe and bounded mill contexts.", Object.freeze(["lathe:generic", "mill:fanuc-style"]), {
    "lathe:haas-lathe-ngc": {title: "Unsupported Haas Group 01 motion", description: "The configured Haas lathe model classifies G94 as an unsupported Group 01 motion, not a feed-mode command.", scope: "Execution is blocked until a modeled Group 01 motion replaces it. Haas lathe feed-per-minute mode uses G98."},
  })],
  ["G95", entry("Feed per revolution", "Selects feed-per-revolution interpretation.", "Modeled for the generic/Fanuc-style lathe context.", Object.freeze(["lathe:generic"]), {
    "lathe:haas-lathe-ngc": {title: "Unsupported Haas Group 09 canned cycle", description: "The configured Haas lathe model classifies G95 as an unsupported Group 09 canned cycle, not a feed-mode command.", scope: "Execution is blocked until G80 or a documented G00/G01 cancellation. Haas lathe feed-per-revolution mode uses G99."},
    "mill:fanuc-style": {title: "Unsupported feed mode", description: "The bounded mill path does not model G95 feed-per-revolution.", scope: "Execution is blocked because the supported mill timing contract requires G94 feed per minute."},
  })],
  ["G96", entry("Constant surface speed", "Selects constant-surface-speed spindle interpretation.", "Modeled by the lathe engine. A missing G50 maximum RPM makes CSS timing explicitly assumed rather than proving a machine RPM cap.", LATHE_CONTEXTS)],
  ["G97", entry("Constant RPM", "Selects direct spindle-RPM interpretation.", "Modeled by the lathe engine.", LATHE_CONTEXTS)],
  ["G98", entry("Feed per minute", "Selects feed-per-minute interpretation in the current lathe parser.", "Modeled by both the generic/unconfigured and explicit Haas lathe feed-mode contracts; it is not assigned a mill canned-cycle meaning.", LATHE_CONTEXTS)],
  ["G99", entry("Feed per revolution", "Selects feed-per-revolution interpretation in the current lathe parser.", "Modeled by both the generic/unconfigured and explicit Haas lathe feed-mode contracts; it is not assigned a mill canned-cycle meaning.", LATHE_CONTEXTS)],
  ["G112", entry("XY-to-XC interpolation on", "Enters the bounded Haas lathe face-interpolation mode.", "Modeled only with the explicit Haas lathe NGC live-tool capability and state contract.", HAAS_LATHE_CONTEXT)],
  ["G113", entry("XY-to-XC interpolation off", "Leaves the bounded Haas lathe face-interpolation mode.", "Modeled only with the explicit Haas lathe NGC live-tool contract.", HAAS_LATHE_CONTEXT)],
  ["G390", entry("Absolute positioning", "Selects absolute linear positioning for the configured Haas lathe.", "Modeled only for the explicit Haas lathe NGC dialect.", HAAS_LATHE_CONTEXT)],
  ["G391", entry("Incremental positioning", "Selects incremental linear positioning for the configured Haas lathe.", "Modeled only for the explicit Haas lathe NGC dialect.", HAAS_LATHE_CONTEXT)],
  ["M0", entry("Program stop", "Pauses the local program reader at the end of this block until the user resumes it.", "Modeled as an unconditional resumable reader event for bounded lathe and mill paths. Downstream commanded geometry remains parseable. Operator-wait duration and controller-specific spindle, coolant, axis, look-ahead, or auxiliary-state effects are not inferred or included in the motion-and-dwell estimate.", ALL_PATH_CONTEXTS, {
    "lathe:haas-lathe-ngc": {title: "Unconditional program stop", description: "Pauses the local program reader at the end of this block until the user resumes it; the documented Haas contract also stops the main spindle and coolant.", scope: "The reader resumes at the following block and the modeled main-spindle state becomes stopped. Downstream commanded geometry remains parseable. Operator-wait duration, coolant state, live-tool behavior, and other machine-specific restart effects are not inferred or included in the motion-and-dwell estimate."},
  })],
  ["M1", entry("Optional program stop", "Uses the visible M01 pause switch: ON pauses the local reader at the end of this block; OFF continues through it.", "Modeled for bounded lathe paths as a resumable reader choice. It never converts valid downstream command geometry into PATH ONLY or dashed preview geometry. Operator-wait duration and physical spindle, coolant, axis, look-ahead, or auxiliary-state effects remain unknown. The bounded mill reader remains unchanged while mill work is on hold.", LATHE_CONTEXTS)],
  ["M2", entry("Program end", "Ends executable program flow.", "Modeled as an execution boundary by the lathe and mill engines.", ALL_PATH_CONTEXTS)],
  ["M3", entry("Spindle forward", "Starts the modeled main spindle in the M3 direction.", "Modeled for the bounded lathe and mill spindle-state contracts; physical direction still depends on machine setup.", ALL_PATH_CONTEXTS)],
  ["M4", entry("Spindle reverse", "Starts the modeled main spindle in the M4 direction.", "Modeled for the bounded lathe and mill spindle-state contracts; physical direction still depends on machine setup.", ALL_PATH_CONTEXTS)],
  ["M5", entry("Spindle stop", "Stops the modeled main spindle while retaining its last direction state.", "Modeled for the bounded lathe and mill spindle-state contracts.", ALL_PATH_CONTEXTS)],
  ["M6", entry("Tool change", "Executes the bounded mill tool-change event.", "Modeled only by the 3-axis mill contract; position becomes unknown until an explicit supported resynchronization move.", MILL_CONTEXT)],
  ["M7", entry("Mist coolant on", "Turns on the modeled mist-coolant state.", "Modeled only by the bounded 3-axis mill contract.", MILL_CONTEXT)],
  ["M8", entry("Flood coolant on", "Turns on the coolant state retained by the bounded mill parser.", "Modeled only as mill state; no flow, pressure, delivery, or machine result is verified.", MILL_CONTEXT, {
    "lathe:generic": {title: "Coolant command accepted without state", description: "The lathe parser treats M8 as centerline-geometry-neutral but does not retain or verify a coolant state.", scope: "No coolant-on machine claim is produced by the lathe model."},
    "lathe:haas-lathe-ngc": {title: "Coolant command accepted without state", description: "The Haas lathe parser treats M8 as centerline-geometry-neutral but does not retain or verify a coolant state.", scope: "No coolant-on machine claim is produced by the lathe model."},
  })],
  ["M9", entry("Coolant off", "Turns off the coolant state retained by the bounded mill parser.", "Modeled only as mill state; no flow, pressure, delivery, or machine result is verified.", MILL_CONTEXT, {
    "lathe:generic": {title: "Coolant command accepted without state", description: "The lathe parser treats M9 as centerline-geometry-neutral but does not retain or verify a coolant state.", scope: "No coolant-off machine claim is produced by the lathe model."},
    "lathe:haas-lathe-ngc": {title: "Coolant command accepted without state", description: "The Haas lathe parser treats M9 as centerline-geometry-neutral but does not retain or verify a coolant state.", scope: "No coolant-off machine claim is produced by the lathe model."},
  })],
  ["M23", entry("Thread chamfer on", "Enables the tracked thread-exit chamfer setting.", "Recognized only by the explicit Haas lathe G76 contract; unsupported chamfered cycle geometry remains blocked.", HAAS_LATHE_CONTEXT)],
  ["M24", entry("Thread chamfer off", "Disables the tracked thread-exit chamfer setting.", "Recognized only by the explicit Haas lathe G76 contract.", HAAS_LATHE_CONTEXT)],
  ["M30", entry("Program end and reset", "Ends executable program flow at the modeled boundary.", "Modeled as an execution boundary by the lathe and mill engines; machine-specific reset side effects are not inferred.", ALL_PATH_CONTEXTS)],
  ["M96", entry("Unmodeled execution boundary", "The lathe parser recognizes M96 as program control flow and blocks execution instead of simulating the call or branch.", "No control-flow target, return, repetition, or machine side effect is guessed.", Object.freeze([]), {
    "mill:fanuc-style": {status: "unresolved", controllerSpecific: true, title: "Controller-specific or unsupported", description: "G-Code Studio has no locally verified M96 meaning for the bounded mill context.", scope: "Its behavior may depend on the controller or machine builder. Execution is blocked and no machine-state meaning is guessed."},
  })],
  ["M97", entry("Unmodeled program control flow", "The local parsers recognize M97 as a program call/return boundary but do not execute that control flow.", "Execution is blocked; no target, repeat count, return path, or resulting modal state is guessed.", Object.freeze([]))],
  ["M98", entry("Unmodeled program control flow", "The local parsers recognize M98 as a program call/return boundary but do not execute that control flow.", "Execution is blocked; no target, repeat count, return path, or resulting modal state is guessed.", Object.freeze([]))],
  ["M99", entry("Unmodeled program control flow", "The local parsers recognize M99 as a program call/return boundary but do not execute that control flow.", "Execution is blocked; no target, repeat count, return path, or resulting modal state is guessed.", Object.freeze([]))],
  ["M133", entry("Live tool forward", "Commands the modeled Haas live-tool spindle in the forward direction.", "Requires explicit Haas lathe NGC context, live-tool capability equipped, a positive P RPM, and a command at or below any configured live-tool RPM limit.", HAAS_LATHE_CONTEXT)],
  ["M134", entry("Live tool reverse", "Commands the modeled Haas live-tool spindle in the reverse direction.", "Requires explicit Haas lathe NGC context, live-tool capability equipped, a positive P RPM, and a command at or below any configured live-tool RPM limit.", HAAS_LATHE_CONTEXT)],
  ["M135", entry("Live tool stop", "Stops the tracked Haas live-tool spindle state.", "Recognized in the explicit Haas lathe NGC dialect; the stop event does not require an equipped-capability claim.", HAAS_LATHE_CONTEXT)],
  ["M154", entry("C-axis engage", "Engages the modeled Haas lathe C-axis state.", "Modeled only with the explicit Haas lathe NGC C-axis capability and state contract.", HAAS_LATHE_CONTEXT)],
  ["M155", entry("C-axis disengage", "Disengages the modeled Haas lathe C-axis state.", "Modeled only with the explicit Haas lathe NGC contract and configured C-axis capability available.", HAAS_LATHE_CONTEXT)],
]);

function isAsciiLetter(character) {
  const code = character?.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDigit(character) {
  const code = character?.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isHorizontalWhitespace(character) {
  return character === " " || character === "\t" || character === "\f" || character === "\v";
}

function isNewlineStart(character) {
  return character === "\r" || character === "\n";
}

function scanNumber(source, start) {
  let cursor = start;
  if (source[cursor] === "+" || source[cursor] === "-") cursor += 1;
  const integerStart = cursor;
  while (isDigit(source[cursor])) cursor += 1;
  const integerDigits = cursor - integerStart;
  let fractionDigits = 0;
  if (source[cursor] === ".") {
    cursor += 1;
    const fractionStart = cursor;
    while (isDigit(source[cursor])) cursor += 1;
    fractionDigits = cursor - fractionStart;
  }
  return integerDigits || fractionDigits ? cursor : start;
}

function normalizeCode(family, valueText) {
  const compact = String(valueText || "").replace(/\s+/g, "").replace(/^\+/, "");
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(compact)) return null;
  let [whole = "0", fraction = ""] = compact.split(".");
  whole = whole.replace(/^0+(?=\d)/, "");
  if (!whole) whole = "0";
  fraction = fraction.replace(/0+$/, "");
  return `${family}${whole}${fraction ? `.${fraction}` : ""}`;
}

function tokenFor(source, type, start, end, line, column, extra = {}) {
  return {
    type,
    text: source.slice(start, end),
    start,
    end,
    line,
    column,
    endLine: line,
    endColumn: column + end - start,
    ...extra,
  };
}

function wordType(address) {
  if (address === "N") return "sequence";
  if (address === "G") return "g-code";
  if (address === "M") return "m-code";
  if (address === "T") return "tool";
  if (address === "S") return "speed";
  if (address === "F") return "feed";
  if (AXIS_AND_GEOMETRY_ADDRESSES.has(address)) return "coordinate";
  return "address";
}

function boundedPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function finalPositionFor(source, start, line, column) {
  let cursor = start;
  let currentLine = line;
  let currentColumn = column;
  while (cursor < source.length) {
    if (source[cursor] === "\r") {
      cursor += source[cursor + 1] === "\n" ? 2 : 1;
      currentLine += 1;
      currentColumn = 1;
    } else if (source[cursor] === "\n") {
      cursor += 1;
      currentLine += 1;
      currentColumn = 1;
    } else {
      cursor += 1;
      currentColumn += 1;
    }
  }
  return {line: currentLine, column: currentColumn};
}

export function tokenizeGcodeLanguage(input, options = {}) {
  const source = String(input ?? "");
  const maxSourceCharacters = boundedPositiveInteger(
    options.maxSourceCharacters,
    GCODE_LANGUAGE_LIMITS.maxSourceCharacters,
  );
  const maxTokens = boundedPositiveInteger(options.maxTokens, GCODE_LANGUAGE_LIMITS.maxTokens);
  const diagnostics = [];
  const tokens = [];

  if (source.length > maxSourceCharacters) {
    const end = finalPositionFor(source, 0, 1, 1);
    tokens.push({
      ...tokenFor(source, "unparsed", 0, source.length, 1, 1, {
        reason: "source-character-limit",
      }),
      endLine: end.line,
      endColumn: end.column,
    });
    diagnostics.push({
      severity: "warning",
      code: "source-character-limit",
      message: `Syntax coloring is disabled because the source exceeds ${maxSourceCharacters.toLocaleString("en-US")} characters.`,
      offset: 0,
    });
    return {
      sourceLength: source.length,
      lineCount: end.line,
      complete: false,
      tokens,
      diagnostics,
    };
  }

  let cursor = 0;
  let line = 1;
  let column = 1;
  while (cursor < source.length) {
    if (tokens.length >= maxTokens) {
      const end = finalPositionFor(source, cursor, line, column);
      tokens.push({
        ...tokenFor(source, "unparsed", cursor, source.length, line, column, {
          reason: "token-limit",
        }),
        endLine: end.line,
        endColumn: end.column,
      });
      diagnostics.push({
        severity: "warning",
        code: "token-limit",
        message: `Syntax coloring stopped at the bounded ${maxTokens.toLocaleString("en-US")}-token limit; source text is preserved.`,
        offset: cursor,
      });
      line = end.line;
      column = end.column;
      cursor = source.length;
      break;
    }

    const start = cursor;
    const startLine = line;
    const startColumn = column;
    const character = source[cursor];

    if (isNewlineStart(character)) {
      cursor += character === "\r" && source[cursor + 1] === "\n" ? 2 : 1;
      tokens.push({
        ...tokenFor(source, "newline", start, cursor, startLine, startColumn),
        endLine: startLine + 1,
        endColumn: 1,
      });
      line += 1;
      column = 1;
      continue;
    }

    if (isHorizontalWhitespace(character)) {
      cursor += 1;
      while (cursor < source.length && isHorizontalWhitespace(source[cursor])) cursor += 1;
      tokens.push(tokenFor(source, "whitespace", start, cursor, line, column));
      column += cursor - start;
      continue;
    }

    if (character === ";") {
      cursor += 1;
      while (cursor < source.length && !isNewlineStart(source[cursor])) cursor += 1;
      tokens.push(tokenFor(source, "comment", start, cursor, line, column, {
        commentStyle: "semicolon",
        closed: true,
        malformed: false,
      }));
      column += cursor - start;
      continue;
    }

    if (character === "(") {
      let depth = 0;
      let nested = false;
      let closed = false;
      while (cursor < source.length && !isNewlineStart(source[cursor])) {
        if (source[cursor] === "(") {
          depth += 1;
          if (depth > 1) nested = true;
        } else if (source[cursor] === ")") {
          depth -= 1;
          if (depth === 0) {
            cursor += 1;
            closed = true;
            break;
          }
        }
        cursor += 1;
      }
      tokens.push(tokenFor(source, "comment", start, cursor, line, column, {
        commentStyle: "parenthetical",
        closed,
        malformed: nested || !closed,
        ...(nested ? {reason: "nested-parenthetical-comment"} : (!closed ? {reason: "unterminated-parenthetical-comment"} : {})),
      }));
      column += cursor - start;
      continue;
    }

    if (isAsciiLetter(character)) {
      const address = character.toUpperCase();
      cursor += 1;
      const addressEnd = cursor;
      while (cursor < source.length && isHorizontalWhitespace(source[cursor])) cursor += 1;
      const numberStart = cursor;
      const numberEnd = scanNumber(source, numberStart);
      if (numberEnd > numberStart) {
        cursor = numberEnd;
        const valueText = source.slice(numberStart, numberEnd);
        const type = wordType(address);
        const normalized = address === "G" || address === "M"
          ? normalizeCode(address, valueText)
          : `${address}${valueText}`;
        tokens.push(tokenFor(source, type, start, cursor, line, column, {
          address,
          valueText,
          normalized,
        }));
      } else {
        cursor = addressEnd;
        while (cursor < source.length && isAsciiLetter(source[cursor])) cursor += 1;
        tokens.push(tokenFor(source, "malformed-word", start, cursor, line, column, {
          address,
          reason: "missing-numeric-value",
        }));
      }
      column += cursor - start;
      continue;
    }

    const numberEnd = scanNumber(source, cursor);
    if (numberEnd > cursor) {
      cursor = numberEnd;
      tokens.push(tokenFor(source, "number", start, cursor, line, column, {
        valueText: source.slice(start, cursor),
      }));
      column += cursor - start;
      continue;
    }

    if (PUNCTUATION.has(character)) {
      cursor += 1;
      tokens.push(tokenFor(source, "punctuation", start, cursor, line, column, {
        ...(character === ")" ? {malformed: true, reason: "unmatched-closing-parenthesis"} : {}),
      }));
      column += 1;
      continue;
    }

    cursor += 1;
    while (cursor < source.length
      && !isAsciiLetter(source[cursor])
      && !isDigit(source[cursor])
      && !isHorizontalWhitespace(source[cursor])
      && !isNewlineStart(source[cursor])
      && source[cursor] !== ";"
      && !PUNCTUATION.has(source[cursor])) cursor += 1;
    tokens.push(tokenFor(source, "unknown", start, cursor, line, column, {
      reason: "unrecognized-source-text",
    }));
    column += cursor - start;
  }

  return {
    sourceLength: source.length,
    lineCount: line,
    complete: diagnostics.length === 0,
    tokens,
    diagnostics,
  };
}

function tokensFrom(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.tokens) ? value.tokens : [];
}

function isSelectableToken(token) {
  return token && !SEPARATOR_TYPES.has(token.type) && token.end > token.start;
}

export function gcodeTokenAtOffset(tokenizationOrTokens, requestedOffset, {preferPrevious = true} = {}) {
  const tokens = tokensFrom(tokenizationOrTokens);
  const offset = Number(requestedOffset);
  if (!tokens.length || !Number.isSafeInteger(offset) || offset < 0) return null;

  let low = 0;
  let high = tokens.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (tokens[middle]?.start <= offset) low = middle + 1;
    else high = middle;
  }
  const index = low - 1;
  const token = tokens[index];
  if (!token) return null;

  if (offset < token.end) {
    if (isSelectableToken(token)) return token;
    if (preferPrevious && offset === token.start) {
      const previous = tokens[index - 1];
      if (isSelectableToken(previous) && previous.end === offset) return previous;
    }
    return null;
  }

  if (preferPrevious && offset === token.end && isSelectableToken(token)) return token;
  return null;
}

function codeTextFrom(tokenOrText) {
  if (typeof tokenOrText === "string") return tokenOrText;
  if (tokenOrText?.type === "g-code" || tokenOrText?.type === "m-code") {
    return tokenOrText.normalized || tokenOrText.text;
  }
  return null;
}

function normalizedContext(context) {
  const requestedMachine = String(context?.machineType || "").toLowerCase();
  if (!requestedMachine) return null;
  const machineType = requestedMachine.includes("mill") ? "mill" : (requestedMachine.includes("lathe") ? "lathe" : null);
  if (!machineType) return null;
  if (machineType === "mill") return {machineType, dialect: "fanuc-style", key: "mill:fanuc-style"};
  const requestedDialect = String(context?.dialect || "").toLowerCase();
  const dialect = requestedDialect === "haas-lathe-ngc" ? "haas-lathe-ngc" : "generic";
  return {machineType, dialect, key: `lathe:${dialect}`};
}

function baseIdentification(status, overrides = {}) {
  return {
    status,
    code: null,
    family: null,
    number: null,
    title: "Not a G/M code",
    description: "Select a complete G or M word to identify it.",
    scope: "No controller meaning was inferred.",
    modeled: false,
    controllerSpecific: false,
    ...overrides,
  };
}

export function identifyGcodeToken(tokenOrText, context = {}) {
  const raw = codeTextFrom(tokenOrText);
  if (raw === null) return baseIdentification("not-code");
  const compact = String(raw).trim().replace(/\s+/g, "").toUpperCase();
  if (compact[0] !== "G" && compact[0] !== "M") return baseIdentification("not-code");
  if (compact.length > 64) {
    return baseIdentification("malformed", {
      title: "Malformed G/M code",
      description: "The selected code is too long to be a bounded numeric G/M word.",
    });
  }
  const match = compact.match(/^([GM])(\+?(?:\d+(?:\.\d*)?|\.\d+))$/);
  if (!match) {
    return baseIdentification("malformed", {
      family: compact[0] === "G" || compact[0] === "M" ? compact[0] : null,
      title: "Malformed G/M code",
      description: "A G/M code must contain a non-negative numeric code value.",
    });
  }
  const family = match[1];
  if (family === "M" && Number(match[2]) === 0 && !/^\+?0+$/.test(match[2])) {
    return baseIdentification("malformed", {
      family,
      title: "Malformed M00 program stop",
      description: "M00 must use an unsigned integer spelling such as M0 or M00.",
    });
  }
  if (family === "M" && Number(match[2]) === 1 && !/^\+?0*1$/.test(match[2])) {
    return baseIdentification("malformed", {
      family,
      title: "Malformed M01 optional stop",
      description: "M01 must use an unsigned integer spelling such as M1 or M01.",
    });
  }
  const code = normalizeCode(family, match[2]);
  if (!code) {
    return baseIdentification("malformed", {
      family,
      title: "Malformed G/M code",
      description: "The selected G/M code could not be normalized as a bounded non-negative numeric identifier.",
    });
  }
  const numericText = code.slice(1);
  const number = Number(numericText);
  if (!code || !Number.isFinite(number) || (family === "M" && !Number.isInteger(number))) {
    return baseIdentification("malformed", {
      code,
      family,
      number: Number.isFinite(number) ? number : null,
      title: "Malformed G/M code",
      description: family === "M"
        ? "The local parser accepts only integer M-code identifiers."
        : "The selected G-code identifier is outside the supported numeric range.",
    });
  }

  const selectedContext = normalizedContext(context);
  const gear = family === "M" && selectedContext?.machineType === "lathe"
    ? commandedSpindleGear(context.spindleGearContract, number, selectedContext.dialect) : null;
  if (gear !== null) {
    if (!/^\+?0*4[123]$/.test(match[2])) return baseIdentification("malformed", {
      code, family, number, title: "Malformed spindle-gear code",
      description: "Spindle-gear selection requires an exact integer M-code spelling.",
    });
    return baseIdentification("modeled", {
      code, family, number, modeled: true, controllerSpecific: true,
      title: `${code} · spindle gear range ${gear}${gear === 1 ? " (low)" : ""}`,
      description: `Selects commanded spindle range ${gear} in the SL-75 environment. Playback continues after this block.`,
      scope: "Mori SL-series manual C-1/C-3 and C-76/C-77. Programmed G96/G97 and S values remain the commanded spindle-speed authority. Other M words or feed motion on this block need separate execution-order support.",
    });
  }
  const known = CODE_HELP.get(code);
  if (!known) {
    return baseIdentification("unresolved", {
      code,
      family,
      number,
      title: `${code} · controller-specific or unsupported`,
      description: `G-Code Studio has no locally verified meaning for ${code} in its current modeled code set.`,
      scope: "Its behavior may depend on the controller, machine builder, installed options, parameters, or ladder logic. Consult the exact machine/control documentation; no meaning is guessed here.",
      controllerSpecific: true,
    });
  }

  let presentation = selectedContext && known.variants[selectedContext.key]
    ? {...known, ...known.variants[selectedContext.key]}
    : known;
  const modeledHere = Boolean(selectedContext && known.contexts.includes(selectedContext.key));
  if (code === "M1" && modeledHere && typeof context.optionalStopEnabled === "boolean") {
    presentation = {
      ...presentation,
      description: context.optionalStopEnabled
        ? "The visible M01 pause switch is currently ON, so this block pauses the local reader until Play resumes."
        : "The visible M01 pause switch is currently OFF, so the local reader continues through this block.",
    };
  } else if (code === "M1" && modeledHere) {
    presentation = {
      ...presentation,
      status: "unresolved",
      title: "Optional Stop state required",
      description: "No explicit M01 pause state was supplied, so the local reader cannot choose between pausing and continuing.",
    };
  }
  const status = presentation.status || (modeledHere ? "modeled" : "not-modeled-here");
  return baseIdentification(status, {
    code,
    family,
    number,
    title: `${code} · ${presentation.title}`,
    description: presentation.description,
    scope: modeledHere
      ? presentation.scope
      : (selectedContext
        ? `${presentation.scope} It is not modeled for the selected ${selectedContext.machineType}${selectedContext.dialect ? ` / ${selectedContext.dialect}` : ""} context.`
        : `${presentation.scope} Select a machine and controller context before treating any meaning as modeled here.`),
    modeled: status === "modeled",
    controllerSpecific: presentation.controllerSpecific ?? (
      known.contexts.length > 0 && known.contexts.every((value) => value === "lathe:haas-lathe-ngc")
    ),
    applicableContexts: [...known.contexts],
  });
}
