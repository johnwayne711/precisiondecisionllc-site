import {stockPlacement} from "./simulation.mjs";

// Keep setup arithmetic error below one tenth of the 0.0005 in path tolerance.
const MAX_SETUP_ERROR_MM = 0.00127;

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number.`);
  }
  return value;
}

function positiveNumber(value, label) {
  finiteNumber(value, label);
  if (value <= 0) throw new RangeError(`${label} must be greater than zero.`);
  return value;
}

/** Independent round-bar dimensions, in canonical millimeters. The front stays fixed. */
export function roundBarSetup({diameter, stickoutLength, gripLength, frontZ, pilotBoreDiameter} = {}) {
  positiveNumber(diameter, "Bar diameter");
  finiteNumber(stickoutLength, "Stick-out");
  finiteNumber(gripLength, "Grip length");
  finiteNumber(frontZ, "Stock front Z");
  if (stickoutLength < 0) throw new RangeError("Stick-out cannot be negative.");
  if (gripLength < 0) throw new RangeError("Grip length cannot be negative.");
  const length = positiveNumber(stickoutLength + gripLength, "Overall length");
  const faceZ = finiteNumber(frontZ - stickoutLength, "Calculated jaw face Z");
  const startZ = finiteNumber(faceZ - gripLength, "Calculated stock back Z");
  const magnitude = Math.max(diameter, length, Math.abs(frontZ), Math.abs(faceZ), Math.abs(startZ));
  if (magnitude * Number.EPSILON * 8 > MAX_SETUP_ERROR_MM) {
    throw new RangeError("Stock dimensions or coordinates are too large to retain 0.00005 in setup precision.");
  }
  const result = {diameter, length, stickoutLength, gripLength, frontZ, faceZ, startZ, endZ: frontZ};
  if (pilotBoreDiameter !== undefined) {
    finiteNumber(pilotBoreDiameter, "Starting through-bore diameter");
    if (pilotBoreDiameter < 0 || pilotBoreDiameter >= diameter) {
      throw new RangeError("Starting through-bore diameter must be zero (solid bar) or smaller than the bar diameter.");
    }
    result.pilotBoreDiameter = pilotBoreDiameter;
  }
  return result;
}

/** Upgrade the previous overall-length/jaw-face setup without repositioning stock. */
export function roundBarSetupFromLegacy({diameter, length, gripLength, faceZ, pilotBoreDiameter} = {}) {
  positiveNumber(diameter, "Bar diameter");
  positiveNumber(length, "Overall length");
  finiteNumber(gripLength, "Grip length");
  finiteNumber(faceZ, "Jaw face Z");
  const placement = stockPlacement(length, faceZ, gripLength);
  return roundBarSetup({
    diameter,
    stickoutLength: placement.stickoutLength,
    gripLength: placement.gripLength,
    frontZ: placement.endZ,
    pilotBoreDiameter,
  });
}
