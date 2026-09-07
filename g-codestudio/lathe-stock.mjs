// Axisymmetric nominal cutting at exact axial stations. Source CAD meshes and
// display chords are never inputs. This is not a physical/compensated cutter,
// helical thread solid, holder collision model, or finished-part qualification.
import {turningSpindleIssue} from './tool-mounting.mjs';
const EPS = 1e-9;
const MAX_WORK = 4000000;
const MAX_INTERVALS = 64;
const OPS = new Set(['id-bore', 'od-groove', 'id-groove', 'parting', 'face-groove', 'od-thread', 'id-thread']);
const DIRECTIONS = new Set(['negative-z', 'positive-z', 'radial-only', 'both']);
const SQRT3 = Math.sqrt(3);
const TAU = Math.PI * 2;
const NUMERICAL_BUDGET_MM = 0.00127;

export function stockMaterialIntervals(stock, index) {
  if (!stock?.profile || !Number.isInteger(index) || index < 0 || index >= stock.profile.length) return [];
  const outer = stock.profile[index];
  if (!(outer > 0)) return [];
  const retained = stock.materialIntervals?.get(index);
  const source = retained ?? [[stock.pilotBoreRadius || 0, outer]];
  // Legacy OD operations may reduce profile without visiting every sparse
  // interval. Intersect on read so old external removal never resurrects stock.
  return source.flatMap(([low, high]) => {
    const a = Math.max(0, low), b = Math.min(outer, high);
    return b > a ? [[a, b]] : [];
  });
}

export function subtractRadialInterval(intervals, minimum, maximum) {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) return intervals.map(pair => [...pair]);
  const result = [];
  for (const [low, high] of intervals) {
    if (maximum <= low || minimum >= high) result.push([low, high]);
    else {
      if (minimum > low) result.push([low, Math.min(high, minimum)]);
      if (maximum < high) result.push([Math.max(low, maximum), high]);
    }
  }
  return result;
}

export function stockIntervalVolumes(stock) {
  let areaIntegral = 0;
  let previousArea = 0;
  for (let index = 0; index < stock.profile.length; index += 1) {
    const area = stockMaterialIntervals(stock, index).reduce((sum, [low, high]) => sum + (high - low) * (high + low), 0);
    if (index) areaIntegral += (previousArea + area) * 0.5 * (stock.zPositions[index] - stock.zPositions[index - 1]);
    previousArea = area;
  }
  const initialVolume = Math.PI * Math.max(0, stock.radius ** 2 - (stock.pilotBoreRadius || 0) ** 2) * stock.length;
  const remainingVolume = Math.max(0, Math.min(initialVolume, Math.PI * areaIntegral));
  return {initialVolume, remainingVolume, removedVolume: Math.max(0, initialVolume - remainingVolume),
    volumeApproximation: 'trapezoidal-axial-stations'};
}

const issue = (code, message) => ({code, message});
const finite = value => typeof value === 'number' && Number.isFinite(value);

