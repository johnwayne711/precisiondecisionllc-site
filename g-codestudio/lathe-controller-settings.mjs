// Explicit local machine-setting declarations. Missing numbers remain unknown.
export const HAAS_G76_CONTRACT = 'haas-lathe-ngc-g76-v1';
export function latheControllerSettings(value, machineId) {
  const number = input => typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : null;
  if (!value || value.machineId !== machineId) return {machineId, contract: HAAS_G76_CONTRACT,
    finishAllowanceMm: null, minimumCutMm: null, defaultP: null, chamferEnabled: null};
  return {machineId, contract: HAAS_G76_CONTRACT,
    finishAllowanceMm: number(value.finishAllowanceMm), minimumCutMm: number(value.minimumCutMm),
    defaultP: [1, 2, 3, 4].includes(value.defaultP) ? value.defaultP : null,
    chamferEnabled: value.chamferEnabled === false ? false : null};
}
