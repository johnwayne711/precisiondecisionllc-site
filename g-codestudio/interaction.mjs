function squaredDistance(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function squaredDistanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return squaredDistance(point, start);
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return squaredDistance(point, {x: start.x + dx * ratio, y: start.y + dy * ratio});
}

function preferredCandidate(current, candidate, currentBlock) {
  if (!current || candidate.distanceSquared < current.distanceSquared - 1e-9) return candidate;
  if (Math.abs(candidate.distanceSquared - current.distanceSquared) > 1e-9) return current;
  const currentDelta = Math.abs(current.blockIndex + 1 - currentBlock);
  const candidateDelta = Math.abs(candidate.blockIndex + 1 - currentBlock);
  if (candidateDelta !== currentDelta) return candidateDelta < currentDelta ? candidate : current;
  return candidate.blockIndex > current.blockIndex ? candidate : current;
}

export function graphicsHitAt(hitPaths, x, y, {
  currentBlock = 0, endpointRadius = 10, pathRadius = 7,
} = {}) {
  const point = {x, y};
  let endpointHit = null;
  for (const hitPath of hitPaths || []) {
    const endpoint = hitPath.points?.at(-1);
    if (!endpoint) continue;
    const distanceSquared = squaredDistance(point, endpoint);
    if (distanceSquared > endpointRadius ** 2) continue;
    endpointHit = preferredCandidate(endpointHit, {blockIndex: hitPath.blockIndex, distanceSquared, kind: "point"}, currentBlock);
  }
  if (endpointHit) return endpointHit;

  let pathHit = null;
  for (const hitPath of hitPaths || []) {
    const points = hitPath.points || [];
    for (let index = 1; index < points.length; index += 1) {
      const distanceSquared = squaredDistanceToSegment(point, points[index - 1], points[index]);
      if (distanceSquared > pathRadius ** 2) continue;
      pathHit = preferredCandidate(pathHit, {blockIndex: hitPath.blockIndex, distanceSquared, kind: "path"}, currentBlock);
    }
  }
  return pathHit;
}

export function graphicsSelectionEnabled(viewMode) {
  return viewMode === "2d";
}

export function sourceLineAtOffset(source, offset) {
  const text = String(source ?? "");
  const boundedOffset = Math.max(0, Math.min(text.length, Number(offset) || 0));
  return text.slice(0, boundedOffset).split("\n").length;
}

const PROGRAM_CURSOR_NAVIGATION_KEYS = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End",
]);

export function programCursorNavigationKey(key) {
  return PROGRAM_CURSOR_NAVIGATION_KEYS.has(key);
}

function segmentExecutionLine(segment) {
  const line = Number(segment?.executionLine ?? segment?.line ?? segment?.sourceLine);
  return Number.isInteger(line) && line > 0 ? line : null;
}

export function executionRangeForSourceLine(segments, sourceLine) {
  const line = Number(sourceLine);
  if (!Array.isArray(segments) || !Number.isInteger(line) || line <= 0) return {start: 0, end: 0, count: 0};
  let start = 0;
  while (start < segments.length && (segmentExecutionLine(segments[start]) ?? Infinity) < line) start += 1;
  let end = start;
  while (end < segments.length && segmentExecutionLine(segments[end]) === line) end += 1;
  return {start, end, count: end - start};
}

export function visibleBlocksForSourceLine(segments, sourceLine) {
  return executionRangeForSourceLine(segments, sourceLine).end;
}

export function entryVisibleBlocksForSourceLine(segments, sourceLine) {
  const range = executionRangeForSourceLine(segments, sourceLine);
  return range.count ? range.start + 1 : range.end;
}

export function advanceExecutionPosition(segments, totalLines, position, direction) {
  const lastLine = Math.max(0, Number(totalLines) || 0);
  const line = Math.max(0, Math.min(lastLine, Number(position?.line ?? position?.programLine) || 0));
  const visibleBlocks = Math.max(0, Math.min(segments?.length || 0, Number(position?.visibleBlocks) || 0));
  if (direction > 0) {
    if (line <= 0) {
      const nextLine = Math.min(1, lastLine);
      return {line: nextLine, visibleBlocks: entryVisibleBlocksForSourceLine(segments, nextLine)};
    }
    const range = executionRangeForSourceLine(segments, line);
    if (range.count && visibleBlocks < range.end) return {line, visibleBlocks: Math.max(range.start + 1, visibleBlocks + 1)};
    if (line >= lastLine) return {line, visibleBlocks: range.end};
    const nextLine = line + 1;
    return {line: nextLine, visibleBlocks: entryVisibleBlocksForSourceLine(segments, nextLine)};
  }
  if (direction < 0) {
    if (line <= 0) return {line: 0, visibleBlocks: 0};
    const range = executionRangeForSourceLine(segments, line);
    if (range.count && visibleBlocks > range.start + 1) return {line, visibleBlocks: visibleBlocks - 1};
    const previousLine = line - 1;
    return {line: previousLine, visibleBlocks: visibleBlocksForSourceLine(segments, previousLine)};
  }
  return {line, visibleBlocks};
}

export function executionLineForPosition(segments, visibleBlocks) {
  if (!Array.isArray(segments) || visibleBlocks <= 0) return null;
  return segmentExecutionLine(segments[Math.min(visibleBlocks, segments.length) - 1]);
}

export function sourceLineForPosition(segments, visibleBlocks) {
  if (!Array.isArray(segments) || visibleBlocks <= 0) return null;
  const segment = segments[Math.min(visibleBlocks, segments.length) - 1];
  const line = Number(segment?.sourceLine ?? segment?.line);
  return Number.isInteger(line) && line > 0 ? line : null;
}