function nativeArc(segment, xScale, stock, cutterRadius = 0) {
  const motion = segment.sourceMotion || segment.type;
  if (!['arc-cw', 'arc-ccw'].includes(motion) && !segment.center && segment.radius == null && segment.sweep == null) return null;
  const {center, radius, sweep, start, end} = segment;
  const invalid = message => ({problem: issue('nominal-arc-unresolved', message)});
  if (!center || !start || !end || ![center.z, center.x, radius, sweep, start.z, start.x, end.z, end.x].every(finite)
    || radius <= 0 || radius > 1e6 || !sweep || Math.abs(sweep) > TAU
    || (motion === 'arc-cw' && sweep > 0) || (motion === 'arc-ccw' && sweep < 0)) {
    return invalid('Native stock arcs require consistent finite center, radius, endpoints and directed sweep of at most one revolution.');
  }
  const sourceError = segment.geometryUncertaintyMm ?? 0;
  const scale = Math.max(1, radius, Math.abs(center.z), Math.abs(center.x), Math.abs(stock.startZ), Math.abs(stock.endZ),
    ...[start, end].flatMap(point => [Math.abs(point.z), Math.abs(point.x * xScale)]));
  const roundoff = Number.EPSILON * 128 * scale;
  if (!finite(sourceError) || sourceError < 0 || !finite(cutterRadius) || cutterRadius < 0) return invalid('Native arc uncertainty or cutter radius is unresolved.');
  const coordinateError = roundoff + sourceError;
  // A vertical circle tangent can amplify axial roundoff by a square root.
  // Bound both the path-circle and cutter-circle sensitivities in millimetres,
  // never an angular epsilon which grows without limit with the radius.
  // Minkowski addition of a fixed cutter does not amplify source Hausdorff
  // uncertainty. Its station envelope consists of circles of radius at most
  // R+r (and endpoint circles r): account for source uncertainty once at that
  // largest radius, then separately allow cutter-evaluation binary roundoff.
  const error = coordinateError + Math.sqrt(2 * (radius + cutterRadius) * coordinateError)
    + Math.sqrt(2 * cutterRadius * roundoff);
  if (!finite(error) || error > NUMERICAL_BUDGET_MM) return {problem: issue('nominal-numeric-unresolved', 'Native arc/cutter conditioning exceeds the 0.00127 mm numerical budget; no display chords were substituted.')};
  const first = Math.atan2(start.x * xScale - center.x, start.z - center.z), last = first + sweep;
  const startResidual = Math.abs(Math.hypot(start.z - center.z, start.x * xScale - center.x) - radius);
  const endResidual = Math.hypot(end.z - center.z - radius * Math.cos(last), end.x * xScale - center.x - radius * Math.sin(last));
  if (Math.max(startResidual, endResidual) > coordinateError * 4) return invalid('The exact native arc endpoints do not agree with its center, radius and sweep within retained roundoff.');
  const arc = {cz: center.z, cx: center.x, radius, first, last, sweep, coordinateError, error};
  const extrema = [first, last, ...arcAngles(arc, 0), ...arcAngles(arc, Math.PI), ...arcAngles(arc, Math.PI / 2), ...arcAngles(arc, -Math.PI / 2)];
  arc.minimumZ = center.z + radius * Math.min(...extrema.map(angle => Math.cos(angle)));
  arc.maximumZ = center.z + radius * Math.max(...extrema.map(angle => Math.cos(angle)));
  arc.minimumX = center.x + radius * Math.min(...extrema.map(angle => Math.sin(angle)));
  arc.maximumX = center.x + radius * Math.max(...extrema.map(angle => Math.sin(angle)));
  return arc;
}

// Lift a principal angle onto the actual unwrapped directed sweep. At most
// two copies exist (the two ends of a full circle). No broad angular slack.
function arcAngles(arc, principal) {
  const low = Math.min(arc.first, arc.last), high = Math.max(arc.first, arc.last);
  const result = [];
  for (let k = Math.ceil((low - principal) / TAU); k <= Math.floor((high - principal) / TAU); k += 1) result.push(principal + k * TAU);
  return result;
}

function cosineAngles(arc, distance, radius = arc.radius) {
  if (!radius) return [];
  const cosine = distance / radius;
  if (cosine < -1 || cosine > 1) return [];
  const principal = Math.acos(cosine);
  return [...arcAngles(arc, principal), ...arcAngles(arc, -principal)];
}

function directionAllowed(direction, beforeZ, afterZ) {
  const dz = afterZ - beforeZ;
  return !((direction === 'negative-z' && dz > EPS) || (direction === 'positive-z' && dz < -EPS)
    || (direction === 'radial-only' && Math.abs(dz) > EPS));
}

function arcDirectionAllowed(direction, arc) {
  const angles = [arc.first, arc.last, ...arcAngles(arc, 0), ...arcAngles(arc, Math.PI)]
    .sort((a, b) => arc.sweep > 0 ? a - b : b - a);
  return angles.slice(1).every((angle, index) => directionAllowed(direction,
    arc.radius * Math.cos(angles[index]), arc.radius * Math.cos(angle)));
}

function offsets(width, datum, face = false) {
  if (datum === 'center') return [-width / 2, width / 2];
  if (datum === (face ? 'inner-edge' : 'negative-z-edge')) return [0, width];
  if (datum === (face ? 'outer-edge' : 'positive-z-edge')) return [-width, 0];
  return null;
}

