import createOpenCascade from "./vendor/occt/3.0.2/opencascade_single.js";

const MEBIBYTE = 1024 * 1024;
const TAU = Math.PI * 2;
const SOURCE_PATH = "/gcode-studio-step-source.step";
const AXES = new Set(["x", "y", "z"]);

export const STEP_KERNEL_LIMITS = Object.freeze({
  maxSourceBytes: 25 * MEBIBYTE,
  maxStepEntities: 200_000,
  maxShells: 2_048,
  maxFaces: 20_000,
  maxWires: 40_000,
  maxEdges: 50_000,
  maxVertices: 100_000,
  maxSectionEdges: 4_096,
  maxSectionVertices: 8_192,
  maxCoordinateAbsMm: 1_000_000_000,
  maxWasmMemoryBytes: 512 * MEBIBYTE,
  maxImportElapsedMs: 60_000,
  maxSectionElapsedMs: 30_000,
  maxToleranceMm: 0.00127,
});

const KERNEL_ASSETS = Object.freeze({
  packageName: "libcascade",
  packageVersion: "3.0.2",
  packageIntegrity: "sha512-btp/dg/YHO6jhkDmgXNqFyLtWXhL8LlrJwZ0aPw5FD4+kCys0Qfc//dNUlYitZIm+kBym4ZA63/cFrBVhR4yPQ==",
  glue: Object.freeze({
    file: "opencascade_single.js",
    bytes: 65_975,
    sha256: "69545c40dc9ae80b17c694f655913ab6974fea1b1fafdf018f05ffb1e6ac4529",
  }),
  wasm: Object.freeze({
    bytes: 42_691_285,
    sha256: "faa8e6d9180bcd59fbd02101ccf96892b88a23bdd3865e3ed33df48fb65a3fca",
    chunks: Object.freeze([
      Object.freeze({file: "opencascade_single.wasm.part-000", bytes: 16_777_216, sha256: "f782e4be2918c7a1cba2bcc1c9d944754e12f61fc755fad3b6f1c94593d9f3cf"}),
      Object.freeze({file: "opencascade_single.wasm.part-001", bytes: 16_777_216, sha256: "30262c448aa32357184acb222ffffa21f22f114ebb37aac88a6614700ee6ce5d"}),
      Object.freeze({file: "opencascade_single.wasm.part-002", bytes: 9_136_853, sha256: "cf50586d33258debe626431f7ebf10f4b4020293181f0f4aadbb23b44bf439a3"}),
    ]),
  }),
});

export const STEP_KERNEL_IDENTITY = Object.freeze({
  name: "Open CASCADE Technology",
  version: "8.0.1 (libcascade 3.0.2)",
  buildHash: KERNEL_ASSETS.wasm.sha256,
});

const TOPOLOGY_SPECS = Object.freeze([
  Object.freeze({key: "solidCount", type: "TopAbs_SOLID", limit: 1}),
  Object.freeze({key: "shellCount", type: "TopAbs_SHELL", limit: STEP_KERNEL_LIMITS.maxShells}),
  Object.freeze({key: "faceCount", type: "TopAbs_FACE", limit: STEP_KERNEL_LIMITS.maxFaces}),
  Object.freeze({key: "wireCount", type: "TopAbs_WIRE", limit: STEP_KERNEL_LIMITS.maxWires}),
  Object.freeze({key: "edgeCount", type: "TopAbs_EDGE", limit: STEP_KERNEL_LIMITS.maxEdges}),
  Object.freeze({key: "vertexCount", type: "TopAbs_VERTEX", limit: STEP_KERNEL_LIMITS.maxVertices}),
]);

const UNIT_TABLE = new Map([
  ["millimeter", {name: "millimeter", millimetersPerUnit: 1}],
  ["millimeters", {name: "millimeter", millimetersPerUnit: 1}],
  ["millimetre", {name: "millimeter", millimetersPerUnit: 1}],
  ["millimetres", {name: "millimeter", millimetersPerUnit: 1}],
  ["mm", {name: "millimeter", millimetersPerUnit: 1}],
  ["centimeter", {name: "centimeter", millimetersPerUnit: 10}],
  ["centimeters", {name: "centimeter", millimetersPerUnit: 10}],
  ["centimetre", {name: "centimeter", millimetersPerUnit: 10}],
  ["centimetres", {name: "centimeter", millimetersPerUnit: 10}],
  ["cm", {name: "centimeter", millimetersPerUnit: 10}],
  ["meter", {name: "meter", millimetersPerUnit: 1_000}],
  ["meters", {name: "meter", millimetersPerUnit: 1_000}],
  ["metre", {name: "meter", millimetersPerUnit: 1_000}],
  ["metres", {name: "meter", millimetersPerUnit: 1_000}],
  ["m", {name: "meter", millimetersPerUnit: 1_000}],
  ["micrometer", {name: "micrometer", millimetersPerUnit: 0.001}],
  ["micrometers", {name: "micrometer", millimetersPerUnit: 0.001}],
  ["micrometre", {name: "micrometer", millimetersPerUnit: 0.001}],
  ["micrometres", {name: "micrometer", millimetersPerUnit: 0.001}],
  ["um", {name: "micrometer", millimetersPerUnit: 0.001}],
  ["inch", {name: "inch", millimetersPerUnit: 25.4}],
  ["inches", {name: "inch", millimetersPerUnit: 25.4}],
  ["in", {name: "inch", millimetersPerUnit: 25.4}],
  ["foot", {name: "foot", millimetersPerUnit: 304.8}],
  ["feet", {name: "foot", millimetersPerUnit: 304.8}],
  ["ft", {name: "foot", millimetersPerUnit: 304.8}],
]);

export class StepKernelError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StepKernelError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new StepKernelError(code, message);
}

