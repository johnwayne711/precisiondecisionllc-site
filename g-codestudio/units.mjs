export function scaleForUnits(units) {
  return units === "inch" ? 25.4 : 1;
}

export function toMillimeters(value, units) {
  return Number(value) * scaleForUnits(units);
}

export function fromMillimeters(value, units) {
  return Number(value) / scaleForUnits(units);
}

export function convertUnitValue(value, fromUnits, toUnits) {
  return fromMillimeters(toMillimeters(value, fromUnits), toUnits);
}

