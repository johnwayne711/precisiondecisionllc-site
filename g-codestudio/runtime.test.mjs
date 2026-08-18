import assert from "node:assert/strict";
import test from "node:test";

import {parseGcode} from "./gcode.mjs";
import {estimateCycleTime, formatCycleTime} from "./runtime.mjs";

test("estimates G95 cutting time from feed per revolution and fixed RPM", () => {
  const parsed = parseGcode(`G20 G95
G97 S1000 M03
G1 Z-1.000 F0.010`, {
    xMode: "diameter",
    initialPosition: {x: 50.8, z: 0},
    defaultUnits: "inch",
  });
  const estimate = estimateCycleTime(parsed, {xScale: 0.5});
  assert.equal(parsed.segments.length, 1);
  assert.equal(estimate.complete, true);
  assert.ok(Math.abs(estimate.seconds - 6) < 1e-9);
});

test("estimates G94 feed-per-minute motion and G04 dwell", () => {
  const parsed = parseGcode(`G21 G94
G1 Z-100 F50
G04 P2500`, {
    initialPosition: {x: 20, z: 0},
    defaultUnits: "mm",
  });
  const estimate = estimateCycleTime(parsed);
  assert.ok(Math.abs(estimate.cuttingSeconds - 120) < 1e-9);
  assert.equal(estimate.dwellSeconds, 2.5);
  assert.equal(estimate.seconds, 122.5);
});

test("uses independent axis limits instead of adding diagonal rapid durations", () => {
  const parsed = {
    segments: [{
      type: "rapid",
      points: [{x: 0, z: 0}, {x: 25.4, z: 50.8}],
    }],
  };
  const estimate = estimateCycleTime(parsed, {rapidXMax: 254, rapidZMax: 508});
  assert.ok(Math.abs(estimate.rapidSeconds - 6) < 1e-9);
  assert.equal(estimate.complete, true);
});

test("estimates G96 constant-surface-speed motion with a G50 RPM limit", () => {
  const parsed = parseGcode(`G20 G95
G50 S2000
G96 S600 M03
G1 Z-1.000 F0.010`, {
    xMode: "diameter",
    initialPosition: {x: 12.7, z: 0},
    defaultUnits: "inch",
  });
  const estimate = estimateCycleTime(parsed, {xScale: 0.5});
  assert.equal(parsed.warnings.length, 0);
  assert.equal(estimate.complete, true);
  assert.ok(Math.abs(estimate.seconds - 3) < 1e-9);
});

test("propagates modal timing data to generated G71 cutting moves", () => {
  const parsed = parseGcode(`G18 G20 G90 G95
G97 S1200 M03
G0 X2.0 Z0.1
G71 U0.1 R0.05
G71 P100 Q120 U0.02 W0.01 F0.01
N100 G0 X1.0
N110 G1 Z-0.5
N120 X1.2`, {
    xMode: "diameter",
    initialPosition: {x: 50.8, z: 2.54},
    rapidBehavior: "dogleg",
    rapidXMax: 24000,
    rapidZMax: 30000,
    defaultUnits: "inch",
  });
  const generatedCuts = parsed.segments.filter((segment) => segment.generated && segment.type !== "rapid");
  assert.ok(generatedCuts.length > 0);
  assert.ok(generatedCuts.every((segment) => segment.feed === 0.01));
  assert.ok(generatedCuts.every((segment) => segment.feedMode === "per-revolution"));
  assert.ok(generatedCuts.every((segment) => segment.spindleMode === "rpm" && segment.spindleSpeed === 1200));
  const estimate = estimateCycleTime(parsed, {xScale: 0.5, rapidXMax: 24000, rapidZMax: 30000});
  assert.equal(estimate.untimedSegments, 0);
  assert.ok(estimate.seconds > 0);
});

test("marks an estimate incomplete when rapid-rate data is unavailable", () => {
  const parsed = {segments: [{type: "rapid", points: [{x: 0, z: 0}, {x: 10, z: 0}]}]};
  const estimate = estimateCycleTime(parsed);
  assert.equal(estimate.hasEstimate, false);
  assert.equal(estimate.complete, false);
  assert.equal(estimate.untimedSegments, 1);
});

test("formats cycle time for minute and hour durations", () => {
  assert.equal(formatCycleTime(65), "01:05");
  assert.equal(formatCycleTime(3661), "1:01:01");
});