function dispose(...values) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    try {
      values[index]?.delete?.();
    } catch {
      // Disposal must not replace the dimensional result or its diagnostic.
    }
  }
}

function finiteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function pointDto(point) {
  const result = {x: point.X(), y: point.Y(), z: point.Z()};
  if (!Object.values(result).every(Number.isFinite)
    || Object.values(result).some((value) => Math.abs(value) > STEP_KERNEL_LIMITS.maxCoordinateAbsMm)) {
    fail("STEP_COORDINATE_LIMIT", "STEP geometry contains a non-finite or out-of-range coordinate.");
  }
  return Object.fromEntries(Object.entries(result).map(([axis, value]) => [axis, Object.is(value, -0) ? 0 : value]));
}

function directionDto(direction) {
  const result = {x: direction.X(), y: direction.Y(), z: direction.Z()};
  if (!Object.values(result).every(Number.isFinite)) {
    fail("STEP_DIRECTION_INVALID", "STEP geometry contains an invalid analytic direction.");
  }
  return Object.fromEntries(Object.entries(result).map(([axis, value]) => [axis, Object.is(value, -0) ? 0 : value]));
}

function distance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y, second.z - first.z);
}

function reverseVector(value) {
  return {x: -value.x, y: -value.y, z: -value.z};
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes, cryptoImpl) {
  if (!cryptoImpl?.subtle?.digest) fail("STEP_CRYPTO_UNAVAILABLE", "SHA-256 verification is unavailable in this browser.");
  return bytesToHex(await cryptoImpl.subtle.digest("SHA-256", bytes));
}

function sameAsset(actual, expected) {
  return actual?.file === expected.file
    && actual?.bytes === expected.bytes
    && actual?.sha256 === expected.sha256;
}

function validateManifest(manifest) {
  const valid = manifest?.schemaVersion === 1
    && manifest?.package?.name === KERNEL_ASSETS.packageName
    && manifest?.package?.version === KERNEL_ASSETS.packageVersion
    && manifest?.package?.integrity === KERNEL_ASSETS.packageIntegrity
    && manifest?.runtime?.wasm?.bytes === KERNEL_ASSETS.wasm.bytes
    && manifest?.runtime?.wasm?.sha256 === KERNEL_ASSETS.wasm.sha256
    && sameAsset({file: KERNEL_ASSETS.glue.file, ...manifest?.runtime?.vendoredGlue}, KERNEL_ASSETS.glue)
    && Array.isArray(manifest?.runtime?.wasm?.chunks)
    && manifest.runtime.wasm.chunks.length === KERNEL_ASSETS.wasm.chunks.length
    && manifest.runtime.wasm.chunks.every((asset, index) => sameAsset(asset, KERNEL_ASSETS.wasm.chunks[index]));
  if (!valid) fail("STEP_KERNEL_MANIFEST_MISMATCH", "The local STEP kernel asset manifest does not match the reviewed build.");
}

async function fetchBytes(fetchImpl, url, expected, cryptoImpl) {
  let response;
  try {
    response = await fetchImpl(url, {cache: "force-cache", credentials: "same-origin"});
  } catch {
    fail("STEP_KERNEL_ASSET_UNAVAILABLE", "A local STEP kernel asset could not be loaded.");
  }
  if (!response?.ok) fail("STEP_KERNEL_ASSET_UNAVAILABLE", "A local STEP kernel asset could not be loaded.");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== expected.bytes || await sha256(buffer, cryptoImpl) !== expected.sha256) {
    fail("STEP_KERNEL_ASSET_MISMATCH", "A local STEP kernel asset failed its exact size or SHA-256 check.");
  }
  return new Uint8Array(buffer);
}