function validate(model, segment, stock, xScale, arc) {
  if (segment.verificationBlocked || segment.numericalResolutionBlocked || segment.liveToolBlocked || segment.machiningMode === 'live-tool' || segment.liveTool || segment.cAxisMotion
    || [segment.start, segment.end].some(point => ['y', 'c'].some(axis => finite(point?.[axis])))) {
    return issue('nominal-motion-unavailable', 'Blocked or non-axisymmetric motion cannot enter this nominal lathe stock model.');
  }
  if (!OPS.has(model.operation)) return issue('nominal-operation-unavailable', 'The nominal lathe operation is not supported.');
  if (model.nominalAccepted !== true || typeof model.nominalModelRef !== 'string' || !model.nominalModelRef
    || model.referenceSemantics !== 'nominal-cutter-datum' || model.simulationReady !== true) {
    return issue('nominal-setup-unconfirmed', 'Explicitly accept and confirm this nominal cutting model and programmed datum.');
  }
  if (model.mountingRequired !== true || !['standard', 'flipped'].includes(model.mountingOrientation)) {
    return issue('tool-mounting-unset', 'Choose the installed mounting orientation and reconfirm nominal cutting.');
  }
  const spindle = turningSpindleIssue(model, {direction: segment.spindleDirection, running: segment.spindleRunning});
  if (spindle) return spindle;
  if (!DIRECTIONS.has(model.axialDirection)) return issue('tool-direction-blocked', 'Choose an explicit permitted Z cutting direction.');
  if (![0.5, 1].includes(xScale)) return issue('nominal-x-mode-unresolved', 'Choose explicit diameter or radius X programming.');
  const sourceMotion = segment.sourceMotion || segment.type;
  if (arc && !['id-bore', 'od-groove', 'id-groove'].includes(model.operation)) {
    return issue('tool-arc-sweep-unsupported', 'Native arcs are supported for ID boring and OD/ID grooves; face grooves, part-off and thread sections retain their explicit straight-motion contract.');
  }
  if (arc?.problem) return arc.problem;
  if (!['linear', 'rough', 'finish', 'cycle-profile', 'arc-cw', 'arc-ccw'].includes(segment.type)) return issue('nominal-motion-unavailable', 'Only exact planar straight or supported native circular cutting moves are supported.');
  const points = [segment.start, segment.end];
  if (points.some(point => !point || ![point.z, point.x].every(finite)
    || Math.max(Math.abs(point.z), Math.abs(point.x)) > 1e9)) {
    return issue('nominal-coordinate-unresolved', 'Exact finite line endpoints within the nominal numerical budget are required.');
  }
  const numericalRadius = model.operation === 'id-bore' ? 0 : (model.noseRadius ?? model.cornerRadius);
  const scale = Math.max(1, ...points.flatMap(point => [Math.abs(point.z), Math.abs(point.x)]), Math.abs(stock.startZ), Math.abs(stock.endZ), stock.radius, model.width || 0);
  const coordinateBound = Number.EPSILON * 64 * scale;
  // Worst-case square-root sensitivity at a native circular corner; do not
  // advertise the .00127 mm numerical budget on ill-conditioned coordinates.
  if (!finite(scale) || !finite(numericalRadius) || numericalRadius < 0 || numericalRadius > 1e6
    || coordinateBound + Math.sqrt(2 * numericalRadius * coordinateBound) > 0.00127) {
    return issue('nominal-numeric-unresolved', 'Coordinate/corner conditioning exceeds the 0.00127 mm nominal numerical budget. Move the program origin closer or correct the dimensions.');
  }
  const dz = segment.end.z - segment.start.z;
  if (model.operation === 'parting' && Math.abs(dz) > EPS) return issue('nominal-parting-plunge-required', 'Part-off removal supports fixed-Z radial plunges only; traversing a cutoff blade is not inferred.');
  if (arc ? !arcDirectionAllowed(model.axialDirection, arc) : !directionAllowed(model.axialDirection, segment.start.z, segment.end.z)) {
    return issue('tool-direction-blocked', 'This move exceeds the explicitly permitted Z cutting direction.');
  }
  if (model.operation.startsWith('id-')) {
    if (!(stock.pilotBoreRadius > 0) || stock.pilotBoreValid === false) {
      return issue('nominal-pilot-bore-required', 'Enter an explicit existing through pilot-bore diameter before internal removal; a hole is never invented.');
    }
    if (!['positive-x', 'negative-x'].includes(model.wallSide)) return issue('nominal-wall-side-required', 'Choose the physical positive-X or negative-X bore wall.');
    const sign = model.wallSide === 'positive-x' ? 1 : -1;
    if (points.some(point => point.x * sign < -EPS) || (arc && (sign > 0 ? arc.minimumX : -arc.maximumX) < -EPS)) return issue('nominal-wall-side-mismatch', 'The native path crosses onto the opposite side of the explicitly selected bore wall.');
  } else if ((points.some(point => point.x < -EPS) || (arc && arc.minimumX < -EPS)) && model.operation !== 'parting') {
    return issue('nominal-center-crossing-unsupported', 'Only the explicit nominal part-off model supports crossing spindle center; other external cutters require nonnegative physical X.');
  }
  if (model.operation === 'id-bore') {
    if (model.tipDatum !== 'programmed-contact-point') return issue('tool-datum-unresolved', 'ID boring needs the programmed-contact-point datum; no nose compensation is inferred.');
  } else if (model.operation.endsWith('thread')) {
    if (model.tipDatum !== 'tip-center' || model.includedAngleDegrees !== 60
      || !finite(model.noseRadius ?? model.cornerRadius) || (model.noseRadius ?? model.cornerRadius) < 0) {
      return issue('nominal-thread-section-required', 'A declared 60-degree nominal section, nonnegative tip radius and tip-center datum are required.');
    }
    const threadCode = segment.threading?.code;
    const authorizedThread = threadCode === 'G32' || (threadCode === 'G76' && segment.threading.contract === 'haas-lathe-ngc-g76-v1');
    if (!authorizedThread || segment.threading.synchronized !== true
      || !finite(segment.threading.leadMmPerRev) || segment.threading.leadMmPerRev <= 0 || Math.abs(dz) <= EPS) {
      return issue('nominal-thread-motion-required', 'Thread removal requires a parser-authorized synchronized G32/G76 pass with a positive lead and axial travel; ordinary G01 is not threading.');
    }
    if (model.pitchRangeMm) {
      const range = model.pitchRangeMm;
      const lead = segment.threading.axialLeadMmPerRev ?? segment.threading.leadMmPerRev;
      if (!Array.isArray(range) || range.length !== 2 || !range.every(finite) || !finite(lead)
        || lead < range[0] || lead > range[1]) {
        return issue('nominal-thread-lead-range', 'The nominal single-start axial lead is outside this insert\'s published pitch range; multi-start/pitch-fit qualification is not modeled.');
      }
    }
  } else {
    if (!finite(model.width) || model.width <= EPS || model.width > 1e6
      || !finite(model.cornerRadius) || model.cornerRadius < 0 || model.cornerRadius > model.width / 2
      || !offsets(model.width, model.tipDatum, model.operation === 'face-groove')) {
      return issue('tool-datum-unresolved', 'Confirm a finite nominal width, valid corner radius, and explicit cutter-edge or center datum.');
    }
    if (model.operation === 'face-groove') {
      if (!['negative-z', 'positive-z'].includes(model.axialDirection) || Math.abs(segment.end.x - segment.start.x) > EPS) {
        return issue('nominal-face-plunge-required', 'Face-groove removal supports fixed-radius axial plunges only. Choose front (-Z) or back (+Z); radial/diagonal sweeps remain blocked.');
      }
      if (Math.abs(dz) <= EPS) return issue('nominal-face-plunge-required', 'Face grooving requires a nonzero axial plunge.');
      const range = offsets(model.width, model.tipDatum, true);
      if (segment.start.x * xScale + range[0] < -EPS) return issue('nominal-face-axis-crossing', 'The declared annular groove crosses the spindle axis. Correct its radial datum/position.');
      if (finite(model.minimumGrooveDiameter) && (segment.start.x * xScale + range[0]) * 2 < model.minimumGrooveDiameter - EPS) {
        return issue('nominal-minimum-groove-diameter', 'The nominal groove inner diameter is below the published holder minimum. Choose a suitable tool or groove position.');
      }
      if (finite(model.maximumCuttingDepth)) {
        const front = model.axialDirection === 'negative-z';
        const entry = front ? stock.materialEndZ : stock.startZ;
        const depth = (segment.end.z - entry) * (front ? -1 : 1);
        if (depth > model.maximumCuttingDepth + EPS) return issue('nominal-cutting-depth-exceeded', 'The cumulative face-groove depth from the stock entry face exceeds the published nominal cutting depth.');
      }
    }
  }
  if ((segment.threading || ['G32', 'G76'].includes(sourceMotion)) && !model.operation.endsWith('thread')) {
    return issue('nominal-thread-tool-required', 'Synchronized G32/G76 motion requires an explicitly accepted OD or ID thread-section model.');
  }
  return null;
}

