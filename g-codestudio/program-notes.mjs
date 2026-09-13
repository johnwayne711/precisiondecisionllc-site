// Presentation only: no diagnostic is discarded, rewritten or used to change
// parser, geometry, timing or verification authority.
const UNCERTAINTY_CODES = new Set([
  "reference-return-position-unknown",
  "rapid-position-incomplete",
  "rapid-start-position-unknown",
  "g112-position-unknown",
]);
const ROUTINE_CODES = new Set([
  "g112-position-established",
  "g112-position-resynchronized",
  "turning-position-resynchronized",
  "reference-return-resolved",
]);

function noteSeverity(note) {
  if (note?.danger || note?.verificationBlocked) return "danger";
  if (note?.requiresAttention || note?.timingExcluded || note?.timingBlocked
    || note?.verificationScope || note?.timingScope || UNCERTAINTY_CODES.has(note?.code)) return "warning";
  // info:true historically also labels assumptions and missing authority.
  // Only an explicit presentation declaration or audited routine code may fold.
  return note?.routine === true || ROUTINE_CODES.has(note?.code) ? "info" : "warning";
}

function groupMessage(note, severity) {
  // This one parser diagnostic embeds a different established coordinate in
  // each occurrence. The shared title states only its common exclusion; every
  // exact message and source/execution identity remains in the group's notes.
  if (severity === "warning" && note?.code === "rapid-start-position-unknown"
    && note.info === true && note.timingExcluded === true && note.timingScope === "unknown-start-rapid") {
    return "Rapid position established from an unknown start; approach geometry and its travel time are omitted.";
  }
  return typeof note?.message === "string" ? note.message : "";
}

/** Group complete note occurrences without modifying the input or its notes. */
export function groupProgramNotes(notes = []) {
  const source = Array.isArray(notes) ? notes : [];
  const groups = new Map();
  for (const note of source) {
    const severity = noteSeverity(note);
    const message = groupMessage(note, severity);
    const code = typeof note?.code === "string" ? note.code : null;
    const key = JSON.stringify([code, message, severity]);
    if (!groups.has(key)) groups.set(key, {key, message, notes: [], severity});
    groups.get(key).notes.push(note);
  }
  const attention = [], information = [];
  for (const group of groups.values()) {
    (group.severity === "info" ? information : attention).push(group);
  }
  const priority = group => group.severity !== "danger" ? 2
    : group.notes[0]?.code === "tool-offset-pairing-unconfirmed" ? 0 : 1;
  attention.sort((before, after) => priority(before) - priority(after));
  return {attention, information, totalCount: source.length};
}