async function instantiateKernel({fetchImpl, cryptoImpl, assetBaseUrl}) {
  let manifestResponse;
  try {
    manifestResponse = await fetchImpl(new URL("asset-manifest.json", assetBaseUrl), {
      cache: "force-cache",
      credentials: "same-origin",
    });
  } catch {
    fail("STEP_KERNEL_MANIFEST_UNAVAILABLE", "The local STEP kernel asset manifest could not be loaded.");
  }
  if (!manifestResponse?.ok) fail("STEP_KERNEL_MANIFEST_UNAVAILABLE", "The local STEP kernel asset manifest could not be loaded.");
  let manifest;
  try {
    manifest = await manifestResponse.json();
  } catch {
    fail("STEP_KERNEL_MANIFEST_INVALID", "The local STEP kernel asset manifest is not valid JSON.");
  }
  validateManifest(manifest);

  const wasmBytes = new Uint8Array(KERNEL_ASSETS.wasm.bytes);
  let offset = 0;
  for (const asset of KERNEL_ASSETS.wasm.chunks) {
    const chunk = await fetchBytes(fetchImpl, new URL(asset.file, assetBaseUrl), asset, cryptoImpl);
    wasmBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (offset !== KERNEL_ASSETS.wasm.bytes || await sha256(wasmBytes, cryptoImpl) !== KERNEL_ASSETS.wasm.sha256) {
    fail("STEP_KERNEL_REASSEMBLY_MISMATCH", "The reassembled local STEP kernel failed its exact SHA-256 check.");
  }

  let compiled;
  try {
    compiled = await WebAssembly.compile(wasmBytes);
  } catch {
    fail("STEP_KERNEL_COMPILE_FAILED", "The reviewed local STEP kernel could not be compiled.");
  }
  wasmBytes.fill(0);

  try {
    const module = await createOpenCascade({
      print() {},
      printErr() {},
      instantiateWasm(imports, receiveInstance) {
        const instance = new WebAssembly.Instance(compiled, imports);
        receiveInstance(instance, compiled);
        return instance.exports;
      },
    });
    ensureMemoryLimit(module);
    return module;
  } catch (error) {
    if (error instanceof StepKernelError) throw error;
    fail("STEP_KERNEL_START_FAILED", "The reviewed local STEP kernel could not be started.");
  }
}

function ensureMemoryLimit(module) {
  const bytes = module?.wasmMemory?.buffer?.byteLength;
  if (!Number.isSafeInteger(bytes) || bytes > STEP_KERNEL_LIMITS.maxWasmMemoryBytes) {
    fail("STEP_KERNEL_MEMORY_LIMIT", "The STEP kernel exceeded its 512 MiB WebAssembly-memory ceiling.");
  }
}

function ensureElapsed(startedAt, ceiling, stage, now) {
  if (now() - startedAt > ceiling) fail(`${stage}_TIME_LIMIT`, `${stage === "STEP_IMPORT" ? "STEP import" : "STEP section"} exceeded its processing-time ceiling.`);
}

function validateSourceRequest(source, bytes) {
  if (!source || typeof source !== "object"
    || typeof source.name !== "string"
    || source.name.length < 1
    || source.name.length > 255
    || /[\u0000-\u001f\u007f]/.test(source.name)) {
    fail("STEP_SOURCE_INVALID", "STEP source metadata requires a printable name no longer than 255 characters.");
  }
  if (!(bytes instanceof ArrayBuffer)) fail("STEP_BYTES_INVALID", "STEP source bytes must be transferred as an ArrayBuffer.");
  if (!Number.isSafeInteger(source.byteLength) || source.byteLength !== bytes.byteLength
    || bytes.byteLength < 1 || bytes.byteLength > STEP_KERNEL_LIMITS.maxSourceBytes) {
    fail("STEP_SOURCE_SIZE", `STEP source must be between 1 byte and ${STEP_KERNEL_LIMITS.maxSourceBytes} bytes and match its declared length.`);
  }
  if (typeof source.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(source.sha256)) {
    fail("STEP_SOURCE_HASH_INVALID", "STEP source metadata requires an exact SHA-256 hash.");
  }
}

function inspectStepHeader(bytes) {
  const header = new TextDecoder("ascii").decode(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 16_384)));
  if (!/^\s*ISO-10303-21\s*;/i.test(header) || !/\bHEADER\s*;/i.test(header)) {
    fail("STEP_FORMAT_INVALID", "The selected file is not a STEP Part 21 exchange file.");
  }
  const schemaMatch = /FILE_SCHEMA\s*\(\s*\(\s*'([^']{1,128})'/i.exec(header);
  return schemaMatch?.[1] ?? "unknown";
}

function checkObjectCounts(check) {
  if (!check || typeof check.NbWarnings !== "function" || typeof check.NbFails !== "function") {
    fail("STEP_LOAD_DIAGNOSTICS_UNAVAILABLE", "The STEP reader could not prove that load diagnostics are empty.");
  }
  const warnings = check.NbWarnings();
  const failures = check.NbFails();
  if (!Number.isSafeInteger(warnings) || warnings < 0 || !Number.isSafeInteger(failures) || failures < 0) {
    fail("STEP_LOAD_DIAGNOSTICS_UNAVAILABLE", "The STEP reader returned invalid load-diagnostic counts.");
  }
  return {warnings, failures};
}

function inspectLoadDiagnostics(model, now, startedAt) {
  let warnings = 0;
  let failures = 0;
  for (const syntactic of [true, false]) {
    const globalCheck = model.GlobalCheck(syntactic);
    try {
      const counts = checkObjectCounts(globalCheck);
      warnings += counts.warnings;
      failures += counts.failures;
    } finally {
      dispose(globalCheck);
    }
  }
  const entityCount = model.NbEntities();
  if (!Number.isSafeInteger(entityCount) || entityCount < 1 || entityCount > STEP_KERNEL_LIMITS.maxStepEntities) {
    fail("STEP_ENTITY_LIMIT", `STEP source must contain between 1 and ${STEP_KERNEL_LIMITS.maxStepEntities} entities.`);
  }
  for (let index = 1; index <= entityCount; index += 1) {
    for (const syntactic of [true, false]) {
      const check = model.Check(index, syntactic);
      try {
        const counts = checkObjectCounts(check);
        warnings += counts.warnings;
        failures += counts.failures;
      } finally {
        dispose(check);
      }
    }
    if (index % 1_000 === 0) ensureElapsed(startedAt, STEP_KERNEL_LIMITS.maxImportElapsedMs, "STEP_IMPORT", now);
  }
  if (failures > 0) fail("STEP_LOAD_ERRORS", `The STEP reader reported ${failures} blocking load error${failures === 1 ? "" : "s"}.`);
  if (warnings > 0) fail("STEP_LOAD_WARNINGS", `The STEP reader reported ${warnings} blocking load warning${warnings === 1 ? "" : "s"}.`);
  return entityCount;
}

function sequenceSize(handle, diagnosticCode) {
  let sequence;
  try {
    sequence = handle.Sequence();
    const size = sequence.Size();
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("invalid sequence size");
    return size;
  } catch {
    fail(diagnosticCode, "The STEP reader could not prove that transfer diagnostics are empty.");
  } finally {
    dispose(sequence, handle);
  }
}

