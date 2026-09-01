const TOOL_WORD = /T\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi;
const AXIS_MOTION_WORD = /[XZ]\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)/i;
const PROGRAM_WORD = /^\s*%?\s*(?:\/\s*)?(?:N\s*[+-]?\d+(?:\.\d*)?\s*)?O\s*(\d+)\b/i;

function uniqueText(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.text.trim().toUpperCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function lineParts(raw) {
  const comments = [];
  let code = "";
  let index = 0;
  while (index < raw.length) {
    if (raw[index] === "(") {
      const end = raw.indexOf(")", index + 1);
      const stop = end < 0 ? raw.length : end;
      const text = raw.slice(index + 1, stop).trim();
      if (text) comments.push(text);
      index = end < 0 ? raw.length : end + 1;
      code += " ";
      continue;
    }
    if (raw[index] === ";") {
      const text = raw.slice(index + 1).trim();
      if (text) comments.push(text);
      break;
    }
    code += raw[index];
    index += 1;
  }
  return {code, comments};
}

function toolEventsForCode(code, line) {
  const events = [];
  for (const match of code.matchAll(TOOL_WORD)) {
    if (match.index > 0 && /[A-Z]/i.test(code[match.index - 1])) continue;
    const valueLexeme = match[1];
    events.push({
      key: `T${valueLexeme.toUpperCase()}`,
      address: `T${valueLexeme.toUpperCase()}`,
      valueLexeme,
      sourceLexeme: match[0],
      value: Number(valueLexeme),
      line,
      column: match.index + 1,
    });
  }
  return events;
}

function nearbyCommentsForLine(parts, callsByLine, lineIndex, window) {
  const nearby = [];
  const minimum = Math.max(0, lineIndex - window);
  for (let index = lineIndex - 1; index >= minimum; index -= 1) {
    if (callsByLine.has(index + 1)) break;
    if (AXIS_MOTION_WORD.test(parts[index].code)) break;
    for (const text of parts[index].comments) nearby.unshift({line: index + 1, text});
  }
  const maximum = Math.min(parts.length - 1, lineIndex + window);
  for (let index = lineIndex + 1; index <= maximum; index += 1) {
    if (callsByLine.has(index + 1)) break;
    if (AXIS_MOTION_WORD.test(parts[index].code)) break;
    for (const text of parts[index].comments) nearby.push({line: index + 1, text});
  }
  return uniqueText(nearby);
}

function suggestion(family, label, confidence, reason) {
  return Object.freeze({family, label, confidence, reason, confirmed: false});
}

export function suggestToolFamilies(comments) {
  const source = (Array.isArray(comments) ? comments : [comments])
    .map((comment) => typeof comment === "string" ? comment : comment?.text)
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  if (!source) return [];

  const suggestions = [];
  const add = (entry) => {
    if (!suggestions.some((item) => item.family === entry.family)) suggestions.push(entry);
  };
  if (/BACK\s*-?\s*TURN|BACKTURN|BEHIND\s+(?:A\s+)?FLANGE|BACK\s+GROOV/.test(source)) {
    add(suggestion("back-turn-groove", "Back-turning groove tool", "high", "Header text describes back-turning or cutting behind a flange."));
  }
  if (/GROOV|PART(?:ING)?\s*(?:OFF)?|CUT\s*-?\s*OFF/.test(source)) {
    add(suggestion("groove-part", "Grooving / parting tool", "medium", "Header text contains grooving, parting, or cut-off terminology."));
  }
  if (/THREAD|UNJ|UNF|UNC|NPT|ACME/.test(source)) {
    add(suggestion("thread", "Threading tool", "medium", "Header text contains threading terminology."));
  }
  const liveMilling = /LIVE\s*-?\s*TOOL|END\s*-?\s*MILL|MILLING|DRIVEN\s+(?:TOOL|CUTTER)/.test(source);
  if (liveMilling) {
    add(suggestion("live-milling", "Live-tool milling cutter", "medium", "Header text identifies live-tool or milling work."));
  }
  if (!liveMilling && /\bBORE|BORING|\bI\.D\.|\bID\b/.test(source)) {
    add(suggestion("id-bore", "Boring / ID turning tool", "medium", "Header text contains boring or inside-diameter terminology."));
  }
  if (/DRILL|REAM|TAP(?:PING)?/.test(source)) {
    add(suggestion("holemaking", "Drill / holemaking tool", "medium", "Header text contains drilling, reaming, or tapping terminology."));
  }
  if (/\bO\.D\.|\bOD\b|TURN|FACE|CNMG|DNMG|VNMG|WNMG|CCMT|DCMT/.test(source)) {
    add(suggestion("turn", "Turning / facing tool", "low", "Header text contains turning, facing, or common turning-insert terminology."));
  }
  return suggestions;
}

function programFilename(options) {
  const supplied = typeof options === "string" ? options : (options?.fileName ?? options?.filename);
  const normalized = String(supplied ?? "").trim().replaceAll("\\", "/").split("/").at(-1)?.trim();
  return normalized ? normalized.toUpperCase() : null;
}

function exactAssemblyRef(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const {id, revision} = candidate;
  if (typeof id !== "string" || !id.length || id.trim() !== id) return null;
  if (!Number.isInteger(revision) || revision < 1) return null;
  return {id, revision};
}

/**
 * Resolve the revision identity carried by a program-tool assignment without
 * consulting either tooling library. Schema-v2 assignments must carry an exact
 * id/revision pair; the former toolId-only shape is explicitly marked legacy.
 */
export function toolAssignmentAssemblyRef(assignment) {
  if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)) return null;
  if (assignment.schemaVersion === 2) return exactAssemblyRef(assignment.assemblyRef);
  if (assignment.schemaVersion !== undefined) return null;
  if (typeof assignment.toolId !== "string" || !assignment.toolId.length || assignment.toolId.trim() !== assignment.toolId) {
    return null;
  }
  return {id: assignment.toolId, revision: null, legacy: true};
}