// Piecewise convex support g(w). Circles retain native equations. A finite
// round groove has a straight front and two quarter circles; a thread section
// has a rounded tip and unbounded 60-degree flanks, clipped by actual stock.
function supportPieces(model) {
  if (model.operation.endsWith('thread')) {
    const r = model.noseRadius ?? model.cornerRadius;
    const tangent = r * Math.sqrt(3) / 2;
    return [
      {low: -Infinity, high: -tangent, slope: -SQRT3, intercept: -r},
      ...(r > 0 ? [{low: -tangent, high: tangent, center: 0, radius: r, base: r}] : []),
      {low: tangent, high: Infinity, slope: SQRT3, intercept: -r},
    ];
  }
  const [low, high] = offsets(model.width, model.tipDatum);
  const r = model.cornerRadius;
  if (!r) return [{low, high, slope: 0, intercept: 0}];
  return [
    {low, high: low + r, center: low + r, radius: r, base: r},
    {low: low + r, high: high - r, slope: 0, intercept: 0},
    {low: high - r, high, center: high - r, radius: r, base: r},
  ];
}

function supportValue(piece, offset) {
  if (!piece.radius) return piece.slope * offset + piece.intercept;
  const distance = Math.min(piece.radius, Math.abs(offset - piece.center));
  return piece.base - Math.sqrt(Math.max(0, (piece.radius - distance) * (piece.radius + distance)));
}