function inspectTransferDiagnostics(module, reader, model, rootEntity) {
  let workSession;
  let transferReader;
  let finalResult;
  let mainResult;
  let mainCheck;
  try {
    workSession = reader.WS();
    transferReader = workSession.TransferReader();
    if (!transferReader || typeof transferReader.CheckedList !== "function") {
      fail("STEP_TRANSFER_DIAGNOSTICS_UNAVAILABLE", "The STEP reader could not expose structured transfer diagnostics.");
    }
    const warningCount = sequenceSize(
      transferReader.CheckedList(model, module.Interface_CheckStatus.Interface_CheckWarning, false),
      "STEP_TRANSFER_DIAGNOSTICS_UNAVAILABLE",
    );
    const failureCount = sequenceSize(
      transferReader.CheckedList(model, module.Interface_CheckStatus.Interface_CheckFail, false),
      "STEP_TRANSFER_DIAGNOSTICS_UNAVAILABLE",
    );

    finalResult = transferReader.FinalResult(rootEntity);
    if (!finalResult || typeof finalResult.MainResult !== "function") {
      fail("STEP_TRANSFER_DIAGNOSTICS_UNAVAILABLE", "The STEP reader did not retain a structured final transfer result.");
    }
    mainResult = finalResult.MainResult();
    mainCheck = mainResult?.Check?.();
    const mainCounts = checkObjectCounts(mainCheck);
    const failures = Math.max(failureCount, mainCounts.failures);
    const warnings = Math.max(warningCount, mainCounts.warnings);
    if (failures > 0) fail("STEP_TRANSFER_ERRORS", `The STEP reader reported ${failures} blocking transfer error${failures === 1 ? "" : "s"}.`);
    if (warnings > 0) fail("STEP_TRANSFER_WARNINGS", `The STEP reader reported ${warnings} blocking transfer warning${warnings === 1 ? "" : "s"}.`);
  } catch (error) {
    if (error instanceof StepKernelError) throw error;
    fail("STEP_TRANSFER_DIAGNOSTICS_UNAVAILABLE", "The STEP reader could not prove that transfer diagnostics are empty.");
  } finally {
    dispose(mainCheck, mainResult, finalResult, transferReader, workSession);
  }
}

function readSequenceStrings(sequence) {
  const result = [];
  const size = sequence.Size();
  if (!Number.isSafeInteger(size) || size < 0 || size > 32) fail("STEP_UNIT_DECLARATION_LIMIT", "STEP source contains too many unit declarations.");
  for (let index = 1; index <= size; index += 1) {
    const value = sequence.Value(index);
    try {
      const text = String(value.ToCString()).trim().toLowerCase().replace(/\s+/g, " ");
      if (!text || text.length > 64 || /[\u0000-\u001f\u007f]/.test(text)) {
        fail("STEP_UNITS_INVALID", "STEP source contains an invalid length-unit declaration.");
      }
      result.push(text);
    } finally {
      dispose(value);
    }
  }
  return result;
}

function resolveFileUnits(module, reader) {
  const lengthUnits = new module.NCollection_Sequence_TCollection_AsciiString();
  const angleUnits = new module.NCollection_Sequence_TCollection_AsciiString();
  const solidAngleUnits = new module.NCollection_Sequence_TCollection_AsciiString();
  try {
    reader.FileUnits(lengthUnits, angleUnits, solidAngleUnits);
    const names = readSequenceStrings(lengthUnits);
    if (!names.length) fail("STEP_UNITS_MISSING", "STEP source does not declare a physical length unit.");
    const declarations = names.map((name) => UNIT_TABLE.get(name));
    if (declarations.some((declaration) => !declaration)) {
      fail("STEP_UNITS_UNSUPPORTED", "STEP source declares an unsupported physical length unit.");
    }
    const factors = new Set(declarations.map((declaration) => declaration.millimetersPerUnit));
    if (factors.size !== 1) fail("STEP_UNITS_CONFLICT", "STEP source contains conflicting physical length-unit declarations.");
    const resolved = declarations[0];
    return {
      status: "resolved",
      name: resolved.name,
      millimetersPerUnit: resolved.millimetersPerUnit,
      declarations: declarations.map((declaration) => ({...declaration})),
    };
  } catch (error) {
    if (error instanceof StepKernelError) throw error;
    fail("STEP_UNITS_UNAVAILABLE", "The STEP reader could not resolve source length units.");
  } finally {
    dispose(solidAngleUnits, angleUnits, lengthUnits);
  }
}

function shapeCount(module, shape, typeName) {
  const map = new module.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
  try {
    module.TopExp.MapShapes(shape, module.TopAbs_ShapeEnum[typeName], map);
    const count = map.Extent();
    if (!Number.isSafeInteger(count) || count < 0) fail("STEP_TOPOLOGY_INVALID", "STEP topology returned an invalid shape count.");
    return count;
  } finally {
    dispose(map);
  }
}

function analyzeTopology(module, shape) {
  if (shape.IsNull() || shape.ShapeType() !== module.TopAbs_ShapeEnum.TopAbs_SOLID) {
    fail("STEP_SINGLE_SOLID_REQUIRED", "STEP profile comparison requires one transferred top-level solid.");
  }
  const topology = {};
  for (const spec of TOPOLOGY_SPECS) {
    const count = shapeCount(module, shape, spec.type);
    if (count > spec.limit || (spec.key === "solidCount" && count !== 1)) {
      fail("STEP_TOPOLOGY_LIMIT", `STEP topology exceeds the ${spec.key} safety limit.`);
    }
    topology[spec.key] = count;
  }

  const analyzer = new module.BRepCheck_Analyzer(shape, true, false, true);
  try {
    if (analyzer.IsParallel() || !analyzer.IsExactMethod() || !analyzer.IsValid()) {
      fail("STEP_SOLID_INVALID", "The transferred STEP solid failed exact B-rep validity checks.");
    }
  } finally {
    dispose(analyzer);
  }

  const toleranceMaximaMm = {
    faces: module.BRep_Tool.MaxTolerance(shape, module.TopAbs_ShapeEnum.TopAbs_FACE),
    edges: module.BRep_Tool.MaxTolerance(shape, module.TopAbs_ShapeEnum.TopAbs_EDGE),
    vertices: module.BRep_Tool.MaxTolerance(shape, module.TopAbs_ShapeEnum.TopAbs_VERTEX),
  };
  if (!Object.values(toleranceMaximaMm).every(finiteNonnegative)) {
    fail("STEP_TOLERANCE_INVALID", "STEP topology contains an invalid B-rep tolerance.");
  }
  const maxToleranceMm = Math.max(...Object.values(toleranceMaximaMm));
  if (maxToleranceMm > STEP_KERNEL_LIMITS.maxToleranceMm) {
    fail("STEP_TOLERANCE_LIMIT", `STEP topology exceeds the ${STEP_KERNEL_LIMITS.maxToleranceMm} mm tolerance ceiling.`);
  }
  return {
    valid: true,
    ...topology,
    transformsResolved: true,
    ambiguous: false,
    toleranceMaximaMm,
    maxToleranceMm,
    diagnostics: [],
  };
}

