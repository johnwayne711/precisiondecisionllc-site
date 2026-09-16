const SPINDLE_DIRECTIONS = new Set(["m3", "m4"]);

// Compare an explicitly configured mounted setup with executed spindle state.
// Tool hand and mounting orientation never imply either M3 or M4 here.
// This is a setup consistency check, not physical machine/collision proof.
export function turningSpindleIssue(model, spindleState) {
  if (model?.mountingRequired !== true) return null;
  const expected = model.requiredSpindleDirection;
  if (!SPINDLE_DIRECTIONS.has(expected)) {
    return {
      code: "tool-spindle-required",
      message: "Select the required spindle direction, M3 or M4, for this mounted tool setup.",
    };
  }
  const required = expected.toUpperCase();
  if (spindleState?.running === false) {
    return {
      code: "tool-spindle-stopped",
      message: `Spindle stopped (M5): this mounted tool setup requires ${required} running for cutting.`,
    };
  }
  if (!SPINDLE_DIRECTIONS.has(spindleState?.direction) || spindleState?.running !== true) {
    return {
      code: "tool-spindle-unknown",
      message: `Executed spindle direction/running state is unknown; this mounted tool setup requires ${required} running.`,
    };
  }
  if (spindleState.direction !== expected) {
    return {
      code: "tool-spindle-mismatch",
      message: `M3/M4 mismatch: program commands ${spindleState.direction.toUpperCase()}, but this mounted tool setup requires ${required}.`,
    };
  }
  return null;
}
