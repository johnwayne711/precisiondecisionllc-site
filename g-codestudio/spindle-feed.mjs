// Program targets, not measured machine motion. Coordinates are canonical mm.
// Sources and controller differences: docs/DECISIONS.md D-042.
export function programmedSpindleRpm(state, point, xScale = 0.5) {
  if (state.spindleSpeedIssue) return {rpm: null, reason: state.spindleSpeedIssue};
  const speed = state.spindleSpeed;
  if (!Number.isFinite(speed) || speed < 0) return {rpm: null, reason: "Spindle S value is unknown."};
  if (state.spindleLimitIssue) return {rpm: null, reason: state.spindleLimitIssue};
  const limit = Number.isFinite(state.spindleLimit) && state.spindleLimit > 0 ? state.spindleLimit : null;
  if (state.spindleMode === "rpm") {
    if (limit !== null && speed > limit && state.spindleRpmLimitMode === "unknown") {
      return {rpm: null, reason: "G50 behavior in G97 is unconfigured for this machine."};
    }
    const capped = state.spindleRpmLimitMode === "both" && limit !== null && speed > limit;
    return {rpm: capped ? limit : speed, capped};
  }
  if (state.spindleMode !== "css") return {rpm: null, reason: "Select G96 or G97 to establish the meaning of S."};
  const cssUnits = state.cssUnits === "program" ? (state.programUnits === "in" ? "sfm" : "m/min") : state.cssUnits;
  if (!["sfm", "m/min"].includes(cssUnits)) return {rpm: null, reason: "G96 surface-speed units are unknown. Set CSS units in the machine definition."};
  if (!Number.isFinite(point?.x) || ![0.5, 1].includes(xScale)) return {rpm: null, reason: "G96 needs a known programmed diameter at this block."};
  const diameter = Math.abs(point.x) * xScale * 2;
  if (!Number.isFinite(diameter)) return {rpm: null, reason: "Programmed diameter exceeds the numeric range."};
  if (speed === 0) return {rpm: 0, capped: false};
  if (diameter === 0) return limit !== null ? {rpm: limit, capped: true}
    : {rpm: null, reason: "G96 reaches spindle centerline without a known G50 RPM cap."};
  const requested = (speed / diameter) * ((cssUnits === "sfm" ? 304.8 : 1000) / Math.PI);
  const rpm = limit !== null ? Math.min(requested, limit) : requested;
  if (!Number.isFinite(rpm) || rpm === 0) return {rpm: null, reason: "Calculated RPM exceeds the numeric range."};
  return {rpm, capped: limit !== null && requested >= limit, uncapped: limit === null};
}

export function programmedFeedMmPerMinute(state, rpm) {
  if (state.feedIssue) return {feed: null, reason: state.feedIssue};
  if (!(state.feed > 0) || !Number.isFinite(state.feed)) return {feed: null, reason: "A positive F value is not established."};
  const scale = state.unitScale;
  if (![1, 25.4].includes(scale)) return {feed: null, reason: "Feed units are unknown."};
  const perMinute = state.feedMode === "per-minute";
  if (!perMinute && state.feedMode !== "per-revolution") return {feed: null, reason: "Feed mode is unknown. Program G98/G99 or set a supported Starting feed mode in the machine definition."};
  if (!perMinute && !Number.isFinite(rpm)) return {feed: null, reason: "G99 feed per minute needs a known spindle RPM."};
  const feed = state.feed * scale * (perMinute ? 1 : rpm);
  return Number.isFinite(feed) ? {feed} : {feed: null, reason: "Calculated feed exceeds the numeric range."};
}

export function spindleFeedAtPosition(parsed, {sourceLine = 0, visibleBlocks = 0, xScale = 0.5} = {}) {
  const events = parsed?.spindleFeedEvents || [];
  let low = 0, high = events.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (events[middle].line <= sourceLine) low = middle + 1; else high = middle;
  }
  const event = events[low - 1];
  if (!event) return {rpm: null, feed: null, feedPerRevolution: null, reasons: ["No spindle/feed state has been established at this line."]};
  const index = Math.min(visibleBlocks, parsed.segments.length) - 1;
  const segment = parsed.segments[index];
  const executionLine = item => item?.executionLine ?? item?.line;
  const atMove = segment && executionLine(segment) === sourceLine;
  const substep = atMove && executionLine(parsed.segments[index + 1]) === sourceLine;
  const state = atMove ? {...event, ...segment} : {...event};
  // The renderer may apply nose compensation; CSS follows programmed X.
  const point = atMove ? (segment.programmedGeometry?.end ?? segment.end) : {x: event.x};
  if (atMove && !substep) {
    state.spindleRunning = event.spindleRunning;
    state.spindleDirection = event.spindleDirection;
    state.commandedSpindleGear = event.commandedSpindleGear;
  }
  const blocked = event.blocked || (atMove && (segment.verificationBlocked || segment.liveToolBlocked));
  const reasons = blocked ? [event.blockReason || "This block has unresolved execution or geometry."] : [];
  // A requested target does not become zero or unknown when the spindle stops.
  // Rejected spindle commands and unresolved CSS coordinates remain distinct
  // from unrelated execution blockers. Never reuse S from a rejected block.
  const spindle = event.spindleReadoutIssue ? {rpm: null, reason: event.spindleReadoutIssue}
    : programmedSpindleRpm(state, blocked && state.spindleMode === "css" ? null : point, xScale);
  const rpm = spindle.rpm;
  if (spindle.reason) reasons.push(spindle.reason);
  if (spindle.capped) reasons.push("G50 RPM cap reached.");
  if (spindle.uncapped) reasons.push("No G50 cap is programmed; machine limits are not included.");
  if (event.line < sourceLine && event.blocked) reasons.push(`Last interpreted spindle command state is from line ${event.line}; later blocks were not interpreted.`);
  if (blocked) return {...state, commandedFeed: state.feed, rpm, feed: null, feedPerRevolution: null, reasons};
  const rapid = Boolean(atMove ? segment.type === "rapid" : event.line === sourceLine && event.rapidBlock);
  const feed = programmedFeedMmPerMinute(state, rpm);
  if (!rapid && feed.reason) reasons.push(feed.reason);
  if (atMove && segment.threading) {
    // Threading F can be an axis lead rather than resultant path feed.
    return {...state, commandedFeed: state.feed, threadLeadMmPerRev: segment.threading.leadMmPerRev,
      rpm, feed: null, feedPerRevolution: null, rapid: false, reasons: [...reasons, "F specifies threading lead; resultant cutting feed is not inferred."]};
  }
  let feedPerRevolution = null, feedPerRevolutionReason = null;
  if (!rapid && !state.feedIssue && Number.isFinite(state.feed) && state.feed > 0 && [1, 25.4].includes(state.unitScale)) {
    if (state.feedMode === "per-revolution") feedPerRevolution = state.feed * state.unitScale;
    else if (state.feedMode === "per-minute") {
      if (!Number.isFinite(rpm) || rpm <= 0) feedPerRevolutionReason = "G98 feed per revolution requires a known, positive spindle RPM.";
      else if (Number.isFinite(feed.feed)) feedPerRevolution = feed.feed / rpm;
    }
    if (feedPerRevolution !== null && (!Number.isFinite(feedPerRevolution) || feedPerRevolution <= 0)) {
      feedPerRevolution = null;
      feedPerRevolutionReason = "Calculated feed per revolution exceeds the numeric range.";
    }
  }
  return {...state, commandedFeed: state.feed, rpm, feed: rapid ? null : feed.feed,
    feedPerRevolution, feedPerRevolutionReason, rapid, reasons};
}
