export const PROGRAM_SEARCH_LIMITS = Object.freeze({
  maxSourceCharacters: 10 * 1024 * 1024,
  maxSourceLines: 100_000,
  maxQueryCharacters: 4_096,
  maxMatches: 10_000,
  maxResultCharacters: 10 * 1024 * 1024,
});

function boundedPositiveInteger(value, ceiling) {
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate > 0 ? Math.min(candidate, ceiling) : ceiling;
}

function boundedSearchLimits(overrides = {}) {
  return {
    maxSourceCharacters: boundedPositiveInteger(overrides.maxSourceCharacters, PROGRAM_SEARCH_LIMITS.maxSourceCharacters),
    maxSourceLines: boundedPositiveInteger(overrides.maxSourceLines, PROGRAM_SEARCH_LIMITS.maxSourceLines),
    maxQueryCharacters: boundedPositiveInteger(overrides.maxQueryCharacters, PROGRAM_SEARCH_LIMITS.maxQueryCharacters),
    maxMatches: boundedPositiveInteger(overrides.maxMatches, PROGRAM_SEARCH_LIMITS.maxMatches),
    maxResultCharacters: boundedPositiveInteger(overrides.maxResultCharacters, PROGRAM_SEARCH_LIMITS.maxResultCharacters),
  };
}

function blockedSearch(reason, limit) {
  return {kind: "blocked", matches: [], blocked: true, reason, limit};
}

function sourceLineSummary(text, maximumLines) {
  let count = 1;
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charCodeAt(index);
    if (character === 13) {
      if (text.charCodeAt(index + 1) === 10) index += 1;
      count += 1;
    } else if (character === 10) {
      count += 1;
    }
    if (count > maximumLines) return {count, exceeded: true};
  }
  return {count, exceeded: false};
}

function lineRange(text, lineNumber) {
  const requestedLine = Number(lineNumber);
  if (!Number.isSafeInteger(requestedLine) || requestedLine < 1) return null;

  let line = 1;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charCodeAt(index);
    if (character !== 10 && character !== 13) continue;
    if (line === requestedLine) return {start, end: index, line, lineStart: start};
    if (character === 13 && text.charCodeAt(index + 1) === 10) index += 1;
    start = index + 1;
    line += 1;
  }
  return line === requestedLine ? {start, end: text.length, line, lineStart: start} : null;
}

function advanceLineState(text, state, targetOffset) {
  while (state.offset < targetOffset) {
    const character = text.charCodeAt(state.offset);
    if (character === 10) {
      state.line += 1;
      state.offset += 1;
      state.lineStart = state.offset;
    } else if (character === 13 && text.charCodeAt(state.offset + 1) !== 10) {
      state.line += 1;
      state.offset += 1;
      state.lineStart = state.offset;
    } else {
      state.offset += 1;
    }
  }
}

function escapedRegularExpressionLiteral(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

export function programSearchMatches(source, query, limitOverrides = {}) {
  const text = String(source);
  const needle = String(query).trim();
  if (!needle) return {kind: "empty", matches: []};

  const limits = boundedSearchLimits(limitOverrides);
  if (needle.length > limits.maxQueryCharacters) {
    return blockedSearch(`Search text exceeds the ${limits.maxQueryCharacters.toLocaleString("en-US")}-character limit.`, limits.maxQueryCharacters);
  }
  if (text.length > limits.maxSourceCharacters) {
    return blockedSearch(`Program search exceeds the ${limits.maxSourceCharacters.toLocaleString("en-US")}-character source limit.`, limits.maxSourceCharacters);
  }
  const lineSummary = sourceLineSummary(text, limits.maxSourceLines);
  if (lineSummary.exceeded) {
    return blockedSearch(`Program search exceeds the ${limits.maxSourceLines.toLocaleString("en-US")}-line source limit.`, limits.maxSourceLines);
  }

  const lineQuery = /^(?::|line\s+)(\d+)$/i.exec(needle);
  if (lineQuery) {
    const requested = Number(lineQuery[1]);
    const range = lineRange(text, requested);
    return {kind: "line", matches: range ? [range] : []};
  }

  const matches = [];
  const matcher = new RegExp(escapedRegularExpressionLiteral(needle), "giu");
  const lineState = {line: 1, offset: 0, lineStart: 0};
  for (let found = matcher.exec(text); found; found = matcher.exec(text)) {
    if (matches.length >= limits.maxMatches) {
      return blockedSearch(`Search exceeds the ${limits.maxMatches.toLocaleString("en-US")}-match limit; no partial match set was returned.`, limits.maxMatches);
    }
    const index = found.index;
    advanceLineState(text, lineState, index);
    matches.push({start: index, end: index + found[0].length, line: lineState.line, lineStart: lineState.lineStart});
  }
  return {kind: "text", matches};
}

export function nextProgramSearchIndex(matches, currentIndex, direction = 1) {
  if (!matches.length) return -1;
  const step = direction < 0 ? -1 : 1;
  const base = Number.isInteger(currentIndex) ? currentIndex : -1;
  return (base + step + matches.length) % matches.length;
}

export function programSearchIndexFromAnchor(matches, anchor, direction = 1) {
  if (!matches.length) return -1;
  const offset = Math.max(0, Number(anchor) || 0);
  if (direction < 0) {
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      if (matches[index].end <= offset) return index;
    }
    return matches.length - 1;
  }
  const index = matches.findIndex((match) => match.start >= offset);
  return index >= 0 ? index : 0;
}

export function replaceProgramSearchMatch(source, match, replacement) {
  if (!match) return String(source);
  return `${String(source).slice(0, match.start)}${replacement}${String(source).slice(match.end)}`;
}

export function replaceAllProgramSearchMatches(source, matches, replacement, limitOverrides = {}) {
  const value = String(source);
  const replacementText = String(replacement);
  const limits = boundedSearchLimits(limitOverrides);
  const normalizedMatches = [];
  let previousEnd = 0;
  let resultLength = value.length;

  for (const match of matches || []) {
    if (normalizedMatches.length >= limits.maxMatches) {
      return {
        value,
        count: 0,
        blocked: true,
        reason: `Replace all exceeds the ${limits.maxMatches.toLocaleString("en-US")}-match limit; the program was not changed.`,
        limit: limits.maxMatches,
      };
    }
    const start = Number(match?.start);
    const end = Number(match?.end);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < previousEnd || end < start || end > value.length) {
      return {value, count: 0, blocked: true, reason: "Replace all received an invalid or overlapping match set; the program was not changed."};
    }
    resultLength += replacementText.length - (end - start);
    if (!Number.isSafeInteger(resultLength) || resultLength > limits.maxResultCharacters) {
      return {
        value,
        count: 0,
        blocked: true,
        reason: `Replace all would exceed the ${limits.maxResultCharacters.toLocaleString("en-US")}-character result limit; the program was not changed.`,
        limit: limits.maxResultCharacters,
      };
    }
    normalizedMatches.push({start, end});
    previousEnd = end;
  }

  if (!normalizedMatches.length) return {value, count: 0};
  const parts = [];
  previousEnd = 0;
  for (const match of normalizedMatches) {
    parts.push(value.slice(previousEnd, match.start), replacementText);
    previousEnd = match.end;
  }
  parts.push(value.slice(previousEnd));
  return {value: parts.join(""), count: normalizedMatches.length};
}