function sectionPlane(module, axis, offsetMm) {
  const coordinates = {x: 0, y: 0, z: 0};
  coordinates[axis] = offsetMm;
  const normal = {x: axis === "x" ? 1 : 0, y: axis === "y" ? 1 : 0, z: axis === "z" ? 1 : 0};
  const point = new module.gp_Pnt(coordinates.x, coordinates.y, coordinates.z);
  const direction = new module.gp_Dir(normal.x, normal.y, normal.z);
  const plane = new module.gp_Pln(point, direction);
  return {point, direction, plane};
}

function edgeEndpoints(module, edge, adaptor, firstParameter, lastParameter, edgeToleranceMm, vertexMap) {
  const firstPointObject = adaptor.Value(firstParameter);
  const lastPointObject = adaptor.Value(lastParameter);
  const firstVertex = module.TopExp.FirstVertex(edge, true);
  const lastVertex = module.TopExp.LastVertex(edge, true);
  let firstVertexPoint;
  let lastVertexPoint;
  try {
    const geometricFirst = pointDto(firstPointObject);
    const geometricLast = pointDto(lastPointObject);
    const firstNull = firstVertex.IsNull();
    const lastNull = lastVertex.IsNull();
    if (firstNull !== lastNull) fail("STEP_SECTION_VERTEX_INVALID", "A section edge has only one topological endpoint.");
    if (firstNull) {
      return {geometricFirst, geometricLast, start: geometricFirst, end: geometricLast, startNode: null, endNode: null, reversed: false, vertexToleranceMm: 0};
    }

    firstVertexPoint = module.BRep_Tool.Pnt(firstVertex);
    lastVertexPoint = module.BRep_Tool.Pnt(lastVertex);
    const topologicalFirst = pointDto(firstVertexPoint);
    const topologicalLast = pointDto(lastVertexPoint);
    const firstTolerance = module.BRep_Tool.Tolerance(firstVertex);
    const lastTolerance = module.BRep_Tool.Tolerance(lastVertex);
    if (!finiteNonnegative(firstTolerance) || !finiteNonnegative(lastTolerance)) {
      fail("STEP_SECTION_TOLERANCE_INVALID", "A section vertex contains an invalid B-rep tolerance.");
    }
    const numerical = Number.EPSILON * 512 * Math.max(1, ...Object.values(geometricFirst).map(Math.abs), ...Object.values(geometricLast).map(Math.abs));
    const allowed = edgeToleranceMm + firstTolerance + lastTolerance + numerical;
    const direct = Math.max(distance(geometricFirst, topologicalFirst), distance(geometricLast, topologicalLast));
    const reversed = Math.max(distance(geometricFirst, topologicalLast), distance(geometricLast, topologicalFirst));
    if (Math.min(direct, reversed) > allowed) {
      fail("STEP_SECTION_PARAMETER_MISMATCH", "A section edge's analytic parameters conflict with its topological endpoints.");
    }
    const useReversed = reversed < direct;
    return {
      geometricFirst,
      geometricLast,
      start: useReversed ? geometricLast : geometricFirst,
      end: useReversed ? geometricFirst : geometricLast,
      startNode: vertexMap.Add(firstVertex),
      endNode: vertexMap.Add(lastVertex),
      reversed: useReversed,
      vertexToleranceMm: Math.max(firstTolerance, lastTolerance),
    };
  } finally {
    dispose(lastVertexPoint, firstVertexPoint, lastVertex, firstVertex, lastPointObject, firstPointObject);
  }
}

function analyticLine(module, adaptor) {
  let line;
  let direction;
  try {
    line = adaptor.Line();
    direction = line.Direction();
    return directionDto(direction);
  } finally {
    dispose(direction, line);
  }
}

function analyticCircle(module, adaptor) {
  let circle;
  let position;
  let center;
  let normal;
  let xDirection;
  try {
    circle = adaptor.Circle();
    position = circle.Position();
    center = circle.Location();
    normal = position.Direction();
    xDirection = position.XDirection();
    const radiusMm = circle.Radius();
    if (!Number.isFinite(radiusMm) || radiusMm <= 0 || radiusMm > STEP_KERNEL_LIMITS.maxCoordinateAbsMm) {
      fail("STEP_SECTION_CIRCLE_INVALID", "A section circle has an invalid analytic radius.");
    }
    return {center: pointDto(center), normal: directionDto(normal), xDirection: directionDto(xDirection), radiusMm};
  } finally {
    dispose(xDirection, normal, center, position, circle);
  }
}