// Exact minimum of signed linear radius + a convex native support piece.
// The only candidates are the clipped endpoints and its analytic stationary
// point. No golden-section search, tessellation, or screen tolerance is used.
function minimumSupportAtStation(z, before, after, radialSign, pieces) {
  const dz = after.z - before.z, dr = after.r - before.r, w0 = z - before.z;
  let minimum = Infinity;
  for (const piece of pieces) {
    let a = 0, b = 1;
    if (!dz) {
      if (w0 < piece.low || w0 > piece.high) continue;
    } else {
      const first = (w0 - piece.high) / dz, second = (w0 - piece.low) / dz;
      a = Math.max(0, Math.min(first, second));
      b = Math.min(1, Math.max(first, second));
      if (a > b) continue;
    }
    const evaluate = t => {
      const w = Math.max(piece.low, Math.min(piece.high, w0 - dz * t));
      return radialSign * (before.r + dr * t) + supportValue(piece, w);
    };
    minimum = Math.min(minimum, evaluate(a), evaluate(b));
    if (piece.radius && dz) {
      const stationaryW = piece.center + piece.radius * radialSign * dr * Math.sign(dz) / Math.hypot(dz, dr);
      const t = (w0 - stationaryW) / dz;
      if (stationaryW >= piece.low && stationaryW <= piece.high && t > a && t < b) minimum = Math.min(minimum, evaluate(t));
    }
  }
  return minimum;
}

// Exact finite candidates for a native circular path plus native cutter
// support. At a circular-piece stationary contact, the path and cutter normals
// are parallel: (Z-cz-piece.center) = (R +/- r) cos(theta). Both offsets are
// retained; the lower-half condition selects the physically exposed support.
// Piece-boundary and sweep-end contacts complete the constrained minimum.
function minimumArcSupportAtStation(z, arc, radialSign, wallSign, pieces) {
  let minimum = Infinity;
  const signed = radialSign * wallSign;
  for (const piece of pieces) {
    const candidates = [{angle: arc.first}, {angle: arc.last}];
    for (const offset of [piece.low, piece.high]) {
      if (finite(offset)) for (const angle of cosineAngles(arc, z - arc.cz - offset)) candidates.push({angle, offset});
    }
    if (piece.radius) {
      for (const branch of [-1, 1]) {
        const radius = arc.radius + branch * piece.radius;
        for (const angle of cosineAngles(arc, z - arc.cz - piece.center, radius)) {
          if (branch * signed * Math.sin(angle) <= Number.EPSILON * 32) candidates.push({angle});
        }
      }
    } else {
      const principal = Math.atan2(-signed, piece.slope);
      for (const angle of [...arcAngles(arc, principal), ...arcAngles(arc, principal + Math.PI)]) candidates.push({angle});
    }
    for (const candidate of candidates) {
      const w = candidate.offset ?? (z - arc.cz - arc.radius * Math.cos(candidate.angle));
      if (w < piece.low - arc.coordinateError || w > piece.high + arc.coordinateError) continue;
      const support = supportValue(piece, Math.max(piece.low, Math.min(piece.high, w)));
      minimum = Math.min(minimum, signed * (arc.cx + arc.radius * Math.sin(candidate.angle)) + support);
    }
  }
  return minimum;
}

function removalAtStation(z, model, before, after, stockRadius, pieces, arc, wallSign) {
  if (model.operation === 'id-bore') {
    if (arc) {
      const candidates = cosineAngles(arc, z - arc.cz);
      // Endpoint equality is dimensional, not a widened angular sweep.
      if (z === before.z) candidates.push(arc.first);
      if (z === after.z) candidates.push(arc.last);
      return candidates.length ? [0, Math.max(...candidates.map(angle => wallSign * (arc.cx + arc.radius * Math.sin(angle))))] : null;
    }
    const dz = after.z - before.z;
    if (!dz) return z === before.z ? [0, Math.max(before.r, after.r)] : null;
    const t = (z - before.z) / dz;
    return t >= 0 && t <= 1 ? [0, before.r + (after.r - before.r) * t] : null;
  }
  if (model.operation === 'face-groove') {
    const sign = model.axialDirection === 'negative-z' ? -1 : 1;
    const travel = (after.z - before.z) * sign;
    const depth = (after.z - z) * sign;
    if (depth < 0 || depth > travel) return null;
    const [low, high] = offsets(model.width, model.tipDatum, true), r = model.cornerRadius;
    const trim = depth >= r ? 0 : r - Math.sqrt(Math.max(0, depth * (2 * r - depth)));
    return [before.r + low + trim, before.r + high - trim];
  }
  const internal = model.operation.startsWith('id-');
  const value = arc ? minimumArcSupportAtStation(z, arc, internal ? -1 : 1, wallSign, pieces)
    : minimumSupportAtStation(z, before, after, internal ? -1 : 1, pieces);
  if (!Number.isFinite(value)) return null;
  return internal ? [0, Math.max(0, -value)] : [Math.max(0, value), stockRadius];
}

