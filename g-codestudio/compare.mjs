function splitProgramLines(source) {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

function canonicalLine(line, ignoreFormatting) {
  return ignoreFormatting ? line.replace(/\s+/g, "").toUpperCase() : line;
}

function myersCore(before, after, keyFor) {
  const n = before.length;
  const m = after.length;
  const max = n + m;
  if (!max) return [];

  let frontier = new Map([[1, 0]]);
  const trace = [];

  for (let depth = 0; depth <= max; depth += 1) {
    trace.push(new Map(frontier));
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      let x;
      const previous = frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY;
      const next = frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
      if (diagonal === -depth || (diagonal !== depth && previous < next)) {
        x = next;
      } else {
        x = previous + 1;
      }
      let y = x - diagonal;
      while (x < n && y < m && keyFor(before[x]) === keyFor(after[y])) {
        x += 1;
        y += 1;
      }
      frontier.set(diagonal, x);
      if (x >= n && y >= m) return backtrack(trace, before, after, depth);
    }
    if (depth >= 512) {
      return [
        ...before.map((value) => ({type: "delete", before: value})),
        ...after.map((value) => ({type: "insert", after: value})),
      ];
    }
  }
  return [];
}

function myersDiff(before, after, keyFor = (value) => value) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && keyFor(before[prefix]) === keyFor(after[prefix])) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix && suffix < after.length - prefix
    && keyFor(before[before.length - suffix - 1]) === keyFor(after[after.length - suffix - 1])
  ) suffix += 1;

  const start = before.slice(0, prefix).map((value, index) => ({type: "equal", before: value, after: after[index]}));
  const middleBefore = before.slice(prefix, before.length - suffix);
  const middleAfter = after.slice(prefix, after.length - suffix);
  const middle = myersCore(middleBefore, middleAfter, keyFor);
  const end = before.slice(before.length - suffix).map((value, index) => ({
    type: "equal", before: value, after: after[after.length - suffix + index],
  }));
  return [...start, ...middle, ...end];
}

function backtrack(trace, before, after, finalDepth) {
  let x = before.length;
  let y = after.length;
  const operations = [];

  for (let depth = finalDepth; depth >= 0; depth -= 1) {
    const frontier = trace[depth];
    const diagonal = x - y;
    const previous = frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY;
    const next = frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
    const previousDiagonal = diagonal === -depth || (diagonal !== depth && previous < next)
      ? diagonal + 1
      : diagonal - 1;
    const previousX = frontier.get(previousDiagonal) ?? 0;
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      operations.push({type: "equal", before: before[x - 1], after: after[y - 1]});
      x -= 1;
      y -= 1;
    }
    if (!depth) break;
    if (x === previousX) {
      operations.push({type: "insert", after: after[y - 1]});
      y -= 1;
    } else {
      operations.push({type: "delete", before: before[x - 1]});
      x -= 1;
    }
  }

  return operations.reverse();
}

function pairedRows(operations) {
  const rows = [];
  let originalLine = 0;
  let revisedLine = 0;
  let cursor = 0;

  while (cursor < operations.length) {
    const operation = operations[cursor];
    if (operation.type === "equal") {
      originalLine += 1;
      revisedLine += 1;
      rows.push({
        type: "unchanged",
        original: {number: originalLine, text: operation.before},
        revised: {number: revisedLine, text: operation.after},
      });
      cursor += 1;
      continue;
    }

    const removed = [];
    const added = [];
    while (cursor < operations.length && operations[cursor].type !== "equal") {
      const change = operations[cursor];
      if (change.type === "delete") {
        originalLine += 1;
        removed.push({number: originalLine, text: change.before});
      } else {
        revisedLine += 1;
        added.push({number: revisedLine, text: change.after});
      }
      cursor += 1;
    }

    const paired = Math.min(removed.length, added.length);
    for (let index = 0; index < paired; index += 1) {
      rows.push({type: "modified", original: removed[index], revised: added[index]});
    }
    for (let index = paired; index < removed.length; index += 1) {
      rows.push({type: "removed", original: removed[index], revised: null});
    }
    for (let index = paired; index < added.length; index += 1) {
      rows.push({type: "added", original: null, revised: added[index]});
    }
  }
  return rows;
}

