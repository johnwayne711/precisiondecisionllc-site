// Presentation-only explanations of retained comparison results. No geometry,
// classification, source text or numerical threshold is changed here.
const problemClassifications = new Set(["unsupported", "unresolved", "tolerance-boundary"]);

function knownLine(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function messageText(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

export function materialEntryDiagnostics(comparison) {
  const diagnostics = [];
  const seen = new Set();
  const add = (entry, message) => {
    if (!messageText(message)) return;
    const sourceLine = knownLine(entry?.sourceLine) ?? knownLine(entry?.line);
    const executionLine = knownLine(entry?.executionLine) ?? knownLine(entry?.line) ?? sourceLine;
    const globalBlockIndex = Number.isSafeInteger(entry?.globalBlockIndex) && entry.globalBlockIndex >= 0
      ? entry.globalBlockIndex : null;
    const key = JSON.stringify([sourceLine, executionLine, globalBlockIndex, message]);
    if (seen.has(key)) return;
    seen.add(key);
    diagnostics.push({sourceLine, executionLine, message,
      ...(globalBlockIndex === null ? {} : {globalBlockIndex})});
  };

  add(null, comparison?.materialEntryError);
  const parserBlockers = Array.isArray(comparison?.parserVerificationBlockers)
    ? comparison.parserVerificationBlockers : [];
  const hasParserMessages = parserBlockers.some((warning) => messageText(warning?.message));
  for (const warning of parserBlockers) add(warning, warning?.message);

  const materialEntry = comparison?.materialEntry;
  add(null, materialEntry?.reason);
  const segmentResults = Array.isArray(materialEntry?.segmentResults) ? materialEntry.segmentResults : [];
  for (const result of segmentResults) {
    if (!result || (result.type === "parser-diagnostic" && hasParserMessages)) continue;
    const penetration = result.comparable === true ? result.penetration : null;
    const sideUnresolved = penetration?.sideUnresolved === true;
    const exhausted = penetration?.exhausted === true;
    const problem = problemClassifications.has(result.classification);
    if (!problem && !sideUnresolved && !exhausted) continue;

    const reason = messageText(result.reason);
    if (reason) add(result, reason);
    if (sideUnresolved) add(result, "Inside/outside classification remains uncertain within the numerical error bound.");
    if (exhausted) add(result, "Material-entry calculation reached its numerical subdivision limit.");
    if (result.classification === "tolerance-boundary") {
      add(result, "The material-entry interval overlaps the reporting threshold.");
    } else if (result.classification === "unresolved" && !reason && !sideUnresolved && !exhausted) {
      add(result, "The material-entry calculation did not meet its numerical error bound.");
    }
  }
  return diagnostics;
}