function extractSectionEdges(module, sectionShape) {
  const edgeMap = new module.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
  const vertexMap = new module.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
  const records = [];
  try {
    module.TopExp.MapShapes(sectionShape, module.TopAbs_ShapeEnum.TopAbs_EDGE, edgeMap);
    const edgeCount = edgeMap.Extent();
    if (!Number.isSafeInteger(edgeCount) || edgeCount < 1) fail("STEP_SECTION_EMPTY", "The requested plane does not produce a section contour.");
    if (edgeCount > STEP_KERNEL_LIMITS.maxSectionEdges) {
      fail("STEP_SECTION_EDGE_LIMIT", `STEP section exceeds the ${STEP_KERNEL_LIMITS.maxSectionEdges}-edge safety limit.`);
    }

    for (let index = 1; index <= edgeCount; index += 1) {
      const genericShape = edgeMap.FindKey(index);
      const edge = module.TopoDS.Edge(genericShape);
      const adaptor = new module.BRepAdaptor_Curve(edge);
      try {
        if (module.BRep_Tool.Degenerated(edge) || !module.BRep_Tool.IsGeometric(edge)) {
          fail("STEP_SECTION_EDGE_INVALID", "The section contains a degenerate or non-geometric edge.");
        }
        const curveType = adaptor.GetType();
        if (curveType !== module.GeomAbs_CurveType.GeomAbs_Line && curveType !== module.GeomAbs_CurveType.GeomAbs_Circle) {
          fail("STEP_SECTION_CURVE_UNSUPPORTED", "The exact section contains a curve other than a line or circle.");
        }
        const firstParameter = adaptor.FirstParameter();
        const lastParameter = adaptor.LastParameter();
        const adaptorTolerance = adaptor.Tolerance();
        const edgeTolerance = module.BRep_Tool.Tolerance(edge);
        if (![firstParameter, lastParameter, adaptorTolerance, edgeTolerance].every(Number.isFinite)
          || adaptorTolerance < 0 || edgeTolerance < 0 || lastParameter < firstParameter) {
          fail("STEP_SECTION_EDGE_INVALID", "A section edge contains invalid analytic parameters or tolerances.");
        }
        const endpoints = edgeEndpoints(module, edge, adaptor, firstParameter, lastParameter, Math.max(adaptorTolerance, edgeTolerance), vertexMap);
        const maxToleranceMm = Math.max(adaptorTolerance, edgeTolerance, endpoints.vertexToleranceMm);
        if (maxToleranceMm > STEP_KERNEL_LIMITS.maxToleranceMm) {
          fail("STEP_SECTION_TOLERANCE_LIMIT", `STEP section exceeds the ${STEP_KERNEL_LIMITS.maxToleranceMm} mm tolerance ceiling.`);
        }
        const orientation = edge.Orientation();
        const parameterStart = endpoints.reversed ? lastParameter : firstParameter;
        const parameterEnd = endpoints.reversed ? firstParameter : lastParameter;
        const base = {
          id: `edge-${index}`,
          curveType,
          start: endpoints.start,
          end: endpoints.end,
          orientation,
          traversalReversedFromOrientation: endpoints.reversed,
          parameters: {first: firstParameter, last: lastParameter, start: parameterStart, end: parameterEnd},
          toleranceMaximaMm: {adaptor: adaptorTolerance, edge: edgeTolerance, vertices: endpoints.vertexToleranceMm},
          maxToleranceMm,
        };
        if (curveType === module.GeomAbs_CurveType.GeomAbs_Line) {
          const nativeDirection = analyticLine(module, adaptor);
          records.push({
            dto: {...base, direction: endpoints.reversed ? reverseVector(nativeDirection) : nativeDirection},
            startNode: endpoints.startNode,
            endNode: endpoints.endNode,
            fullCircle: false,
          });
        } else {
          const analytic = analyticCircle(module, adaptor);
          const span = lastParameter - firstParameter;
          const fullCircle = Math.abs(span - TAU) <= Number.EPSILON * 1_024 * Math.max(1, Math.abs(span));
          const endpointsClosed = endpoints.startNode === endpoints.endNode || (endpoints.startNode === null && endpoints.endNode === null);
          if (fullCircle !== endpointsClosed) {
            fail("STEP_SECTION_CIRCLE_TOPOLOGY", "A section circle's parameter range conflicts with its endpoint topology.");
          }
          records.push({
            dto: {
              ...base,
              ...analytic,
              sweepRadians: fullCircle ? TAU : parameterEnd - parameterStart,
              fullCircle,
            },
            startNode: endpoints.startNode,
            endNode: endpoints.endNode,
            fullCircle,
          });
        }
      } finally {
        dispose(adaptor, edge, genericShape);
      }
    }
    if (vertexMap.Extent() > STEP_KERNEL_LIMITS.maxSectionVertices) {
      fail("STEP_SECTION_VERTEX_LIMIT", `STEP section exceeds the ${STEP_KERNEL_LIMITS.maxSectionVertices}-vertex safety limit.`);
    }
    return records;
  } finally {
    dispose(vertexMap, edgeMap);
  }
}

function reverseEdgeRecord(record) {
  const dto = {
    ...record.dto,
    start: record.dto.end,
    end: record.dto.start,
    traversalReversedFromOrientation: !record.dto.traversalReversedFromOrientation,
    parameters: {
      ...record.dto.parameters,
      start: record.dto.parameters.end,
      end: record.dto.parameters.start,
    },
  };
  if (dto.curveType === "GeomAbs_Line") dto.direction = reverseVector(dto.direction);
  if (dto.curveType === "GeomAbs_Circle") dto.sweepRadians = -dto.sweepRadians;
  return {...record, dto, startNode: record.endNode, endNode: record.startNode};
}