function versionedSetupFields(setup) {
  if (!setup || typeof setup !== "object" || Array.isArray(setup)) return {};
  const fields = {...setup};
  delete fields.schemaVersion;
  delete fields.assemblyRef;
  delete fields.toolId;
  delete fields.confirmed;
  delete fields.confirmationSource;
  return fields;
}

/** Create an unconfirmed assignment pinned to one exact assembly revision. */
export function createVersionedToolAssignment(assembly, setup = {}) {
  const assemblyRef = exactAssemblyRef(assembly);
  if (!assemblyRef) return {};
  return {
    schemaVersion: 2,
    assemblyRef,
    ...versionedSetupFields(setup),
    confirmed: false,
  };
}

/**
 * Normalize an assignment against an already-resolved assembly. Exact v2
 * assignments survive unchanged; legacy or stale same-id revisions migrate to
 * the resolved revision with confirmation and provenance deliberately revoked.
 */
export function normalizeVersionedToolAssignment(assignment, resolvedAssembly) {
  const resolvedRef = exactAssemblyRef(resolvedAssembly);
  const assignmentRef = toolAssignmentAssemblyRef(assignment);
  if (!resolvedRef || !assignmentRef || assignmentRef.id !== resolvedRef.id) return {};
  if (assignmentRef.legacy !== true && assignmentRef.revision === resolvedRef.revision) {
    return {...assignment, assemblyRef: {...assignmentRef}};
  }
  return createVersionedToolAssignment(resolvedRef, assignment);
}

/**
 * Return a deterministic assignment scope for the exact opened program text.
 * Filename and O-program word (when present) remain readable identity fields,
 * while the exact normalized source prevents a confirmation from surviving
 * any edited code or header comment. Leading zeros in O words are retained.
 */
export function programAssignmentScope(source, options = {}) {
  const filename = programFilename(options);
  if (!filename) return null;
  const normalizedSource = String(source ?? "").replace(/\r/g, "");
  if (!normalizedSource.trim()) return null;
  const lines = normalizedSource.split("\n");
  let programKey = null;
  for (const raw of lines) {
    const match = lineParts(raw).code.match(PROGRAM_WORD);
    if (!match) continue;
    programKey = `O${match[1]}`;
    break;
  }
  return `program-tool-scope:v2:${JSON.stringify([filename, programKey, normalizedSource])}`;
}

/**
 * The application may ship a deliberately configured demonstration program.
 * Its setup is trusted only when the text came from that built-in action and
 * still matches the bundled source exactly. Matching user-loaded text is not
 * sufficient, and any editor input permanently clears the built-in origin.
 */