export function applyNominalLatheSegment(stock, segment, model, xScale) {
  const arc = nativeArc(segment, xScale, stock, model.operation === 'id-bore' ? 0 : (model.cornerRadius || 0));
  const problem = validate(model, segment, stock, xScale, arc);
  if (problem) return {warning: problem};
  const wallSign = model.operation.startsWith('id-') && model.wallSide === 'negative-x' ? -1 : 1;
  const before = {z: segment.start.z, r: segment.start.x * xScale * wallSign};
  const after = {z: segment.end.z, r: segment.end.x * xScale * wallSign};
  const pieces = ['id-bore', 'face-groove'].includes(model.operation) ? null : supportPieces(model);
  let low = arc ? arc.minimumZ : Math.min(before.z, after.z), high = arc ? arc.maximumZ : Math.max(before.z, after.z);
  if (pieces) {
    low += pieces[0].low;
    high += pieces.at(-1).high;
  }
  const positions = stock.zPositions;
  // Binary search works on the authoritative station coordinates, including
  // future nonuniform stations, rather than reconstructing rounded indexes.
  let first = 0, upper = positions.length;
  while (first < upper) { const middle = (first + upper) >>> 1; if (positions[middle] < low) first = middle + 1; else upper = middle; }
  let last = first; upper = positions.length;
  while (last < upper) { const middle = (last + upper) >>> 1; if (positions[middle] <= high) last = middle + 1; else upper = middle; }
  // Native arc work is bounded by a fixed number of analytic candidates for
  // each native support piece, independent of display density and sweep size.
  const work = (last - first) * (arc ? (pieces ? 64 : 4) : 1);
  if ((stock.nominalWorkCount || 0) + work > MAX_WORK) return {warning: issue('nominal-stock-work-limit', 'Nominal stock station workload exceeded the bounded budget. Split the program; no partial cut was applied.')};
  const changes = [];
  const baselineKey = `${model.nominalModelRef}|${segment.toolKey || ''}`;
  const previousBaseline = stock.nominalEngagementBaselines?.get(baselineKey);
  const baselineUpdates = [];
  for (let index = first; index < last; index += 1) {
    const removal = removalAtStation(positions[index], model, before, after, stock.radius, pieces, arc, wallSign);
    if (!removal || removal[1] <= removal[0]) continue;
    if (!removal.every(Number.isFinite)) return {warning: issue('nominal-numeric-unresolved', 'Nominal envelope arithmetic is unresolved; no part of this cut was applied.')};
    const old = stockMaterialIntervals(stock, index);
    const internal = model.operation.startsWith('id-');
    const inner = old[0]?.[0] ?? stock.radius;
    if (internal && finite(model.minimumBoreDiameter) && inner * 2 < model.minimumBoreDiameter - EPS) {
      return {warning: issue('nominal-minimum-bore-diameter', 'The existing bore along this cut is below the tool\'s published minimum bore diameter. Enlarge the pilot with a suitable tool first; holder clearance is not otherwise qualified.')};
    }
    if (['od-groove', 'id-groove', 'parting'].includes(model.operation) && finite(model.maximumCuttingDepth)) {
      // Retain the first local stock/bore engagement surface for this exact
      // tool/model at each station. Repeated pecks cannot reset the depth limit.
      const baseline = previousBaseline?.get(index) ?? (internal ? inner : (old.at(-1)?.[1] || 0));
      // Part-off may intentionally travel past X0. That removes the kerf, but
      // still consumes the holder's declared radial reach beyond center.
      const externalBoundary = model.operation === 'parting'
        ? minimumSupportAtStation(positions[index], before, after, 1, pieces) : removal[0];
      const depth = internal ? removal[1] - baseline : baseline - externalBoundary;
      if (depth > model.maximumCuttingDepth + EPS) return {warning: issue('nominal-cutting-depth-exceeded', 'The cumulative nominal groove engagement exceeds the published cutting depth; smaller pecks do not reset that limit.')};
      if (!previousBaseline?.has(index)) baselineUpdates.push([index, baseline]);
    }
    const intervals = subtractRadialInterval(old, Math.max(0, removal[0]), Math.min(stock.radius, removal[1]));
    if (intervals.length > MAX_INTERVALS) return {warning: issue('nominal-interval-limit', 'Too many distinct radial material bands; no part of this cut was applied.')};
    if (JSON.stringify(old) !== JSON.stringify(intervals)) changes.push([index, intervals]);
  }
  // Commit only after the whole line has passed its numerical/resource checks.
  stock.materialIntervals ||= new Map();
  for (const [index, intervals] of changes) {
    stock.materialIntervals.set(index, intervals);
    stock.profile[index] = intervals.at(-1)?.[1] || 0;
  }
  if (baselineUpdates.length) {
    stock.nominalEngagementBaselines ||= new Map();
    stock.nominalEngagementBaselines.set(baselineKey, new Map([...(previousBaseline || []), ...baselineUpdates]));
  }
  stock.nominalWorkCount = (stock.nominalWorkCount || 0) + work;
  stock.nominalModeledCuts = (stock.nominalModeledCuts || 0) + 1;
  if (arc) {
    stock.nominalArcModeledCuts = (stock.nominalArcModeledCuts || 0) + 1;
    stock.nominalBoundaryErrorMm = Math.max(stock.nominalBoundaryErrorMm || 0, arc.error);
  }
  if (model.operation.endsWith('thread')) stock.threadEnvelopeCuts = (stock.threadEnvelopeCuts || 0) + 1;
  stock.materialModel = 'axisymmetric-radial-intervals';
  stock.nominalStock = true;
  return {warning: null, changedStations: changes.length};
}

