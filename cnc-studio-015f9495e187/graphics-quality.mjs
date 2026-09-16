export const GRAPHICS_QUALITY_PRESETS = Object.freeze({
  standard: Object.freeze({
    id: "standard",
    stockColumns: 600,
    contourRings: 600,
    axialRings: 160,
    radialSlices: 72,
    arcChordTolerance: 0.0254,
  }),
  fine: Object.freeze({
    id: "fine",
    stockColumns: 1800,
    contourRings: 1800,
    axialRings: 320,
    radialSlices: 128,
    arcChordTolerance: 0.00635,
  }),
  precision: Object.freeze({
    id: "precision",
    stockColumns: 4096,
    contourRings: 4096,
    axialRings: 640,
    radialSlices: 192,
    arcChordTolerance: 0.00254,
  }),
});

const INTERACTIVE_3D_PREVIEW = Object.freeze({
  ...GRAPHICS_QUALITY_PRESETS.standard,
  id: "interactive-preview",
  contourRings: 128,
  axialRings: 32,
  radialSlices: 16,
});

export function graphicsQualityPreset(id) {
  return GRAPHICS_QUALITY_PRESETS[id] || GRAPHICS_QUALITY_PRESETS.precision;
}

export function renderGraphicsQualityPreset(id, {interactive = false} = {}) {
  return interactive ? INTERACTIVE_3D_PREVIEW : graphicsQualityPreset(id);
}