function wordCategory(letter) {
  if ("XZUWIKRABCD".includes(letter)) return "coordinates";
  if ("GMT".includes(letter)) return "commands";
  if ("FS".includes(letter)) return "process";
  if ("NOPQL".includes(letter)) return "references";
  return "other";
}

function gcodeWords(line) {
  return [...String(line ?? "").matchAll(/([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi)]
    .map((match) => ({letter: match[1].toUpperCase(), value: match[2], word: `${match[1].toUpperCase()}${match[2]}`}));
}

function summarizeWords(rows) {
  const summary = {coordinates: 0, commands: 0, process: 0, references: 0, other: 0};
  for (const row of rows) {
    if (row.type === "unchanged") continue;
    const before = gcodeWords(row.original?.text);
    const after = gcodeWords(row.revised?.text);
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const oldWord = before[index];
      const newWord = after[index];
      if (oldWord?.word === newWord?.word) continue;
      const letter = newWord?.letter || oldWord?.letter || "";
      summary[wordCategory(letter)] += 1;
    }
  }
  return summary;
}

function lineTokens(line) {
  return String(line ?? "").match(/[A-Za-z][+-]?(?:\d+(?:\.\d*)?|\.\d+)|[+-]?(?:\d+(?:\.\d*)?|\.\d+)|[A-Za-z]+|\s+|./g) || [];
}

function mergeSegments(segments, changed, text) {
  if (!text) return;
  const previous = segments.at(-1);
  if (previous?.changed === changed) previous.text += text;
  else segments.push({text, changed});
}

export function diffLineTokens(original, revised, {ignoreFormatting = true} = {}) {
  const before = lineTokens(original);
  const after = lineTokens(revised);
  const keyFor = (token) => {
    if (!ignoreFormatting) return token;
    if (/^\s+$/.test(token)) return " ";
    return token.toUpperCase();
  };
  const operations = myersDiff(before, after, keyFor);
  const result = {original: [], revised: []};
  for (const operation of operations) {
    if (operation.type === "equal") {
      mergeSegments(result.original, false, operation.before);
      mergeSegments(result.revised, false, operation.after);
    } else if (operation.type === "delete") {
      mergeSegments(result.original, true, operation.before);
    } else {
      mergeSegments(result.revised, true, operation.after);
    }
  }
  return result;
}

export function comparePrograms(originalSource, revisedSource, {ignoreFormatting = true} = {}) {
  const original = splitProgramLines(originalSource);
  const revised = splitProgramLines(revisedSource);
  const operations = myersDiff(original, revised, (line) => canonicalLine(line, ignoreFormatting));
  const rows = pairedRows(operations);
  const summary = {unchanged: 0, modified: 0, added: 0, removed: 0, differences: 0};
  for (const row of rows) summary[row.type] += 1;
  summary.differences = summary.modified + summary.added + summary.removed;
  return {rows, summary, words: summarizeWords(rows)};
}

function geometrySignature(segment, tolerance) {
  const precision = Math.max(0, Math.ceil(-Math.log10(tolerance)));
  const coordinate = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(precision) : "_";
  const points = (segment.points?.length ? segment.points : [segment.start, segment.end]).filter(Boolean);
  const cAxisMotion = segment.cAxisMotion;
  const cAxisSemantics = cAxisMotion
    ? [cAxisMotion.type || "index", coordinate(cAxisMotion.start), coordinate(cAxisMotion.end), cAxisMotion.blocked ? "blocked" : "clear"].join(",")
    : "none";
  const verificationIssues = [...new Set(segment.verificationIssues || [])].sort().join(",");
  const semantics = [
    segment.type,
    segment.liveTool ? "live" : "turn",
    segment.coordinateMode || "xz",
    segment.plane || "G18",
    segment.verificationBlocked ? "blocked" : "clear",
    verificationIssues,
    cAxisSemantics,
    segment.unresolvedOperation || "resolved",
  ];
  return `${semantics.join("|")}|${points.map((point) => ["x", "y", "z", "c"].map((axis) => coordinate(point[axis])).join(",")).join(";")}`;
}

function markGeometryDifferences(source, comparison, tolerance) {
  const available = new Map();
  for (const segment of comparison) {
    const signature = geometrySignature(segment, tolerance);
    available.set(signature, (available.get(signature) || 0) + 1);
  }
  return source.map((segment) => {
    const signature = geometrySignature(segment, tolerance);
    const matches = available.get(signature) || 0;
    if (matches) available.set(signature, matches - 1);
    return {segment, different: matches === 0};
  });
}

function standaloneCAxisSegments(motions) {
  return (Array.isArray(motions) ? motions : [])
    .filter((motion) => !motion?.combinedWithLinearAxes)
    .map((motion) => ({
      type: "c-axis-index",
      coordinateMode: "c-axis-index",
      cAxisMotion: {...motion},
      verificationBlocked: Boolean(motion?.blocked),
      verificationIssues: motion?.reason ? [motion.reason] : [],
      points: [],
      line: motion?.line ?? null,
    }));
}

function unresolvedOperationSegments(operations) {
  return (Array.isArray(operations) ? operations : [])
    .filter((operation) => operation?.blocked && !operation?.displayed)
    .map((operation) => ({
      type: "unresolved-live-operation",
      liveTool: true,
      coordinateMode: "unresolved-live-operation",
      verificationBlocked: true,
      verificationIssues: [operation.motion || "unresolved-live-operation"],
      unresolvedOperation: `${operation.motion || "unknown"}|${operation.raw || ""}`,
      points: [],
      line: operation.line ?? null,
    }));
}

export function compareSegmentGeometry(originalSegments, revisedSegments, {
  tolerance = 0.001,
  originalCAxisMotions = [],
  revisedCAxisMotions = [],
  originalUnresolvedOperations = [],
  revisedUnresolvedOperations = [],
} = {}) {
  const originalUnresolved = unresolvedOperationSegments(originalUnresolvedOperations);
  const revisedUnresolved = unresolvedOperationSegments(revisedUnresolvedOperations);
  const originalComparable = [...originalSegments, ...standaloneCAxisSegments(originalCAxisMotions), ...originalUnresolved];
  const revisedComparable = [...revisedSegments, ...standaloneCAxisSegments(revisedCAxisMotions), ...revisedUnresolved];
  const original = markGeometryDifferences(originalComparable, revisedComparable, tolerance);
  const revised = markGeometryDifferences(revisedComparable, originalComparable, tolerance);
  return {
    original,
    revised,
    originalOnly: original.filter((item) => item.different).length,
    revisedOnly: revised.filter((item) => item.different).length,
    unresolvedOriginal: originalUnresolved.length,
    unresolvedRevised: revisedUnresolved.length,
    verificationUnresolved: originalUnresolved.length > 0 || revisedUnresolved.length > 0,
  };
}

export function geometryItemsForFit(geometry, mode = "all") {
  const all = [...(geometry?.original || []), ...(geometry?.revised || [])];
  if (mode === "changed") {
    const changed = all.filter((item) => item.different);
    return changed.length ? changed : all;
  }
  if (mode === "part") {
    const cutting = all.filter((item) => item.segment?.type !== "rapid");
    return cutting.length ? cutting : all;
  }
  return all;
}

export function overlayGeometryLayers(geometry) {
  const original = geometry?.original || [];
  const revised = geometry?.revised || [];
  return {
    common: original.filter((item) => !item.different),
    originalOnly: original.filter((item) => item.different),
    revisedOnly: revised.filter((item) => item.different),
  };
}