function circleSweptIntervals(z, radius, before, after, arc, wallSign) {
  const pieces = [{low: -radius, high: radius, center: 0, radius, base: 0}];
  if (!arc) {
    const low = minimumSupportAtStation(z, before, after, 1, pieces);
    const high = -minimumSupportAtStation(z, before, after, -1, pieces);
    return finite(low) && finite(high) && high > low ? [[low, high]] : [];
  }
  // A station can intersect two disjoint parts of a circular sweep. Partition
  // the native angular domain at its exact +/- nose-radius crossings. Each
  // connected domain sweeps a connected radial interval; never bridge the two
  // sides of an annular sweep with a fabricated solid removal interval.
  const breaks = [arc.first, arc.last, ...cosineAngles(arc, z - arc.cz - radius),
    ...cosineAngles(arc, z - arc.cz + radius)].sort((a, b) => a - b);
  const result = [];
  for (let index = 1; index < breaks.length; index += 1) {
    const first = breaks[index - 1], last = breaks[index];
    if (last <= first) continue;
    const offset = z - arc.cz - arc.radius * Math.cos((first + last) / 2);
    if (Math.abs(offset) > radius) continue;
    const part = {...arc, first, last, sweep: last - first};
    const low = minimumArcSupportAtStation(z, part, 1, wallSign, pieces);
    const high = -minimumArcSupportAtStation(z, part, -1, wallSign, pieces);
    if (finite(low) && finite(high) && high > low) result.push([low, high]);
  }
  return result;
}

/** Consume only the separately resolved native NOSE-CENTER contract. This is
 * the swept circular nose itself, not the old point model's outside half-space.
 * A cut cannot silently remove unvisited outer material or refill an ID cavity.
 */