function groupContours(records) {
  const unused = new Map(records.map((record, index) => [index, record]));
  const contours = [];
  while (unused.size) {
    const [seedIndex, seed] = unused.entries().next().value;
    unused.delete(seedIndex);
    if (seed.fullCircle) {
      contours.push({id: `contour-${contours.length + 1}`, closed: true, ambiguous: false, edges: [seed.dto]});
      continue;
    }
    if (seed.startNode === null || seed.endNode === null || seed.startNode === seed.endNode) {
      fail("STEP_SECTION_CONTOUR_OPEN", "The section contains an open or topologically ambiguous edge.");
    }
    const ordered = [seed];
    const firstNode = seed.startNode;
    let currentNode = seed.endNode;
    while (currentNode !== firstNode) {
      const candidates = [];
      for (const [index, record] of unused) {
        if (!record.fullCircle && (record.startNode === currentNode || record.endNode === currentNode)) candidates.push([index, record]);
      }
      if (candidates.length !== 1) {
        fail("STEP_SECTION_CONTOUR_AMBIGUOUS", "The section edges do not form unambiguous closed contours.");
      }
      const [index, candidate] = candidates[0];
      unused.delete(index);
      const oriented = candidate.startNode === currentNode ? candidate : reverseEdgeRecord(candidate);
      ordered.push(oriented);
      currentNode = oriented.endNode;
      if (ordered.length > records.length) fail("STEP_SECTION_CONTOUR_AMBIGUOUS", "The section contour traversal did not terminate.");
    }
    contours.push({
      id: `contour-${contours.length + 1}`,
      closed: true,
      ambiguous: false,
      edges: ordered.map((record) => record.dto),
    });
  }
  return contours;
}

