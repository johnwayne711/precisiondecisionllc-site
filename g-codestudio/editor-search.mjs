function lineRange(source, lineNumber) {
  const text = String(source);
  const lines = text.split(/\r\n|\r|\n/);
  const line = Math.max(1, Math.min(lines.length, Number(lineNumber) || 1));
  let start = 0;
  const newlines = [...text.matchAll(/\r\n|\r|\n/g)];
  if (line > 1) start = newlines[line - 2].index + newlines[line - 2][0].length;
  return {start, end: start + lines[line - 1].length, line};
}

export function programSearchMatches(source, query) {
  const text = String(source);
  const needle = String(query).trim();
  if (!needle) return {kind: "empty", matches: []};

  const lineQuery = /^(?::|line\s+)(\d+)$/i.exec(needle);
  if (lineQuery) {
    const requested = Number(lineQuery[1]);
    const lineCount = Math.max(1, text.split(/\r\n|\r|\n/).length);
    if (requested < 1 || requested > lineCount) return {kind: "line", matches: []};
    return {kind: "line", matches: [lineRange(text, requested)]};
  }

  const matches = [];
  const haystack = text.toLocaleLowerCase();
  const normalizedNeedle = needle.toLocaleLowerCase();
  let start = 0;
  while (start <= haystack.length - normalizedNeedle.length) {
    const index = haystack.indexOf(normalizedNeedle, start);
    if (index < 0) break;
    const line = text.slice(0, index).split(/\r?\n/).length;
    matches.push({start: index, end: index + needle.length, line});
    start = index + Math.max(1, normalizedNeedle.length);
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

export function replaceAllProgramSearchMatches(source, matches, replacement) {
  let value = String(source);
  for (const match of [...matches].reverse()) value = replaceProgramSearchMatch(value, match, replacement);
  return {value, count: matches.length};
}