export function applyCompensatedLatheSegment(stock, segment, model, xScale) {
  const envelope = segment.cutterEnvelope;
  const fail = (code, message) => ({warning: issue(code, message)});
  if (segment.compensationResolved !== true || envelope?.kind !== 'nose-circle' || envelope.verified !== true
    || envelope.contract !== 'haas-lathe-ngc-nose-v1' || envelope.centerIsProgramReference !== true
    || envelope.referenceSemantics !== 'nose-center' || !finite(envelope.radiusMm) || envelope.radiusMm <= 0 || envelope.radiusMm > 1e6
    || !['od', 'id'].includes(envelope.materialSide) || !['positive-x', 'negative-x'].includes(envelope.wallSide)) {
    return fail('tool-nose-stock-contract-required', 'Resolve and confirm the explicit native nose-center/radius contract before compensated stock removal.');
  }
  const internal = envelope.materialSide === 'id', radius = envelope.radiusMm;
  if ((internal && (model.mode !== 'nominal-lathe' || model.operation !== 'id-bore' || model.wallSide !== envelope.wallSide))
    || (!internal && (model.mode !== 'point' || model.referenceSemantics !== 'programmed-contact-point' || envelope.wallSide !== 'positive-x'))) {
    return fail('tool-nose-model-mismatch', 'Compensated stock requires the matching positive-X OD turning model or explicitly selected ID-boring wall; a generic groove/thread cutter cannot substitute.');
  }
  const arc = nativeArc(segment, xScale, stock, radius);
  if (arc?.problem) return {warning: arc.problem};
  if (internal) {
    const problem = validate(model, segment, stock, xScale, arc);
    if (problem) return {warning: problem};
  } else {
    if (model.simulationReady !== true || model.mountingRequired !== true || !['standard', 'flipped'].includes(model.mountingOrientation)
      || !DIRECTIONS.has(model.axialDirection)) return fail('tool-nose-setup-unconfirmed', 'Confirm this exact OD tool, installed mounting and permitted cutting direction before compensated removal.');
    const spindle = turningSpindleIssue(model, {direction: segment.spindleDirection, running: segment.spindleRunning});
    if (spindle) return {warning: spindle};
  }
  if (segment.verificationBlocked || segment.numericalResolutionBlocked || segment.compensationPending || segment.liveToolBlocked || segment.liveTool
    || segment.machiningMode === 'live-tool' || segment.cAxisMotion || segment.threading
    || ![0.5, 1].includes(xScale) || !['linear', 'arc-cw', 'arc-ccw'].includes(segment.type)
    || [segment.start, segment.end].some(point => !point || ![point.x, point.z].every(finite)
      || ['y', 'c'].some(axis => finite(point[axis])))) return fail('tool-nose-motion-unavailable', 'Unresolved, synchronized, non-planar or unsupported motion cannot authorize a nose-circle stock sweep.');
  const wallSign = envelope.wallSide === 'negative-x' ? -1 : 1;
  const before = {z: segment.start.z, r: segment.start.x * xScale * wallSign};
  const after = {z: segment.end.z, r: segment.end.x * xScale * wallSign};
  if (arc ? !arcDirectionAllowed(model.axialDirection, arc) : !directionAllowed(model.axialDirection, before.z, after.z)) {
    return fail('tool-direction-blocked', 'The compensated native path exceeds the explicitly confirmed Z cutting direction.');
  }
  const minimumRadius = arc ? (wallSign > 0 ? arc.minimumX : -arc.maximumX) : Math.min(before.r, after.r);
  if (minimumRadius < radius) return fail('tool-nose-center-crossing-unsupported', 'This compensated circular nose crosses the spindle axis; center-folded stock/holder behavior is not inferred.');
  const sourceError = segment.geometryUncertaintyMm ?? 0;
  const scale = Math.max(1, radius, stock.radius, Math.abs(stock.startZ), Math.abs(stock.endZ),
    Math.abs(before.z), Math.abs(after.z), Math.abs(before.r), Math.abs(after.r));
  const coordinateError = Number.EPSILON * 128 * scale + sourceError;
  const error = arc?.error ?? (coordinateError + Math.sqrt(2 * radius * coordinateError));
  if (!finite(sourceError) || sourceError < 0 || !finite(error) || error > NUMERICAL_BUDGET_MM) return fail('nominal-numeric-unresolved', 'Nose-circle coordinate conditioning exceeds the 0.00127 mm numerical budget.');
  const low = (arc ? arc.minimumZ : Math.min(before.z, after.z)) - radius;
  const high = (arc ? arc.maximumZ : Math.max(before.z, after.z)) + radius;
  const changes = [];
  let work = 0;
  for (let index = 0; index < stock.zPositions.length; index += 1) {
    const z = stock.zPositions[index];
    if (z < low || z > high) continue;
    work += arc ? 128 : 8;
    if ((stock.nominalWorkCount || 0) + work > MAX_WORK) return fail('nominal-stock-work-limit', 'Nose-circle analytic workload exceeded the bounded budget; no partial cut was applied.');
    const removals = circleSweptIntervals(z, radius, before, after, arc, wallSign);
    if (!removals.length) continue;
    const old = stockMaterialIntervals(stock, index);
    if (internal && finite(model.minimumBoreDiameter) && (old[0]?.[0] ?? stock.radius) * 2 < model.minimumBoreDiameter - EPS) {
      return fail('nominal-minimum-bore-diameter', 'The existing bore along the nose sweep is below the tool\'s published minimum; no holder-clearance claim is made.');
    }
    let intervals = old;
    for (const [a, b] of removals) intervals = subtractRadialInterval(intervals, Math.max(0, a), Math.min(stock.radius, b));
    if (intervals.length > MAX_INTERVALS) return fail('nominal-interval-limit', 'Too many radial material bands; no part of this compensated cut was applied.');
    if (JSON.stringify(old) !== JSON.stringify(intervals)) changes.push([index, intervals]);
  }
  stock.materialIntervals ||= new Map();
  for (const [index, intervals] of changes) {
    stock.materialIntervals.set(index, intervals);
    stock.profile[index] = intervals.at(-1)?.[1] || 0;
  }
  stock.nominalWorkCount = (stock.nominalWorkCount || 0) + work;
  stock.compensatedModeledCuts = (stock.compensatedModeledCuts || 0) + 1;
  stock.nominalBoundaryErrorMm = Math.max(stock.nominalBoundaryErrorMm || 0, error);
  stock.materialModel = 'axisymmetric-radial-intervals';
  stock.nominalStock = true;
  return {warning: null, changedStations: changes.length};
}