export class StepKernelRuntime {
  #fetchImpl;
  #cryptoImpl;
  #assetBaseUrl;
  #now;
  #modulePromise = null;
  #shape = null;
  #metadata = null;

  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    cryptoImpl = globalThis.crypto,
    assetBaseUrl = new URL("./vendor/occt/3.0.2/", import.meta.url),
    now = () => performance.now(),
  } = {}) {
    if (typeof fetchImpl !== "function") fail("STEP_FETCH_UNAVAILABLE", "Local STEP kernel assets cannot be loaded in this browser.");
    this.#fetchImpl = fetchImpl;
    this.#cryptoImpl = cryptoImpl;
    this.#assetBaseUrl = new URL(assetBaseUrl);
    this.#now = now;
  }

  async #module() {
    this.#modulePromise ??= instantiateKernel({
      fetchImpl: this.#fetchImpl,
      cryptoImpl: this.#cryptoImpl,
      assetBaseUrl: this.#assetBaseUrl,
    });
    try {
      return await this.#modulePromise;
    } catch (error) {
      this.#modulePromise = null;
      throw error;
    }
  }

  async load(request = {}) {
    const transferredBytes = request.bytes instanceof ArrayBuffer ? new Uint8Array(request.bytes) : null;
    try {
      return await this.#loadSource(request);
    } finally {
      transferredBytes?.fill(0);
    }
  }

  async #loadSource({source, bytes}) {
    validateSourceRequest(source, bytes);
    const actualHash = await sha256(bytes, this.#cryptoImpl);
    if (actualHash !== source.sha256.toLowerCase()) fail("STEP_SOURCE_HASH_MISMATCH", "STEP source bytes do not match their declared SHA-256 hash.");
    const schema = inspectStepHeader(bytes);
    const startedAt = this.#now();
    const module = await this.#module();
    this.release();
    let reader;
    let model;
    let rootEntity;
    let transferredShape;
    try {
      try {
        module.FS.unlink(SOURCE_PATH);
      } catch {
        // A missing fixed MEMFS path is the expected initial state.
      }
      module.FS.writeFile(SOURCE_PATH, new Uint8Array(bytes));
      reader = new module.STEPControl_Reader();
      if (reader.ReadFile(SOURCE_PATH) !== module.IFSelect_ReturnStatus.IFSelect_RetDone) {
        fail("STEP_READ_FAILED", "The STEP reader could not load this Part 21 file.");
      }
      model = reader.Model();
      const entityCount = inspectLoadDiagnostics(model, this.#now, startedAt);
      const sourceUnits = resolveFileUnits(module, reader);
      reader.SetSystemLengthUnit(1);
      if (Math.abs(reader.SystemLengthUnit() - 1) > Number.EPSILON * 8) {
        fail("STEP_UNIT_NORMALIZATION_FAILED", "The STEP reader could not prove millimetre transfer coordinates.");
      }
      const rootCount = reader.NbRootsForTransfer();
      if (rootCount !== 1) fail("STEP_ROOT_COUNT", "STEP profile comparison requires exactly one transferable root.");
      rootEntity = reader.RootForTransfer(1);
      if (!reader.TransferRoot(1) || reader.NbShapes() !== 1) {
        fail("STEP_TRANSFER_FAILED", "STEP profile comparison requires exactly one successfully transferred shape.");
      }
      inspectTransferDiagnostics(module, reader, model, rootEntity);
      transferredShape = reader.Shape(1);
      const topology = analyzeTopology(module, transferredShape);
      ensureMemoryLimit(module);
      ensureElapsed(startedAt, STEP_KERNEL_LIMITS.maxImportElapsedMs, "STEP_IMPORT", this.#now);

      this.#shape = transferredShape;
      transferredShape = null;
      this.#metadata = {
        source: {name: source.name, sha256: actualHash, byteLength: source.byteLength},
        sourceUnits,
        coordinateUnits: {status: "resolved", name: "millimeter", millimetersPerUnit: 1},
        kernel: {...STEP_KERNEL_IDENTITY},
        import: {succeeded: true, maxToleranceMm: topology.maxToleranceMm, diagnostics: []},
        topology,
      };
      return {
        schemaVersion: 1,
        format: "step-solid",
        source: {...this.#metadata.source, format: "step", schema},
        sourceUnits: this.#metadata.sourceUnits,
        coordinateUnits: this.#metadata.coordinateUnits,
        kernel: this.#metadata.kernel,
        import: {...this.#metadata.import, entityCount, rootCount: 1, transferredShapeCount: 1},
        topology: this.#metadata.topology,
        tolerances: {
          units: "millimeter",
          ...this.#metadata.topology.toleranceMaximaMm,
          maxToleranceMm: this.#metadata.topology.maxToleranceMm,
        },
        diagnostics: [],
        authorized: true,
      };
    } catch (error) {
      dispose(transferredShape);
      this.release();
      if (error instanceof StepKernelError) throw error;
      fail("STEP_IMPORT_FAILED", "The local geometry kernel blocked this STEP import.");
    } finally {
      try {
        module.FS.unlink(SOURCE_PATH);
      } catch {
        // The fixed path may already have been purged by the error path.
      }
      try {
        reader?.ClearShapes?.();
      } catch {
        // Continue releasing the remaining imported handles.
      }
      dispose(rootEntity, model, reader);
    }
  }

  async section({normalAxis, planeOffsetMm}) {
    if (!this.#shape || !this.#metadata) fail("STEP_NOT_LOADED", "Load one authorized STEP solid before requesting a section.");
    const axis = String(normalAxis ?? "").toLowerCase();
    if (!AXES.has(axis) || !Number.isFinite(planeOffsetMm)
      || Math.abs(planeOffsetMm) > STEP_KERNEL_LIMITS.maxCoordinateAbsMm) {
      fail("STEP_SECTION_PLANE_INVALID", "STEP section requires an x, y, or z normal axis and a finite millimetre offset.");
    }
    const startedAt = this.#now();
    const module = await this.#module();
    const {point, direction, plane} = sectionPlane(module, axis, planeOffsetMm);
    let algorithm;
    let sectionShape;
    try {
      algorithm = new module.BRepAlgoAPI_Section(this.#shape, plane, false);
      algorithm.Approximation(false);
      algorithm.ComputePCurveOn1(false);
      algorithm.ComputePCurveOn2(false);
      algorithm.SetFuzzyValue(0);
      algorithm.SetRunParallel(false);
      algorithm.Build();
      if (algorithm.HasErrors()) fail("STEP_SECTION_ERRORS", "The exact section algorithm reported a blocking error.");
      if (algorithm.HasWarnings()) fail("STEP_SECTION_WARNINGS", "The exact section algorithm reported a blocking warning.");
      if (!algorithm.IsDone()) fail("STEP_SECTION_FAILED", "The exact section algorithm did not complete.");
      if (algorithm.RunParallel()) fail("STEP_SECTION_MODE", "The section algorithm did not remain in deterministic single-threaded mode.");
      sectionShape = algorithm.Shape();
      if (sectionShape.IsNull()) fail("STEP_SECTION_EMPTY", "The requested plane does not produce a section contour.");

      const analyzer = new module.BRepCheck_Analyzer(sectionShape, true, false, true);
      try {
        if (!analyzer.IsValid()) fail("STEP_SECTION_INVALID", "The section result failed exact B-rep validity checks.");
      } finally {
        dispose(analyzer);
      }
      const records = extractSectionEdges(module, sectionShape);
      const contours = groupContours(records);
      const edgeToleranceMm = Math.max(...records.map((record) => record.dto.maxToleranceMm), 0);
      const vertexToleranceMm = module.BRep_Tool.MaxTolerance(sectionShape, module.TopAbs_ShapeEnum.TopAbs_VERTEX);
      const effectiveKernelFuzzyFloorMm = algorithm.FuzzyValue();
      if (![edgeToleranceMm, vertexToleranceMm, effectiveKernelFuzzyFloorMm].every(finiteNonnegative)) {
        fail("STEP_SECTION_TOLERANCE_INVALID", "The section result contains an invalid B-rep tolerance.");
      }
      const maxToleranceMm = Math.max(edgeToleranceMm, vertexToleranceMm, effectiveKernelFuzzyFloorMm);
      if (Math.max(maxToleranceMm, edgeToleranceMm) > STEP_KERNEL_LIMITS.maxToleranceMm) {
        fail("STEP_SECTION_TOLERANCE_LIMIT", `STEP section exceeds the ${STEP_KERNEL_LIMITS.maxToleranceMm} mm tolerance ceiling.`);
      }
      ensureMemoryLimit(module);
      ensureElapsed(startedAt, STEP_KERNEL_LIMITS.maxSectionElapsedMs, "STEP_SECTION", this.#now);
      return {
        schemaVersion: 1,
        format: "step-section",
        source: this.#metadata.source,
        sourceUnits: this.#metadata.sourceUnits,
        coordinateUnits: this.#metadata.coordinateUnits,
        kernel: this.#metadata.kernel,
        import: this.#metadata.import,
        topology: this.#metadata.topology,
        section: {
          succeeded: true,
          approximationUsed: false,
          fuzzyToleranceMm: 0,
          effectiveKernelFuzzyFloorMm,
          maxToleranceMm,
          toleranceMaximaMm: {edges: edgeToleranceMm, vertices: vertexToleranceMm, kernelConfusion: effectiveKernelFuzzyFloorMm},
          diagnostics: [],
          plane: {axis, offsetMm: planeOffsetMm},
          contours,
        },
        diagnostics: [],
        authorized: true,
      };
    } catch (error) {
      if (error instanceof StepKernelError) throw error;
      fail("STEP_SECTION_FAILED", "The local geometry kernel blocked this STEP section.");
    } finally {
      dispose(sectionShape, algorithm, plane, direction, point);
    }
  }

  release() {
    dispose(this.#shape);
    this.#shape = null;
    this.#metadata = null;
    if (this.#modulePromise) {
      this.#modulePromise.then((module) => {
        try {
          module.FS.unlink(SOURCE_PATH);
        } catch {
          // The fixed MEMFS source is normally removed immediately after import.
        }
      }).catch(() => {});
    }
    return {released: true, purged: true};
  }
}

export function createStepKernelRuntime(options) {
  return new StepKernelRuntime(options);
}