export function isExactBundledProgram(source, bundledSource, bundledOrigin = false) {
  const normalizedSource = String(source ?? "").replace(/\r/g, "");
  const normalizedBundledSource = String(bundledSource ?? "").replace(/\r/g, "");
  return bundledOrigin === true
    && normalizedSource === normalizedBundledSource;
}

/**
 * Persist ordinary assignments unchanged, including genuine user confirmations,
 * but omit the automatic bundled-sample assignment. The separate exact-source
 * bundled-origin marker may restore the sample bootstrap without converting
 * that automatic setup into an ordinary saved program-tool confirmation.
 */
export function toolAssignmentsForPersistence(assignments) {
  if (!assignments || typeof assignments !== "object" || Array.isArray(assignments)) return {};
  return Object.fromEntries(Object.entries(assignments).filter(([, assignment]) => (
    assignment
    && typeof assignment === "object"
    && !Array.isArray(assignment)
    && assignment.confirmationSource !== "bundled-sample"
  )));
}

export function extractProgramToolCalls(source, {nearbyCommentWindow = 12} = {}) {
  const lines = String(source ?? "").replace(/\r/g, "").split("\n");
  const parts = lines.map(lineParts);
  const callsByLine = new Map();
  const calls = [];

  parts.forEach((part, index) => {
    const events = toolEventsForCode(part.code, index + 1);
    if (!events.length) return;
    callsByLine.set(index + 1, events);
    calls.push(...events);
  });

  return calls.map((call) => {
    const lineIndex = call.line - 1;
    const inlineComments = uniqueText(parts[lineIndex].comments.map((text) => ({line: call.line, text})));
    const nearbyComments = nearbyCommentsForLine(parts, callsByLine, lineIndex, Math.max(0, nearbyCommentWindow));
    const comments = uniqueText([...nearbyComments, ...inlineComments]);
    return {
      ...call,
      raw: lines[lineIndex],
      inlineComments,
      nearbyComments,
      comments,
      suggestions: suggestToolFamilies(comments),
    };
  });
}

export function activeToolKeyAtLine(toolCalls, sourceLine) {
  const line = Number(sourceLine);
  if (!Array.isArray(toolCalls) || !Number.isFinite(line) || line < 1) return null;
  let active = null;
  for (const call of toolCalls) {
    if (call?.executable === false) continue;
    if (!Number.isInteger(call?.line) || call.line > line) continue;
    if (!active || call.line > active.line || (call.line === active.line && call.column >= active.column)) active = call;
  }
  return active?.key || null;
}

/**
 * Apply a mounted-tool setup change and revoke any previous confirmation when
 * the effective configuration changes. Confirmation is evidence for one exact
 * holder/insert/reference/direction setup; it must never carry across edits.
 */
export function reviseToolAssignmentSetup(assignment, changes = {}) {
  const current = assignment && typeof assignment === "object" && !Array.isArray(assignment)
    ? assignment
    : {};
  const normalizedChanges = changes && typeof changes === "object" && !Array.isArray(changes)
    ? changes
    : {};
  const changed = Object.entries(normalizedChanges).some(([key, value]) => current[key] !== value);
  const revised = {
    ...current,
    ...normalizedChanges,
    confirmed: changed ? false : current.confirmed === true,
  };
  if (changed) delete revised.confirmationSource;
  return revised;
}

export function reconcileToolAssignments(toolCalls, previousAssignments = {}, scopeOptions = null) {
  const next = {};
  if (scopeOptions !== null) {
    const previousScope = scopeOptions?.previousScope ?? null;
    const nextScope = scopeOptions?.nextScope ?? null;
    if (!previousScope || !nextScope || previousScope !== nextScope) return next;
  }
  const previousIsMap = previousAssignments instanceof Map;
  for (const call of toolCalls || []) {
    if (call?.executable === false) continue;
    if (!call?.key || Object.hasOwn(next, call.key)) continue;
    const exists = previousIsMap
      ? previousAssignments.has(call.key)
      : Object.prototype.hasOwnProperty.call(previousAssignments || {}, call.key);
    if (!exists) continue;
    next[call.key] = previousIsMap ? previousAssignments.get(call.key) : previousAssignments[call.key];
  }
  return next;
}
