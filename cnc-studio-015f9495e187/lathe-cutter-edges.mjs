// Analytic nominal ACTIVE cutting edges, independent of CAD/display meshes.
// These curves do not describe a holder, chipbreaker or complete insert solid.
import {nominalLatheCuttingDefinition} from './tool-lathe-cutting.mjs';

const line = (start, end) => ({type: 'line', start, end, metadataUncertaintyMm: 0});
function arc(center, radius, startAngle, sweep) {
  const point = angle => ({z: center.z + radius * Math.cos(angle), x: center.x + radius * Math.sin(angle)});
  return {type: 'arc', center, radius, startAngle, sweep,
    start: point(startAngle), end: point(startAngle + sweep), metadataUncertaintyMm: 0};
}
function transform(curve, map, determinant) {
  if (curve.type === 'line') return line(map(curve.start), map(curve.end));
  const center = map(curve.center), start = map(curve.start);
  return {...curve, center, start, end: map(curve.end),
    startAngle: Math.atan2(start.x - center.x, start.z - center.z), sweep: curve.sweep * determinant};
}

/** Return null for a point-only/unconfirmed model: never invent its nose datum. */
export function nominalCutterEdges(model, {threadFlankHeightMm} = {}) {
  const spec = nominalLatheCuttingDefinition(model?.id);
  if (!spec || model.mode !== 'nominal-lathe' || model.simulationReady !== true
    || model.nominalAccepted !== true || model.nominalModelRef !== spec.nominalModelRef
    || !spec.tipDatumChoices.includes(model.tipDatum)
    || !spec.axialDirectionChoices.includes(model.axialDirection)
    || !['standard', 'flipped'].includes(model.mountingOrientation)
    || !['m3', 'm4'].includes(model.requiredSpindleDirection)) return null;
  if (spec.operation === 'id-bore') return null;
  const inside = spec.operation.startsWith('id-');
  if (inside && !spec.wallSideChoices.includes(model.wallSide)) return null;
  const wall = inside && model.wallSide === 'negative-x' ? -1 : 1;
  const radial = inside ? -wall : 1;
  const r = spec.cornerRadius;
  if (spec.operation.endsWith('thread')) {
    // The retained nominal thread model has unbounded 60-degree flanks. Clip
    // only beyond the whole reference/path radial reach, never to a mesh size.
    if (!Number.isFinite(threadFlankHeightMm) || threadFlankHeightMm < r || threadFlankHeightMm > 1e6) return null;
    const tangent = r * Math.sqrt(3) / 2;
    const extent = (threadFlankHeightMm + r) / Math.sqrt(3);
    const curves = [
      line({z: -extent, x: threadFlankHeightMm}, {z: -tangent, x: r / 2}),
      arc({z: 0, x: r}, r, Math.PI * 7 / 6, Math.PI * 2 / 3),
      line({z: tangent, x: r / 2}, {z: extent, x: threadFlankHeightMm}),
    ];
    return curves.map(curve => transform(curve, p => ({z: p.z, x: p.x * radial}), radial));
  }
  const width = spec.width;
  const datum = model.tipDatum;
  const low = ['negative-z-edge', 'inner-edge'].includes(datum) ? 0
    : ['positive-z-edge', 'outer-edge'].includes(datum) ? -width : -width / 2;
  const high = low + width;
  const curves = [
    arc({z: low + r, x: r}, r, Math.PI, Math.PI / 2),
    line({z: low + r, x: 0}, {z: high - r, x: 0}),
    arc({z: high - r, x: r}, r, Math.PI * 1.5, Math.PI / 2),
  ].filter(curve => curve.type !== 'line' || Math.hypot(curve.end.z - curve.start.z, curve.end.x - curve.start.x) > 0);
  if (spec.operation === 'face-groove') {
    const trailing = model.axialDirection === 'negative-z' ? 1 : -1;
    return curves.map(curve => transform(curve, p => ({z: trailing * p.x, x: p.z}), -trailing));
  }
  return curves.map(curve => transform(curve, p => ({z: p.z, x: radial * p.x}), radial));
}

export function nominalNoseCircle(radiusMm) {
  if (!Number.isFinite(radiusMm) || radiusMm <= 0 || radiusMm > 1000) return null;
  return [arc({z: 0, x: 0}, radiusMm, 0, Math.PI * 2)];
}
