import {parseGcode, programBounds, segmentLength, spindleStateAtLine} from "./gcode.mjs";
import {cycleTimeAtPosition, estimateCycleTime, formatCycleTime} from "./runtime.mjs";
import {
  buildStockProfile, collisionPointForSegment, extendStockProfile, findCollisions, stockContourPoints,
  stockPlacement, stockVerificationColumns,
} from "./simulation.mjs";
import {convertUnitValue, scaleForUnits} from "./units.mjs";
import {comparePrograms, compareSegmentGeometry, diffLineTokens, geometryItemsForFit, overlayGeometryLayers} from "./compare.mjs";
import {graphicsQualityPreset, renderGraphicsQualityPreset} from "./graphics-quality.mjs";
import {createFrameScheduler} from "./render-scheduler.mjs";
import {
  buildToolAssembly2d, buildToolAssemblyDisplay2d, DEFAULT_TOOL_ASSEMBLY_2D, listSelectableToolAssemblies2d,
  resolveAssignableToolAssembly2d, TOOL_ASSEMBLY_2D_STATUS, toolAssembly2dById, toolReferencePointForExecution,
} from "./tool-assembly.mjs";
import {
  TOOL_LIBRARY_CATALOG, catalogDiamondInsertOutline2d, listToolLibraryAssemblies,
  toolLibraryAssemblyById, toolLibraryAssemblyDetail,
} from "./tool-library.mjs";
import {
  activeToolKeyAtLine, createVersionedToolAssignment, isExactBundledProgram, normalizeVersionedToolAssignment,
  programAssignmentScope, reconcileToolAssignments, reviseToolAssignmentSetup, toolAssignmentAssemblyRef,
  toolAssignmentsForPersistence,
} from "./program-tools.mjs";
import {
  arcGeometry, geometryHitAt, geometryMeasurement, geometryPointAt, lineGeometry, motionGeometry, polylineGeometry, rectangleGeometry,
  sampleGeometryEntity,
} from "./geometry-inspector.mjs";
import {
  advanceExecutionPosition, entryVisibleBlocksForSourceLine, executionLineForPosition, executionRangeForSourceLine,
  graphicsHitAt, graphicsSelectionEnabled, programCursorNavigationKey, sourceLineAtOffset,
} from "./interaction.mjs";
import {
  nextProgramSearchIndex, programSearchIndexFromAnchor, programSearchMatches, replaceAllProgramSearchMatches,
  replaceProgramSearchMatch,
} from "./editor-search.mjs";
import {
  cameraViewForDirection, navigationDragMode, orbitCameraFromDrag, renderLathe3d, renderViewCube, standardCameraView,
  zoomCameraAt,
  viewCubeHitTarget,
} from "./view3d.mjs";

const sampleProgram = `%
O1071 (G-CODE STUDIO SAMPLE - G71 ROUGH TURN)
G18 G20 G40 G90 G95
G28 U0 W0
G54
T0101
G97 S1200 M03
G0 Z5.000
X2.200
Z0.120
G71 U0.080 R0.040
G71 P100 Q170 U0.020 W0.008 F0.010
N100 G0 X0.800
N110 G1 Z0.0
N120 X1.100
N130 Z-0.710
N140 G2 X1.340 Z-0.830 R0.120
N150 G1 Z-1.770
N160 X1.650 Z-2.090
N170 Z-2.760
G70 P100 Q170
G0 X2.360
G0 Z0.200
M05
M30
%`;

const DEFAULT_MACHINE_PROFILES = [
  {
    id: "hardinge-conquest-t42", name: "Hardinge Conquest T42 · Fanuc 18-T", manufacturer: "Hardinge",
    model: "Conquest T42", serialNumber: "SGA1079-B", controlMake: "GE Fanuc", controlModel: "18-T",
    status: "draft", templateRevision: 1, units: "inch", xProgramming: "diameter", orientation: "left",
    xTravelMin: -6.37, xTravelMax: 0, zTravelMin: -16, zTravelMax: 0, homeX: 0, homeZ: 0,
    startMode: "home", startX: 12.74, startZ: 16, rapidBehavior: "dogleg", rapidXMax: 945, rapidZMax: 1200,
    toolChangeX: 0, toolChangeZ: 0, safeIndexX: 0, safeIndexZ: 0, turretStations: 12,
    notes: "BEST-EFFORT DRAFT — NOT VERIFIED. Travel and rapid estimates come from Hardinge T-Series brochure 1312-1E; applicability to this older Conquest is unconfirmed. The 12-station turret is a guess from the 10/12-station options in Conquest parts list PL-60A. Assumes machine reference X0/Z0, negative machine travel, diameter-mode plotted home X12.74/Z16, and independent-axis rapid motion. Check every value at the machine before relying on it.",
    updatedAt: null,
  },
  {
    id: "generic-lathe", name: "Generic lathe", manufacturer: "", model: "", serialNumber: "",
    controlMake: "", controlModel: "", status: "draft", templateRevision: 0, units: "inch", xProgramming: "diameter",
    orientation: "left", startMode: "unknown", rapidBehavior: "unknown", notes: "", updatedAt: null,
  },
];
const MACHINE_PROFILE_CACHE_KEY = "verify.machineProfiles.v1";
const MACHINE_PROFILE_FIELDS = [
  "name", "manufacturer", "model", "serialNumber", "controlMake", "controlModel", "status", "units",
  "xProgramming", "orientation", "xTravelMin", "xTravelMax", "zTravelMin", "zTravelMax", "homeX", "homeZ",
  "startMode", "startX", "startZ", "rapidBehavior", "rapidXMax", "rapidZMax", "toolChangeX", "toolChangeZ",
  "safeIndexX", "safeIndexZ", "turretStations", "notes",
];
const NUMERIC_MACHINE_FIELDS = new Set([
  "xTravelMin", "xTravelMax", "zTravelMin", "zTravelMax", "homeX", "homeZ", "startX", "startZ",
  "rapidXMax", "rapidZMax", "toolChangeX", "toolChangeZ", "safeIndexX", "safeIndexZ", "turretStations",
]);

const $ = (id) => document.getElementById(id);
const elements = {
  canvas: $("plotCanvas"), wrap: $("canvasWrap"), input: $("gcodeInput"), fileInput: $("fileInput"),
  programPanel: $("programPanel"), editor: $("gcodeEditor"), activeLine: $("gcodeActiveLine"), lineNumbers: $("gcodeLineNumbers"),
  activeLineNumber: $("gcodeActiveNumber"), searchHighlights: $("gcodeSearchHighlights"),
  programSearchPanel: $("programSearchPanel"), programSearchInput: $("programSearchInput"),
  programSearchStatus: $("programSearchStatus"), programSearchPrevious: $("programSearchPrevious"),
  programSearchNext: $("programSearchNext"), programSearchClose: $("programSearchClose"),
  programReplaceRow: $("programReplaceRow"), programReplaceInput: $("programReplaceInput"),
  programReplaceOne: $("programReplaceOne"), programReplaceAll: $("programReplaceAll"),
  fileName: $("fileName"), lineCount: $("lineCount"), status: $("programStatus"), timeline: $("timeline"),
  blockReadout: $("blockReadout"), play: $("playButton"), stepBack: $("stepBackButton"), stepForward: $("stepForwardButton"),
  readerElapsedTime: $("readerElapsedTime"), readerRemainingTime: $("readerRemainingTime"), readerTotalTime: $("readerTotalTime"),
  speed: $("speedSelect"), machine: $("machineSelect"), editMachine: $("editMachineButton"), orientation: $("orientationSelect"),
  xMode: $("xModeSelect"), programUnits: $("programUnits"), programUnitsHint: $("programUnitsHint"), stockDiameter: $("stockDiameter"), stockLength: $("stockLength"), stockGripLength: $("stockGripLength"), stockStickout: $("stockStickout"), stockToggle: $("stockToggle"),
  empty: $("emptyState"),
  chuckFaceZ: $("chuckFaceZ"), jawDiameter: $("jawDiameter"), clearance: $("clearanceInput"), collisionToggle: $("collisionToggle"),
  displayUnits: $("displayUnits"), unitReadout: $("unitReadout"), save: $("saveButton"), install: $("installButton"),
  dropOverlay: $("dropOverlay"), machineDialog: $("machineDialog"), machineForm: $("machineForm"),
  machineDialogTitle: $("machineDialogTitle"), machineStatusBadge: $("machineStatusBadge"), machineSaveStatus: $("machineSaveStatus"),
  originalFileInput: $("originalFileInput"), compareDialog: $("compareDialog"), compareRows: $("compareRows"),
  compareEmpty: $("compareEmpty"), compareResults: $("compareResults"), differencesOnly: $("differencesOnlyToggle"),
  ignoreFormatting: $("ignoreFormattingToggle"), previousCompareChange: $("previousCompareChange"),
  nextCompareChange: $("nextCompareChange"), comparePosition: $("comparePosition"),
  compareCodeAudit: $("compareCodeAudit"), compareGraphicsAudit: $("compareGraphicsAudit"),
  compareCodeView: $("compareCodeView"), compareGraphicsView: $("compareGraphicsView"),
  originalCompareCanvas: $("originalCompareCanvas"), revisedCompareCanvas: $("revisedCompareCanvas"),
  overlayCompareCanvas: $("overlayCompareCanvas"), compareSplitPlots: $("compareSplitPlots"), compareOverlayPlot: $("compareOverlayPlot"),
  compareSplitLayout: $("compareSplitLayout"), compareOverlayLayout: $("compareOverlayLayout"), graphicsViewportNote: $("graphicsViewportNote"),
  fitGeometryDifferences: $("fitGeometryDifferences"), fitGeometryPart: $("fitGeometryPart"), compareNavigation: $("compareNavigation"),
  graphicsInfoButton: $("graphicsInfoButton"), graphicsInfoPanel: $("graphicsInfoPanel"),
  view2d: $("view2dButton"), view3d: $("view3dButton"),
  toolOverlay: $("toolOverlayButton"), toolVerificationBadge: $("toolVerificationBadge"),
  programToolsSetup: $("programToolsSetup"), programToolSummary: $("programToolSummary"), programToolList: $("programToolList"),
  toolLibraryButton: $("toolLibraryButton"), toolLibraryDialog: $("toolLibraryDialog"), toolLibraryClose: $("toolLibraryClose"),
  toolLibrarySearch: $("toolLibrarySearch"), toolLibraryFamilyFilter: $("toolLibraryFamilyFilter"),
  toolLibraryShapeFilter: $("toolLibraryShapeFilter"), toolLibraryAuthorityFilter: $("toolLibraryAuthorityFilter"),
  toolLibraryResults: $("toolLibraryResults"), toolLibraryResultsTitle: $("toolLibraryResultsTitle"),
  toolLibraryResultCount: $("toolLibraryResultCount"), toolLibraryDetail: $("toolLibraryDetail"),
  toolLibraryTarget: $("toolLibraryTarget"), toolLibraryAssign: $("toolLibraryAssign"),
  viewCube: $("viewCube"), viewCubeCanvas: $("viewCubeCanvas"), viewCubeHome: $("viewCubeHome"),
  graphicsQuality: $("graphicsQuality"), graphicsQualityHint: $("graphicsQualityHint"),
  toolpathToggle: $("toolpathToggle"),
  dimensionButton: $("dimensionButton"), clearDimensionsButton: $("clearDimensionsButton"),
  geometryInspector: $("geometryInspector"), clearGeometrySelection: $("clearGeometrySelection"),
};

const state = {
  parsed: {segments: [], warnings: []}, cycleTime: null, programLine: 0, visibleBlocks: 0, playing: false, lastFrame: 0,
  camera: {scale: 1, offsetX: 0, offsetY: 0, fitted: false}, drag: null, cursor: null,
  machineProfiles: DEFAULT_MACHINE_PROFILES.map((profile) => ({...profile})),
  comparisonOriginal: null, comparison: null, compareChangeIndex: -1,
  compareView: "code", compareGraphicsLayout: "split", comparisonGeometry: null,
  viewMode: "2d", camera3d: {yaw: -Math.PI / 4, pitch: Math.asin(1 / Math.sqrt(3)), zoom: 1, panX: 0, panY: 0},
  viewCubeRegions: [], viewCubeHover: null,
  stockProfileCache: null, stockSamplingError: null,
  preview3dUntil: 0, precisionRedrawTimer: null,
  graphicsHits: [], hoverBlockIndex: null, highlightedSourceLine: null, programDirty: false,
  componentGeometry: [], geometryHover: null, geometrySelection: null,
  dimensions: [], dimensionMode: false,
  showTool2d: false,
  toolAssignments: {}, toolAssignmentRevision: 0, toolAssignmentScope: null, bundledSample: false,
  toolLibraryTab: "assemblies", toolLibrarySelection: null,
};
const ctx = elements.canvas.getContext("2d");
const navigation3dRenderer = createFrameScheduler({
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (frame) => cancelAnimationFrame(frame),
  render: () => { if (state.viewMode === "3d") draw(); },
});
const STORAGE_KEY = "verify.session.v1";
const preferenceIds = [
  "machineSelect", "orientationSelect", "xModeSelect", "programUnits", "displayUnits", "stockDiameter", "stockLength", "stockGripLength",
  "stockToggle", "chuckFaceZ", "jawDiameter", "clearanceInput", "collisionToggle", "graphicsQuality",
  "toolpathToggle",
];
let installPrompt = null;
let persistTimer = null;
let programCursorFrame = null;
const programSearch = {
  matches: [], index: -1, kind: "empty", anchorStart: 0, anchorEnd: 0, selectionDirection: "none",
  anchorScrollTop: 0, anchorScrollLeft: 0,
};
const programTextMeasureContext = document.createElement("canvas").getContext("2d");
const STOCK_FRAME_CACHE_LIMIT = 64;
const THREE_D_SETTLE_MS = 850;
const TOOL_LIBRARY_SOURCE_BY_ID = new Map(TOOL_LIBRARY_CATALOG.sources.map((source) => [source.id, source]));

function programEditorMetrics() {
  const style = getComputedStyle(elements.input);
  if (programTextMeasureContext) programTextMeasureContext.font = style.font;
  return {
    lineHeight: Number.parseFloat(style.lineHeight) || 20.16,
    paddingTop: Number.parseFloat(style.paddingTop) || 14,
    paddingLeft: Number.parseFloat(style.paddingLeft) || 54,
    characterWidth: programTextMeasureContext?.measureText("0").width || 7.2,
    tabSize: Number.parseInt(style.tabSize, 10) || 2,
  };
}

function programLineCount() {
  return Math.max(1, elements.input.value.split(/\r?\n/).length);
}

function renderProgramLineNumbers() {
  const count = programLineCount();
  elements.lineNumbers.textContent = Array.from({length: count}, (_, index) => index + 1).join("\n");
  elements.lineCount.textContent = `${count} lines`;
}

function positionProgramLineHighlight() {
  const {lineHeight, paddingTop} = programEditorMetrics();
  elements.lineNumbers.style.lineHeight = `${lineHeight}px`;
  elements.lineNumbers.style.transform = `translateY(${paddingTop - elements.input.scrollTop}px)`;
  const line = state.highlightedSourceLine;
  if (!line) {
    elements.activeLine.hidden = true;
    elements.activeLineNumber.hidden = true;
    return;
  }
  const top = paddingTop + (line - 1) * lineHeight - elements.input.scrollTop;
  elements.activeLine.hidden = false;
  elements.activeLine.style.height = `${lineHeight}px`;
  elements.activeLine.style.top = `${top}px`;
  elements.activeLineNumber.hidden = false;
  elements.activeLineNumber.textContent = String(line);
  elements.activeLineNumber.style.height = `${lineHeight}px`;
  elements.activeLineNumber.style.top = `${top}px`;
}

function scrollProgramLineIntoView(line) {
  if (!line || !elements.input.clientHeight) return;
  const {lineHeight, paddingTop} = programEditorMetrics();
  const lineTop = paddingTop + (line - 1) * lineHeight;
  const lineBottom = lineTop + lineHeight;
  const viewportTop = elements.input.scrollTop;
  const viewportBottom = viewportTop + elements.input.clientHeight;
  if (lineTop < viewportTop + lineHeight) {
    elements.input.scrollTop = Math.max(0, lineTop - lineHeight * 2);
  } else if (lineBottom > viewportBottom - lineHeight) {
    elements.input.scrollTop = Math.max(0, lineBottom - elements.input.clientHeight + lineHeight * 2);
  }
}

function updateProgramLineHighlight({scroll = false} = {}) {
  const line = state.programDirty || state.programLine <= 0 ? null : state.programLine;
  state.highlightedSourceLine = line;
  if (scroll) scrollProgramLineIntoView(line);
  positionProgramLineHighlight();
}

function programSearchSelection() {
  const start = elements.input.selectionStart;
  const end = elements.input.selectionEnd;
  return start < end && !elements.input.value.slice(start, end).includes("\n")
    ? elements.input.value.slice(start, end)
    : "";
}

function captureProgramSearchAnchor() {
  programSearch.anchorStart = elements.input.selectionStart;
  programSearch.anchorEnd = elements.input.selectionEnd;
  programSearch.selectionDirection = elements.input.selectionDirection || "none";
  programSearch.anchorScrollTop = elements.input.scrollTop;
  programSearch.anchorScrollLeft = elements.input.scrollLeft;
}

function restoreProgramSearchCaret() {
  const end = elements.input.value.length;
  const start = Math.min(programSearch.anchorStart, end);
  const finish = Math.min(programSearch.anchorEnd, end);
  elements.input.setSelectionRange(start, finish, programSearch.selectionDirection);
  elements.input.scrollTop = programSearch.anchorScrollTop;
  elements.input.scrollLeft = programSearch.anchorScrollLeft;
}

function programLineStartOffsets(source) {
  const offsets = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") offsets.push(index + 1);
  }
  return offsets;
}

function programVisualColumn(source, start, end, tabSize) {
  let column = 0;
  for (let index = start; index < end; index += 1) {
    column += source[index] === "\t" ? tabSize - (column % tabSize) : 1;
  }
  return column;
}

function renderProgramSearchHighlights() {
  elements.searchHighlights.replaceChildren();
  if (elements.programSearchPanel.hidden || !programSearch.matches.length) return;
  const source = elements.input.value;
  const lineStarts = programLineStartOffsets(source);
  const {lineHeight, paddingTop, paddingLeft, characterWidth, tabSize} = programEditorMetrics();
  const fragment = document.createDocumentFragment();
  for (const [index, match] of programSearch.matches.entries()) {
    const top = paddingTop + (match.line - 1) * lineHeight - elements.input.scrollTop;
    if (top + lineHeight < 0 || top > elements.input.clientHeight) continue;
    const lineStart = lineStarts[match.line - 1] ?? 0;
    const startColumn = programVisualColumn(source, lineStart, match.start, tabSize);
    const endColumn = programVisualColumn(source, lineStart, match.end, tabSize);
    const highlight = document.createElement("span");
    highlight.className = `gcode-search-match${index === programSearch.index ? " is-active" : ""}`;
    highlight.style.left = `${paddingLeft + startColumn * characterWidth - elements.input.scrollLeft}px`;
    highlight.style.top = `${top + 1}px`;
    highlight.style.width = `${Math.max(characterWidth, (endColumn - startColumn) * characterWidth)}px`;
    highlight.style.height = `${Math.max(14, lineHeight - 2)}px`;
    fragment.append(highlight);
  }
  elements.searchHighlights.append(fragment);
}

function updateProgramSearchControls() {
  const hasMatches = programSearch.matches.length > 0;
  const replaceable = hasMatches && programSearch.kind === "text";
  elements.programSearchPrevious.disabled = !hasMatches;
  elements.programSearchNext.disabled = !hasMatches;
  elements.programReplaceOne.disabled = !replaceable || programSearch.index < 0;
  elements.programReplaceAll.disabled = !replaceable;
}

function activateProgramSearchMatch(index, {keepFocus = true} = {}) {
  if (!programSearch.matches.length) return;
  programSearch.index = Math.max(0, Math.min(programSearch.matches.length - 1, index));
  const match = programSearch.matches[programSearch.index];
  scrollProgramLineIntoView(match.line);
  renderProgramSearchHighlights();
  elements.programSearchStatus.textContent = programSearch.kind === "line"
    ? `Line ${match.line}`
    : `${programSearch.index + 1} of ${programSearch.matches.length}`;
  updateProgramSearchControls();
  if (keepFocus) elements.programSearchInput.focus();
}

function refreshProgramSearch() {
  const result = programSearchMatches(elements.input.value, elements.programSearchInput.value);
  programSearch.matches = result.matches;
  programSearch.kind = result.kind;
  programSearch.index = -1;
  if (!result.matches.length) {
    elements.programSearchStatus.textContent = result.kind === "empty" ? "Type to find" : "No matches";
    updateProgramSearchControls();
    renderProgramSearchHighlights();
    return;
  }
  elements.programSearchStatus.textContent = result.kind === "line"
    ? "Line found · choose ↑ or ↓"
    : `${result.matches.length} ${result.matches.length === 1 ? "match" : "matches"} · choose ↑ or ↓`;
  updateProgramSearchControls();
  renderProgramSearchHighlights();
}

function stepProgramSearch(direction) {
  if (!programSearch.matches.length) {
    refreshProgramSearch();
    if (!programSearch.matches.length) return;
  }
  const index = programSearch.index < 0
    ? programSearchIndexFromAnchor(
      programSearch.matches,
      direction < 0 ? programSearch.anchorStart : programSearch.anchorEnd,
      direction,
    )
    : nextProgramSearchIndex(programSearch.matches, programSearch.index, direction);
  activateProgramSearchMatch(index);
}

function openProgramSearch({replace = false} = {}) {
  const selected = programSearchSelection();
  captureProgramSearchAnchor();
  elements.programSearchPanel.hidden = false;
  elements.programReplaceRow.hidden = !replace;
  if (selected) elements.programSearchInput.value = selected;
  refreshProgramSearch();
  elements.programSearchInput.focus();
  elements.programSearchInput.select();
}

function closeProgramSearch() {
  elements.programSearchPanel.hidden = true;
  elements.programReplaceRow.hidden = true;
  programSearch.index = -1;
  elements.searchHighlights.replaceChildren();
  restoreProgramSearchCaret();
  elements.input.focus({preventScroll: true});
}

function markProgramChanged() {
  if (state.bundledSample) {
    state.toolAssignments = {};
    state.toolAssignmentRevision += 1;
    state.stockProfileCache = null;
  }
  state.bundledSample = false;
  state.programDirty = true;
  state.highlightedSourceLine = null;
  positionProgramLineHighlight();
  renderProgramLineNumbers();
  elements.status.textContent = "Program changed — plot to refresh";
  if (elements.compareDialog.open && state.comparisonOriginal) renderComparison();
  schedulePersist();
}

function programOffsetAfterReplacement(offset, match, replacementLength) {
  if (offset <= match.start) return offset;
  if (offset >= match.end) return offset + replacementLength - (match.end - match.start);
  return match.start + replacementLength;
}

function programOffsetAfterAllReplacements(offset, matches, replacementLength) {
  let adjusted = offset;
  let priorDelta = 0;
  for (const match of matches) {
    if (offset <= match.start) break;
    if (offset < match.end) return match.start + priorDelta + replacementLength;
    const delta = replacementLength - (match.end - match.start);
    adjusted += delta;
    priorDelta += delta;
  }
  return adjusted;
}

function preserveProgramSearchAnchor(start, end) {
  programSearch.anchorStart = start;
  programSearch.anchorEnd = end;
  restoreProgramSearchCaret();
}

function replaceCurrentProgramMatch() {
  if (programSearch.kind !== "text" || programSearch.index < 0) return;
  const match = programSearch.matches[programSearch.index];
  const replacement = elements.programReplaceInput.value;
  const anchorStart = programOffsetAfterReplacement(programSearch.anchorStart, match, replacement.length);
  const anchorEnd = programOffsetAfterReplacement(programSearch.anchorEnd, match, replacement.length);
  elements.input.value = replaceProgramSearchMatch(elements.input.value, match, replacement);
  preserveProgramSearchAnchor(anchorStart, anchorEnd);
  markProgramChanged();
  refreshProgramSearch();
  elements.programReplaceInput.focus();
}

function replaceEveryProgramMatch() {
  if (programSearch.kind !== "text" || !programSearch.matches.length) return;
  const replacement = elements.programReplaceInput.value;
  const matches = programSearch.matches;
  const anchorStart = programOffsetAfterAllReplacements(programSearch.anchorStart, matches, replacement.length);
  const anchorEnd = programOffsetAfterAllReplacements(programSearch.anchorEnd, matches, replacement.length);
  const replaced = replaceAllProgramSearchMatches(elements.input.value, matches, replacement);
  elements.input.value = replaced.value;
  preserveProgramSearchAnchor(anchorStart, anchorEnd);
  markProgramChanged();
  refreshProgramSearch();
  elements.programSearchStatus.textContent = `Replaced ${replaced.count}`;
  elements.programReplaceInput.focus();
}

function persistSession() {
  try {
    const preferences = {};
    for (const id of preferenceIds) {
      const control = $(id);
      preferences[id] = control.type === "checkbox" ? control.checked : control.value;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      preferences,
      fileName: elements.fileName.textContent,
      program: elements.input.value,
      toolAssignments: toolAssignmentsForPersistence(state.toolAssignments),
      toolAssignmentScope: state.toolAssignmentScope,
      bundledSample: isExactBundledProgram(elements.input.value, sampleProgram, state.bundledSample),
    }));
  } catch {
    // Storage can be unavailable in hardened browsers; G-Code Studio remains fully usable.
  }
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistSession, 180);
}

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || typeof saved !== "object") return false;
    for (const [id, value] of Object.entries(saved.preferences || {})) {
      const control = $(id);
      if (!control) continue;
      if (control.type === "checkbox") control.checked = Boolean(value);
      else if (control.tagName !== "SELECT" || [...control.options].some((option) => option.value === value)) control.value = String(value);
    }
    if (typeof saved.program === "string" && saved.program.trim()) {
      elements.input.value = saved.program;
      elements.fileName.textContent = typeof saved.fileName === "string" ? saved.fileName : "restored-program.nc";
      state.bundledSample = isExactBundledProgram(saved.program, sampleProgram, saved.bundledSample === true);
      if (saved.toolAssignments && typeof saved.toolAssignments === "object" && !Array.isArray(saved.toolAssignments)) {
        state.toolAssignments = Object.fromEntries(Object.entries(saved.toolAssignments).filter(([key, assignment]) => (
          /^T[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/i.test(key)
          && assignment
          && typeof assignment === "object"
          && !Array.isArray(assignment)
        )));
      }
      state.toolAssignmentScope = typeof saved.toolAssignmentScope === "string" ? saved.toolAssignmentScope : null;
      return true;
    }
  } catch {
    // Ignore damaged or unavailable local state and load the sample instead.
  }
  return false;
}

function normalizeMachineProfile(profile) {
  const fallback = DEFAULT_MACHINE_PROFILES.find((item) => item.id === profile?.id) || DEFAULT_MACHINE_PROFILES[1];
  const needsTemplateUpgrade = Number(profile?.templateRevision || 0) < Number(fallback.templateRevision || 0);
  const upgraded = {...profile};
  if (needsTemplateUpgrade) {
    for (const [field, estimate] of Object.entries(fallback)) {
      const existing = upgraded[field];
      if (existing === null || existing === undefined || existing === "" || existing === "unknown") upgraded[field] = estimate;
    }
    if (!upgraded.notes || upgraded.notes === "Control model is provisional. Confirm against the machine control panel.") upgraded.notes = fallback.notes;
    upgraded.templateRevision = fallback.templateRevision;
  }
  const normalized = {...fallback, ...upgraded};
  for (const field of NUMERIC_MACHINE_FIELDS) {
    const value = normalized[field];
    normalized[field] = value === "" || value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
  }
  return normalized;
}

function mergeMachineProfiles(...collections) {
  const profiles = new Map();
  for (const collection of collections) {
    for (const candidate of collection || []) {
      if (!candidate?.id) continue;
      const profile = normalizeMachineProfile(candidate);
      const current = profiles.get(profile.id);
      const currentTime = Date.parse(current?.updatedAt || "") || 0;
      const nextTime = Date.parse(profile.updatedAt || "") || 0;
      if (!current || nextTime >= currentTime) profiles.set(profile.id, profile);
    }
  }
  return [...profiles.values()];
}

function readMachineProfileCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(MACHINE_PROFILE_CACHE_KEY) || "null");
    return Array.isArray(cached?.profiles) ? cached.profiles : [];
  } catch {
    return [];
  }
}

function persistMachineProfileCache() {
  try {
    localStorage.setItem(MACHINE_PROFILE_CACHE_KEY, JSON.stringify({profiles: state.machineProfiles}));
  } catch {
    // Profiles can still sync through the hosted API when local browser storage is unavailable.
  }
}

function machineOptionLabel(profile) {
  return `${profile.name || "Unnamed machine"}${profile.status === "draft" && profile.id !== "generic-lathe" ? " (Draft)" : ""}`;
}

function renderMachineSelect(preferredId = elements.machine.value) {
  elements.machine.replaceChildren();
  for (const profile of state.machineProfiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = machineOptionLabel(profile);
    elements.machine.append(option);
  }
  const selected = state.machineProfiles.some((profile) => profile.id === preferredId) ? preferredId : state.machineProfiles[0]?.id;
  if (selected) elements.machine.value = selected;
}

async function requestMachineProfileSave(profile) {
  const response = await fetch("/api/machines", {
    method: "PUT",
    credentials: "same-origin",
    headers: {"content-type": "application/json", accept: "application/json"},
    body: JSON.stringify(profile),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Machine profile sync failed");
  if (!body.profile?.id) throw new Error("Machine profile sync returned an invalid response");
  return body.profile;
}

async function loadMachineProfiles() {
  try {
    const response = await fetch("/api/machines", {credentials: "same-origin", headers: {accept: "application/json"}, cache: "no-store"});
    if (!response.ok) return;
    const body = await response.json();
    if (!Array.isArray(body.profiles)) return;
    const selected = elements.machine.value;
    state.machineProfiles = mergeMachineProfiles(DEFAULT_MACHINE_PROFILES, body.profiles, state.machineProfiles);
    persistMachineProfileCache();
    renderMachineSelect(selected);
    plotProgram();
  } catch {
    // The desktop/offline editions intentionally continue with their local profile cache.
  }
}

function currentMachineProfile() {
  return state.machineProfiles.find((profile) => profile.id === elements.machine.value) || state.machineProfiles[0];
}

function machineLengthMm(value, profile) {
  return Number(value) * (profile.units === "inch" ? 25.4 : 1);
}

function selectedProgramUnits(profile = currentMachineProfile()) {
  if (elements.programUnits.value === "inch" || elements.programUnits.value === "mm") return elements.programUnits.value;
  return profile?.units === "mm" ? "mm" : "inch";
}

function updateProgramUnitsHint(profile = currentMachineProfile()) {
  const selected = selectedProgramUnits(profile);
  const label = selected === "inch" ? "Inches" : "Millimeters";
  const source = elements.programUnits.value === "machine" ? `Machine default: ${label}.` : `Fallback: ${label}.`;
  elements.programUnitsHint.textContent = `${source} Used when G20/G21 is absent.`;
}

function machinePlotOptions(profile) {
  if (!profile) return {initialPosition: null, referencePosition: null};
  const hasNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  const point = (x, z) => hasNumber(x) && hasNumber(z)
    ? {x: machineLengthMm(x, profile), z: machineLengthMm(z, profile)}
    : null;
  let referencePosition = profile.startMode === "home" ? point(profile.startX, profile.startZ) : null;
  if (!referencePosition) {
    const radialTravel = Math.abs(Number(profile.xTravelMax) - Number(profile.xTravelMin));
    const axialTravel = Math.abs(Number(profile.zTravelMax) - Number(profile.zTravelMin));
    if (radialTravel > 0 && axialTravel > 0) {
      referencePosition = point(profile.xProgramming === "diameter" ? radialTravel * 2 : radialTravel, axialTravel);
    }
  }
  const initialPosition = profile.startMode === "unknown" ? null : (point(profile.startX, profile.startZ) || referencePosition);
  return {
    initialPosition,
    referencePosition,
    defaultUnits: selectedProgramUnits(profile),
    warnOnAssumedUnits: true,
    rapidBehavior: profile.rapidBehavior,
    rapidXMax: hasNumber(profile.rapidXMax) ? machineLengthMm(profile.rapidXMax, profile) : null,
    rapidZMax: hasNumber(profile.rapidZMax) ? machineLengthMm(profile.rapidZMax, profile) : null,
  };
}

function updateMachineStatusBadge(status) {
  const confirmed = status === "shop-confirmed";
  elements.machineStatusBadge.textContent = confirmed ? "SHOP-CONFIRMED" : "DRAFT";
  elements.machineStatusBadge.className = `status-badge ${confirmed ? "confirmed" : "draft"}`;
}

function openMachineEditor() {
  const profile = currentMachineProfile();
  if (!profile) return;
  elements.machineDialogTitle.textContent = profile.name;
  elements.machineSaveStatus.textContent = "";
  elements.machineSaveStatus.className = "";
  for (const field of MACHINE_PROFILE_FIELDS) {
    const control = elements.machineForm.elements.namedItem(field);
    if (control) control.value = profile[field] ?? "";
  }
  updateMachineStatusBadge(profile.status);
  elements.machineDialog.showModal();
}

function readMachineEditor(profile) {
  const next = {...profile};
  for (const field of MACHINE_PROFILE_FIELDS) {
    const control = elements.machineForm.elements.namedItem(field);
    if (!control) continue;
    if (NUMERIC_MACHINE_FIELDS.has(field)) next[field] = control.value === "" ? null : Number(control.value);
    else next[field] = control.value.trim();
  }
  next.updatedAt = new Date().toISOString();
  return normalizeMachineProfile(next);
}

async function saveMachineEditor(event) {
  event.preventDefault();
  if (!elements.machineForm.reportValidity()) return;
  const current = currentMachineProfile();
  if (!current) return;
  const profile = readMachineEditor(current);
  const index = state.machineProfiles.findIndex((item) => item.id === profile.id);
  if (index >= 0) state.machineProfiles[index] = profile;
  persistMachineProfileCache();
  renderMachineSelect(profile.id);
  updateProgramUnitsHint(profile);
  elements.machineDialogTitle.textContent = profile.name;
  updateMachineStatusBadge(profile.status);
  persistSession();
  plotProgram();
  elements.machineSaveStatus.className = "";
  elements.machineSaveStatus.textContent = "Saving…";

  try {
    const saved = normalizeMachineProfile(await requestMachineProfileSave(profile));
    state.machineProfiles[index] = saved;
    persistMachineProfileCache();
    renderMachineSelect(saved.id);
    elements.machineSaveStatus.textContent = "Saved and synced.";
    setTimeout(() => { if (elements.machineDialog.open) elements.machineDialog.close(); }, 450);
  } catch {
    elements.machineSaveStatus.className = "error";
    elements.machineSaveStatus.textContent = "Saved on this device; online sync is unavailable.";
  }
}

function loadProgram(name, content, {bundledSample = false} = {}) {
  state.toolAssignments = {};
  state.toolAssignmentScope = null;
  state.bundledSample = bundledSample === true;
  state.toolAssignmentRevision += 1;
  state.stockProfileCache = null;
  elements.input.value = content;
  elements.fileName.textContent = name || "program.nc";
  elements.programSearchPanel.hidden = true;
  elements.programReplaceRow.hidden = true;
  programSearch.matches = [];
  programSearch.index = -1;
  programSearch.kind = "empty";
  elements.searchHighlights.replaceChildren();
  plotProgram();
  persistSession();
}

async function loadBrowserFile(file) {
  if (!file) return;
  loadProgram(file.name, await file.text());
}

async function openProgram() {
  if (window.pywebview?.api?.open_gcode) {
    const selected = await window.pywebview.api.open_gcode();
    if (selected?.error) { elements.status.textContent = selected.error; return; }
    if (selected?.content) loadProgram(selected.name, selected.content);
    return;
  }
  elements.fileInput.click();
}

async function saveProgram() {
  const suggestedName = elements.fileName.textContent || "program.nc";
  if (window.pywebview?.api?.save_gcode) {
    const saved = await window.pywebview.api.save_gcode(suggestedName, elements.input.value);
    if (saved?.error) { elements.status.textContent = saved.error; return; }
    if (saved?.name) {
      elements.fileName.textContent = saved.name;
      elements.status.textContent = `Saved ${saved.name}`;
      persistSession();
    }
    return;
  }
  const blob = new Blob([elements.input.value], {type: "text/plain;charset=utf-8"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = suggestedName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function setComparisonOriginal(name, content) {
  state.comparisonOriginal = {name: name || "original-program.nc", content: String(content ?? "")};
  $("originalCompareName").textContent = state.comparisonOriginal.name;
  $("originalCompareMeta").textContent = `${state.comparisonOriginal.content.replace(/\r/g, "").split("\n").length} lines · held in memory on this device`;
  renderComparison();
}

async function chooseComparisonOriginal() {
  if (window.pywebview?.api?.open_gcode) {
    const selected = await window.pywebview.api.open_gcode();
    if (selected?.error) { elements.status.textContent = selected.error; return; }
    if (selected?.content) setComparisonOriginal(selected.name, selected.content);
    return;
  }
  elements.originalFileInput.click();
}

function comparisonStatusLabel(type) {
  return {modified: "CHANGED", added: "ADDED", removed: "REMOVED", unchanged: ""}[type] || "";
}

function appendCodeSegments(container, segments) {
  for (const segment of segments) {
    const span = document.createElement("span");
    span.textContent = segment.text;
    if (segment.changed) span.className = "changed-token";
    container.append(span);
  }
}

function comparisonCodeCell(line, row, side) {
  const cell = document.createElement("code");
  cell.className = `compare-code compare-code-${side}`;
  cell.setAttribute("role", "cell");
  if (!line) {
    cell.classList.add("empty-code");
    cell.textContent = "—";
    return cell;
  }
  if (row.type === "modified") {
    const tokenDiff = diffLineTokens(row.original.text, row.revised.text, {ignoreFormatting: elements.ignoreFormatting.checked});
    appendCodeSegments(cell, tokenDiff[side]);
  } else {
    const span = document.createElement("span");
    span.textContent = line.text || " ";
    if (row.type !== "unchanged") span.className = "changed-token";
    cell.append(span);
  }
  return cell;
}

function scrollToComparisonChange(index) {
  const changes = [...elements.compareRows.querySelectorAll(".compare-row.is-change")];
  if (!changes.length) {
    state.compareChangeIndex = -1;
    elements.comparePosition.textContent = "0 / 0";
    elements.previousCompareChange.disabled = true;
    elements.nextCompareChange.disabled = true;
    return;
  }
  state.compareChangeIndex = (index + changes.length) % changes.length;
  elements.comparePosition.textContent = `${state.compareChangeIndex + 1} / ${changes.length}`;
  elements.previousCompareChange.disabled = false;
  elements.nextCompareChange.disabled = false;
  changes[state.compareChangeIndex].scrollIntoView({block: "center", behavior: "smooth"});
  changes.forEach((row, rowIndex) => row.classList.toggle("current-change", rowIndex === state.compareChangeIndex));
}

function renderComparisonRows() {
  elements.compareRows.replaceChildren();
  const rows = state.comparison?.rows || [];
  const visibleRows = elements.differencesOnly.checked ? rows.filter((row) => row.type !== "unchanged") : rows;
  for (const row of visibleRows) {
    const rowElement = document.createElement("div");
    rowElement.className = `compare-grid compare-row ${row.type}${row.type === "unchanged" ? "" : " is-change"}`;
    rowElement.setAttribute("role", "row");

    const originalNumber = document.createElement("span");
    originalNumber.className = "compare-line-number";
    originalNumber.setAttribute("role", "cell");
    originalNumber.textContent = row.original?.number ?? "";
    rowElement.append(originalNumber, comparisonCodeCell(row.original, row, "original"));

    const status = document.createElement("span");
    status.className = "compare-row-status";
    status.setAttribute("role", "cell");
    status.textContent = comparisonStatusLabel(row.type);
    rowElement.append(status);

    const revisedNumber = document.createElement("span");
    revisedNumber.className = "compare-line-number";
    revisedNumber.setAttribute("role", "cell");
    revisedNumber.textContent = row.revised?.number ?? "";
    rowElement.append(revisedNumber, comparisonCodeCell(row.revised, row, "revised"));
    elements.compareRows.append(rowElement);
  }
  state.compareChangeIndex = -1;
  const changeCount = elements.compareRows.querySelectorAll(".compare-row.is-change").length;
  elements.comparePosition.textContent = changeCount ? `0 / ${changeCount}` : "0 / 0";
  elements.previousCompareChange.disabled = !changeCount;
  elements.nextCompareChange.disabled = !changeCount;
}

function geometryDisplayPoint(point) {
  return {z: point.z * orientationSign(), x: point.x * xScale()};
}

function comparisonGeometryBounds(geometry, fitMode) {
  const candidates = geometryItemsForFit(geometry, fitMode)
    .flatMap((item) => item.segment.points?.length ? item.segment.points : [item.segment.start, item.segment.end])
    .filter(Boolean)
    .map(geometryDisplayPoint);
  if (!candidates.length) return {minZ: -1, maxZ: 1, minX: -1, maxX: 1};
  let minZ = Math.min(...candidates.map((point) => point.z));
  let maxZ = Math.max(...candidates.map((point) => point.z));
  let minX = Math.min(...candidates.map((point) => point.x));
  let maxX = Math.max(...candidates.map((point) => point.x));
  const zPadding = Math.max((maxZ - minZ) * 0.1, 0.5);
  const xPadding = Math.max((maxX - minX) * 0.12, 0.5);
  minZ -= zPadding; maxZ += zPadding; minX -= xPadding; maxX += xPadding;
  return {minZ, maxZ, minX, maxX};
}

function prepareComparisonCanvas(canvas) {
  const rect = canvas.parentElement.getBoundingClientRect();
  const width = Math.max(260, rect.width);
  const height = Math.max(220, rect.height);
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return {canvas, context, width, height};
}

function comparisonGridStep(span) {
  const rough = Math.max(span / 8, 0.001);
  const power = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / power;
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power;
}

function drawComparisonGrid(surface, bounds, scale) {
  const {context, width, height} = surface;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const toScreen = (point) => ({
    x: width / 2 + (point.z - centerZ) * scale,
    y: height / 2 - (point.x - centerX) * scale,
  });
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#061012";
  context.fillRect(0, 0, width, height);
  const step = comparisonGridStep(Math.max(bounds.maxZ - bounds.minZ, bounds.maxX - bounds.minX));
  context.lineWidth = 1;
  context.strokeStyle = "rgba(38, 64, 69, .58)";
  context.beginPath();
  for (let z = Math.ceil(bounds.minZ / step) * step; z <= bounds.maxZ; z += step) {
    const screen = toScreen({z, x: 0});
    context.moveTo(Math.round(screen.x) + 0.5, 0);
    context.lineTo(Math.round(screen.x) + 0.5, height);
  }
  for (let x = Math.ceil(bounds.minX / step) * step; x <= bounds.maxX; x += step) {
    const screen = toScreen({z: 0, x});
    context.moveTo(0, Math.round(screen.y) + 0.5);
    context.lineTo(width, Math.round(screen.y) + 0.5);
  }
  context.stroke();
  context.strokeStyle = "rgba(118, 145, 151, .7)";
  context.beginPath();
  const zero = toScreen({z: 0, x: 0});
  if (zero.x >= 0 && zero.x <= width) { context.moveTo(zero.x, 0); context.lineTo(zero.x, height); }
  if (zero.y >= 0 && zero.y <= height) { context.moveTo(0, zero.y); context.lineTo(width, zero.y); }
  context.stroke();
  return toScreen;
}

function strokeComparisonGeometry(surface, items, bounds, scale, changedColor) {
  const toScreen = drawComparisonGrid(surface, bounds, scale);
  strokeComparisonItems(surface, items.filter((item) => !item.different), toScreen, "rgba(112, 135, 141, .68)", 1.25, 0);
  strokeComparisonItems(surface, items.filter((item) => item.different), toScreen, changedColor, 2.4, 7);
}

function strokeComparisonItems(surface, items, toScreen, color, lineWidth, shadowBlur) {
  const {context} = surface;
  for (const item of items) {
    const points = (item.segment.points?.length ? item.segment.points : [item.segment.start, item.segment.end]).filter(Boolean).map(geometryDisplayPoint);
    if (points.length < 2) continue;
    context.beginPath();
    points.forEach((point, index) => {
      const screen = toScreen(point);
      if (index) context.lineTo(screen.x, screen.y); else context.moveTo(screen.x, screen.y);
    });
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.setLineDash(item.segment.type === "rapid" ? [6, 4] : []);
    context.shadowColor = shadowBlur ? color : "transparent";
    context.shadowBlur = shadowBlur;
    context.stroke();
  }
  context.setLineDash([]);
  context.shadowBlur = 0;
}

function strokeComparisonOverlay(surface, geometry, bounds, scale) {
  const layers = overlayGeometryLayers(geometry);
  const toScreen = drawComparisonGrid(surface, bounds, scale);
  strokeComparisonItems(surface, layers.common, toScreen, "rgba(142, 163, 168, .72)", 1.35, 0);
  strokeComparisonItems(surface, layers.originalOnly, toScreen, "#f59e0b", 4.6, 8);
  strokeComparisonItems(surface, layers.revisedOnly, toScreen, "#fb4f68", 2.25, 8);
}

function renderComparisonGraphics() {
  if (!state.comparisonOriginal || elements.compareGraphicsAudit.hidden) return;
  const machine = currentMachineProfile();
  const options = {xMode: elements.xMode.value, arcChordTolerance: graphicsQuality().arcChordTolerance, ...machinePlotOptions(machine)};
  const originalParsed = parseGcode(state.comparisonOriginal.content, options);
  const revisedParsed = parseGcode(elements.input.value, options);
  const geometry = compareSegmentGeometry(originalParsed.segments, revisedParsed.segments);
  state.comparisonGeometry = geometry;
  const originalLabel = `${geometry.originalOnly} original-only move${geometry.originalOnly === 1 ? "" : "s"}`;
  const revisedLabel = `${geometry.revisedOnly} new or altered move${geometry.revisedOnly === 1 ? "" : "s"}`;
  $("originalGeometryCount").textContent = originalLabel;
  $("revisedGeometryCount").textContent = revisedLabel;
  $("graphicsInfoDifferenceCount").textContent = `${geometry.revisedOnly} difference${geometry.revisedOnly === 1 ? "" : "s"}`;
  const noMotion = !geometry.original.length && !geometry.revised.length;
  $("graphicsVerdict").textContent = noMotion
    ? "No comparable motion was parsed"
    : (geometry.originalOnly || geometry.revisedOnly ? `${geometry.revisedOnly} revised toolpath difference${geometry.revisedOnly === 1 ? "" : "s"}` : "Toolpaths match geometrically");

  const fitMode = elements.fitGeometryPart.checked ? "part" : (elements.fitGeometryDifferences.checked ? "changed" : "all");
  const bounds = comparisonGeometryBounds(geometry, fitMode);
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, 0.001);
  const spanX = Math.max(bounds.maxX - bounds.minX, 0.001);
  if (state.compareGraphicsLayout === "overlay") {
    const overlaySurface = prepareComparisonCanvas(elements.overlayCompareCanvas);
    const scale = Math.min((overlaySurface.width - 28) / spanZ, (overlaySurface.height - 28) / spanX);
    strokeComparisonOverlay(overlaySurface, geometry, bounds, scale);
    return;
  }
  const originalSurface = prepareComparisonCanvas(elements.originalCompareCanvas);
  const revisedSurface = prepareComparisonCanvas(elements.revisedCompareCanvas);
  const scale = Math.min(
    (Math.min(originalSurface.width, revisedSurface.width) - 28) / spanZ,
    (Math.min(originalSurface.height, revisedSurface.height) - 28) / spanX,
  );
  strokeComparisonGeometry(originalSurface, geometry.original, bounds, scale, "#f59e0b");
  strokeComparisonGeometry(revisedSurface, geometry.revised, bounds, scale, "#fb4f68");
}

function setComparisonGraphicsLayout(layout) {
  state.compareGraphicsLayout = layout === "overlay" ? "overlay" : "split";
  const overlay = state.compareGraphicsLayout === "overlay";
  elements.compareSplitPlots.hidden = overlay;
  elements.compareOverlayPlot.hidden = !overlay;
  elements.compareSplitLayout.classList.toggle("active", !overlay);
  elements.compareOverlayLayout.classList.toggle("active", overlay);
  elements.compareSplitLayout.setAttribute("aria-pressed", String(!overlay));
  elements.compareOverlayLayout.setAttribute("aria-pressed", String(overlay));
  elements.graphicsViewportNote.textContent = overlay
    ? "Both programs share one machine setup, orientation, scale, and viewport."
    : "Both windows use the same machine setup, orientation, scale, and viewport.";
  if (state.compareView === "graphics") requestAnimationFrame(renderComparisonGraphics);
}

function setComparisonView(view) {
  state.compareView = view;
  const graphics = view === "graphics";
  elements.compareCodeAudit.hidden = graphics;
  elements.compareGraphicsAudit.hidden = !graphics;
  elements.compareCodeView.classList.toggle("active", !graphics);
  elements.compareGraphicsView.classList.toggle("active", graphics);
  elements.compareCodeView.setAttribute("aria-pressed", String(!graphics));
  elements.compareGraphicsView.setAttribute("aria-pressed", String(graphics));
  document.querySelectorAll(".code-audit-control").forEach((control) => { control.hidden = graphics; });
  document.querySelectorAll(".graphics-audit-control").forEach((control) => { control.hidden = !graphics; });
  elements.compareNavigation.hidden = graphics;
  if (graphics) requestAnimationFrame(renderComparisonGraphics);
}

function setGraphicsInfo(open) {
  elements.graphicsInfoPanel.hidden = !open;
  elements.graphicsInfoButton.setAttribute("aria-expanded", String(open));
  elements.graphicsInfoButton.classList.toggle("active", open);
  if (open) requestAnimationFrame(renderComparisonGraphics);
}

function renderComparison() {
  $("revisedCompareName").textContent = elements.fileName.textContent || "current-program.nc";
  $("revisedCompareMeta").textContent = `${elements.input.value.replace(/\r/g, "").split("\n").length} lines · current editor contents`;
  if (!state.comparisonOriginal) {
    elements.compareEmpty.hidden = false;
    elements.compareResults.hidden = true;
    return;
  }

  $("originalCompareName").textContent = state.comparisonOriginal.name;
  state.comparison = comparePrograms(state.comparisonOriginal.content, elements.input.value, {
    ignoreFormatting: elements.ignoreFormatting.checked,
  });
  const {summary, words} = state.comparison;
  elements.compareEmpty.hidden = true;
  elements.compareResults.hidden = false;
  $("compareChangedCount").textContent = summary.modified;
  $("compareAddedCount").textContent = summary.added;
  $("compareRemovedCount").textContent = summary.removed;
  $("compareUnchangedCount").textContent = summary.unchanged;
  $("compareCoordinateWords").textContent = `X/Z & DIM ${words.coordinates}`;
  $("compareCommandWords").textContent = `G/M/T ${words.commands}`;
  $("compareProcessWords").textContent = `F/S ${words.process}`;
  $("compareReferenceWords").textContent = `N/O/P/Q ${words.references}`;

  const identical = summary.differences === 0;
  const badge = $("compareVerdictBadge");
  badge.textContent = identical ? "MATCH" : "REVIEW";
  badge.className = `compare-verdict-badge ${identical ? "match" : "review"}`;
  $("compareVerdict").textContent = identical ? "Programs match" : `${summary.differences} difference${summary.differences === 1 ? "" : "s"} found`;
  $("compareVerdictDetail").textContent = identical
    ? (elements.ignoreFormatting.checked ? "No code-value differences; spacing and letter case are ignored." : "The files match exactly, line for line.")
    : "Review every highlighted block before releasing the revision.";
  renderComparisonRows();
  if (state.compareView === "graphics") requestAnimationFrame(renderComparisonGraphics);
}

function openComparison() {
  renderComparison();
  elements.compareDialog.showModal();
}

function xScale() { return elements.xMode.value === "diameter" ? 0.5 : 1; }
function orientationSign() { return elements.orientation.value === "left" ? 1 : -1; }
function unitScale() { return scaleForUnits(elements.displayUnits.value); }
function unitName() { return elements.displayUnits.value === "inch" ? "in" : "mm"; }
function displayValue(mm) { return mm / unitScale(); }
function setupValue(input) { return (Number(input.value) || 0) * unitScale(); }
function configuredStockBounds(overallLength) {
  return stockPlacement(overallLength, setupValue(elements.chuckFaceZ), setupValue(elements.stockGripLength));
}
function graphicsQuality() { return graphicsQualityPreset(elements.graphicsQuality.value); }
function updateGraphicsQualityHint() {
  const quality = graphicsQuality();
  const chord = displayValue(quality.arcChordTolerance);
  const decimals = elements.displayUnits.value === "inch" ? 4 : 3;
  const resolution = quality.id === "precision" ? "Maximum" : quality.id === "fine" ? "High" : "Standard";
  elements.graphicsQualityHint.textContent = `${resolution} surface resolution · ${chord.toFixed(decimals)} ${unitName()} maximum arc display chord.`;
}
function formatDistance(mm, decimals = null) {
  const places = decimals ?? (elements.displayUnits.value === "inch" ? 3 : 1);
  return `${displayValue(mm).toFixed(places)} ${unitName()}`;
}
function collisionOptions() {
  return {
    chuckFaceZ: setupValue(elements.chuckFaceZ),
    jawDiameter: Math.max(0, setupValue(elements.jawDiameter)),
    clearance: Math.max(0, setupValue(elements.clearance)),
    chuckDepth: 18,
    xScale: xScale(),
  };
}
function displayPoint(point) { return {z: point.z * orientationSign(), x: point.x * xScale()}; }
function worldToScreen(point) {
  const shown = displayPoint(point);
  return {x: shown.z * state.camera.scale + state.camera.offsetX, y: -shown.x * state.camera.scale + state.camera.offsetY};
}
function screenToProgram(x, y) {
  return {
    z: ((x - state.camera.offsetX) / state.camera.scale) / orientationSign(),
    x: (-(y - state.camera.offsetY) / state.camera.scale) / xScale(),
  };
}

function geometryToScreen(point) {
  return worldToScreen({z: point.z, x: point.x / xScale()});
}

function resizeCanvas() {
  const rect = elements.wrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (elements.canvas.width !== width || elements.canvas.height !== height) {
    elements.canvas.width = width;
    elements.canvas.height = height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  if (state.viewMode === "3d") request3dNavigationDraw();
  else draw();
}

function fitView() {
  if (state.viewMode === "3d") {
    state.camera3d = {...state.camera3d, zoom: 1, panX: 0, panY: 0};
    request3dNavigationDraw();
    return;
  }
  const rect = elements.wrap.getBoundingClientRect();
  const bounds = boundsIncludingStock();
  if (!bounds || !rect.width || !rect.height) return;
  const zSpan = Math.max(10, bounds.maxZ - bounds.minZ);
  const xSpan = Math.max(10, bounds.maxX - bounds.minX);
  state.camera.scale = Math.max(1, Math.min((rect.width - 80) / zSpan, (rect.height - 80) / xSpan));
  const displayCenterZ = (bounds.minZ + bounds.maxZ) / 2 * orientationSign();
  const centerX = (bounds.minX + bounds.maxX) / 2;
  state.camera.offsetX = rect.width / 2 - displayCenterZ * state.camera.scale;
  state.camera.offsetY = rect.height / 2 + centerX * state.camera.scale;
  state.camera.fitted = true;
  draw();
}

function boundsIncludingStock() {
  let bounds = programBounds(state.parsed.segments, xScale());
  if (elements.collisionToggle.checked) {
    const keepout = collisionOptions();
    const jawRadius = keepout.jawDiameter / 2 + keepout.clearance;
    const chuckBounds = {minX: -jawRadius, maxX: jawRadius, minZ: keepout.chuckFaceZ - keepout.chuckDepth - keepout.clearance, maxZ: keepout.chuckFaceZ + keepout.clearance};
    bounds = bounds ? {
      minX: Math.min(bounds.minX, chuckBounds.minX), maxX: Math.max(bounds.maxX, chuckBounds.maxX),
      minZ: Math.min(bounds.minZ, chuckBounds.minZ), maxZ: Math.max(bounds.maxZ, chuckBounds.maxZ),
    } : chuckBounds;
  }
  if (!elements.stockToggle.checked) return bounds;
  const radius = Math.max(0, setupValue(elements.stockDiameter)) / 2;
  const length = Math.max(0, setupValue(elements.stockLength));
  const axial = configuredStockBounds(length);
  const stock = {minX: -radius, maxX: radius, minZ: axial.startZ, maxZ: axial.endZ};
  if (!bounds) return stock;
  return {
    minX: Math.min(bounds.minX, stock.minX), maxX: Math.max(bounds.maxX, stock.maxX),
    minZ: Math.min(bounds.minZ, stock.minZ), maxZ: Math.max(bounds.maxZ, stock.maxZ),
  };
}

function niceGridStep() {
  const targetDisplay = 70 / state.camera.scale / unitScale();
  const power = 10 ** Math.floor(Math.log10(targetDisplay));
  const normalized = targetDisplay / power;
  return (normalized < 2 ? 2 : normalized < 5 ? 5 : 10) * power * unitScale();
}

function gridDecimals(step) {
  const shown = step / unitScale();
  if (shown < 0.01) return 3;
  if (shown < 0.1) return 2;
  if (shown < 1) return 1;
  return 0;
}

function drawGrid(width, height) {
  const step = niceGridStep();
  const a = screenToProgram(0, height);
  const b = screenToProgram(width, 0);
  const minZ = Math.min(a.z, b.z) - step;
  const maxZ = Math.max(a.z, b.z) + step;
  const minX = Math.min(a.x, b.x) * xScale() - step;
  const maxX = Math.max(a.x, b.x) * xScale() + step;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(83, 112, 151, 0.13)";
  ctx.fillStyle = "rgba(141, 160, 189, 0.62)";
  ctx.font = '9px "Cascadia Code", Consolas, monospace';
  for (let z = Math.floor(minZ / step) * step; z <= maxZ; z += step) {
    const sx = worldToScreen({z, x: 0}).x;
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, height); ctx.stroke();
    if (sx > 20 && sx < width - 35) ctx.fillText(`Z${displayValue(z).toFixed(gridDecimals(step))}`, sx + 4, height - 8);
  }
  for (let radiusX = Math.floor(minX / step) * step; radiusX <= maxX; radiusX += step) {
    const programmedX = radiusX / xScale();
    const sy = worldToScreen({z: 0, x: programmedX}).y;
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(width, sy); ctx.stroke();
    if (sy > 12 && sy < height - 15) ctx.fillText(`X${displayValue(programmedX).toFixed(gridDecimals(step))}`, 5, sy - 4);
  }
  const origin = worldToScreen({z: 0, x: 0});
  ctx.strokeStyle = "rgba(141, 160, 189, 0.35)";
  ctx.beginPath(); ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, height); ctx.moveTo(0, origin.y); ctx.lineTo(width, origin.y); ctx.stroke();
}

function screenRect(z0, z1, radius0, radius1) {
  const a = worldToScreen({z: z0, x: radius0 / xScale()});
  const b = worldToScreen({z: z1, x: radius1 / xScale()});
  return {x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y)};
}

function stockProfileFor(stockDiameter, stockLength) {
  const axial = configuredStockBounds(stockLength);
  let verificationColumns = null;
  try {
    verificationColumns = stockVerificationColumns(axial.length);
    state.stockSamplingError = null;
  } catch (error) {
    state.stockSamplingError = error instanceof Error ? error.message : String(error);
    state.stockProfileCache = null;
    return null;
  }
  const key = {
    parsed: state.parsed,
    stockDiameter,
    stockLength,
    gripLength: axial.gripLength,
    stockStartZ: axial.startZ,
    xScale: xScale(),
    verificationColumns,
    toolAssignmentRevision: state.toolAssignmentRevision,
  };
  const cached = state.stockProfileCache;
  const matches = cached && Object.entries(key).every(([name, value]) => cached.key[name] === value);
  if (!matches) {
    const base = buildStockProfile(state.parsed.segments, {
      stockDiameter,
      stockLength: axial.length,
      stockStartZ: axial.startZ,
      xScale: key.xScale,
      visibleCount: 0,
      columns: key.verificationColumns,
      toolResolver: resolvedCuttingModel,
    });
    state.stockProfileCache = {key, frames: new Map([[0, base]])};
  }

  const target = Math.max(0, Math.min(state.parsed.segments.length, state.visibleBlocks));
  const frames = state.stockProfileCache.frames;
  if (frames.has(target)) return frames.get(target);
  let startIndex = 0;
  let startingStock = frames.get(0);
  for (const [visibleCount, frame] of frames) {
    if (visibleCount <= target && visibleCount >= startIndex) {
      startIndex = visibleCount;
      startingStock = frame;
    }
  }
  const stock = extendStockProfile(startingStock, state.parsed.segments, {
    startIndex,
    endIndex: target,
    xScale: key.xScale,
    toolResolver: resolvedCuttingModel,
  });
  frames.set(target, stock);
  while (frames.size > STOCK_FRAME_CACHE_LIMIT) {
    const oldest = [...frames.keys()].find((visibleCount) => visibleCount !== 0 && visibleCount !== target);
    if (oldest === undefined) break;
    frames.delete(oldest);
  }
  return stock;
}

function stockRadiusAt(stock, z) {
  const positions = stock.zPositions;
  const profile = stock.profile;
  if (!positions?.length || !profile?.length || z < positions[0] - 1e-9 || z > positions.at(-1) + 1e-9) return null;
  const step = positions.length > 1 ? positions[1] - positions[0] : 0;
  if (!step) return profile[0];
  const location = Math.max(0, Math.min(profile.length - 1, (z - positions[0]) / step));
  const before = Math.floor(location);
  const after = Math.min(profile.length - 1, before + 1);
  const fraction = location - before;
  return profile[before] + (profile[after] - profile[before]) * fraction;
}

function exactEntityMatchesStock(entity, stock) {
  const tolerance = Math.max(0.01, stock.length / Math.max(1, stock.columns - 1) * 2);
  const matches = [0, 0.25, 0.5, 0.75, 1].filter((fraction) => {
    const point = geometryPointAt(entity, fraction);
    const stockRadius = stockRadiusAt(stock, point.z);
    return stockRadius !== null && Math.abs(Math.abs(point.x) - stockRadius) <= tolerance;
  }).length;
  return matches >= 4;
}

function oppositeGeometryEntity(entity, id) {
  if (entity.type === "arc") {
    return arcGeometry({
      ...entity,
      id,
      center: {z: entity.center.z, x: -entity.center.x},
      startAngle: -entity.startAngle,
      sweep: -entity.sweep,
      metadata: {...entity.metadata, oppositeProfile: true},
    });
  }
  return lineGeometry({
    ...entity,
    id,
    start: {z: entity.start.z, x: -entity.start.x},
    end: {z: entity.end.z, x: -entity.end.x},
    metadata: {...entity.metadata, oppositeProfile: true},
  });
}

function exactStockContourGeometry(stock) {
  const entities = [];
  const seen = new Set();
  const visibleCount = Math.min(state.visibleBlocks, state.parsed.segments.length);
  state.parsed.segments.slice(0, visibleCount).forEach((segment, blockIndex) => {
    const sourceMotion = segment.sourceMotion || segment.type;
    const entity = motionGeometry({
      segment,
      id: `stock-exact-${blockIndex}`,
      component: "Current stock · exact programmed contour",
      label: `${sourceMotion === "arc-cw" || sourceMotion === "arc-ccw" ? "Programmed radius" : "Programmed line"} · source line ${segment.line}`,
      xScale: xScale(),
      metadata: {blockIndex, sourceLine: segment.line, exact: true},
    });
    if (entity?.type === "line" && Math.abs(entity.end.z - entity.start.z) <= 1e-9) return;
    if (!entity || !exactEntityMatchesStock(entity, stock)) return;
    const key = `${entity.type}:${entity.start.z.toFixed(8)}:${entity.start.x.toFixed(8)}:${entity.end.z.toFixed(8)}:${entity.end.x.toFixed(8)}:${entity.radius?.toFixed(8) || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push(entity, oppositeGeometryEntity(entity, `${entity.id}-lower`));
  });
  return entities;
}

function currentComponentGeometry() {
  const entities = [];
  if (elements.collisionToggle.checked) {
    const options = collisionOptions();
    const jawRadius = options.jawDiameter / 2;
    entities.push(...rectangleGeometry({
      id: "chuck-jaws",
      component: "Chuck / jaws · simplified envelope",
      minZ: options.chuckFaceZ - options.chuckDepth,
      maxZ: options.chuckFaceZ,
      minX: -jawRadius,
      maxX: jawRadius,
    }));
  }

  if (elements.stockToggle.checked) {
    const stockDiameter = Math.max(0, setupValue(elements.stockDiameter));
    const length = Math.max(0, setupValue(elements.stockLength));
    const radius = stockDiameter / 2;
    if (radius && length) {
      const stock = stockProfileFor(stockDiameter, length);
      if (!stock) return entities;
      const profile = stockContourPoints(stock);
      const upper = profile.map((point) => ({z: point.z, x: point.radius}));
      const lower = profile.map((point) => ({z: point.z, x: -point.radius}));
      entities.push(...exactStockContourGeometry(stock));
      const maximumAxialStep = stock.length / Math.max(1, stock.columns - 1);
      entities.push(...polylineGeometry({id: "stock-upper", component: "Current stock", label: "Upper dimensional-grid profile", points: upper, metadata: {sampledContour: true, maximumAxialStep}}));
      entities.push(...polylineGeometry({id: "stock-lower", component: "Current stock", label: "Lower dimensional-grid profile", points: lower, metadata: {sampledContour: true, maximumAxialStep}}));
      if (upper.length && Math.abs(upper[0].x - lower[0].x) > 1e-9) {
        entities.push(lineGeometry({id: "stock-back", component: "Current stock", label: "Back face", start: lower[0], end: upper[0]}));
      }
      if (upper.length && Math.abs(upper.at(-1).x - lower.at(-1).x) > 1e-9) {
        entities.push(lineGeometry({id: "stock-front", component: "Current stock", label: "Front face", start: upper.at(-1), end: lower.at(-1)}));
      }
    }
  }
  return entities;
}

function drawKeepout() {
  if (!elements.collisionToggle.checked) return;
  const options = collisionOptions();
  const jawRadius = options.jawDiameter / 2;
  const bodyBack = options.chuckFaceZ - options.chuckDepth;
  const body = screenRect(bodyBack, options.chuckFaceZ, -jawRadius, jawRadius);
  ctx.fillStyle = "rgba(100, 116, 139, 0.13)";
  ctx.strokeStyle = "rgba(148, 163, 184, 0.42)";
  ctx.lineWidth = 1;
  ctx.fillRect(body.x, body.y, body.width, body.height);
  ctx.strokeRect(body.x, body.y, body.width, body.height);

  const dangerRadius = jawRadius + options.clearance;
  const danger = screenRect(bodyBack - options.clearance, options.chuckFaceZ + options.clearance, -dangerRadius, dangerRadius);
  ctx.fillStyle = "rgba(251, 113, 133, 0.055)";
  ctx.strokeStyle = "rgba(251, 113, 133, 0.52)";
  ctx.setLineDash([5, 4]);
  ctx.fillRect(danger.x, danger.y, danger.width, danger.height);
  ctx.strokeRect(danger.x, danger.y, danger.width, danger.height);
  ctx.setLineDash([]);
}

function drawStock() {
  if (!elements.stockToggle.checked) {
    $("stockRemoved").textContent = "OFF";
    return;
  }
  const stockDiameter = Math.max(0, setupValue(elements.stockDiameter));
  const length = Math.max(0, setupValue(elements.stockLength));
  const radius = stockDiameter / 2;
  if (!radius || !length) return;
  const stock = stockProfileFor(stockDiameter, length);
  if (!stock) {
    $("stockRemoved").textContent = "BLOCKED";
    return;
  }
  $("stockRemoved").textContent = `${stock.removedPercent.toFixed(1)}%`;

  const envelope = screenRect(stock.startZ, stock.endZ, -radius, radius);
  ctx.fillStyle = "rgba(245, 158, 11, 0.025)";
  ctx.fillRect(envelope.x, envelope.y, envelope.width, envelope.height);

  const profilePoints = stockContourPoints(stock, {maximumPoints: Math.min(graphicsQuality().stockColumns, 1200)});
  if (!profilePoints.length) return;
  const traceProfile = (points, sign, move) => {
    points.forEach((point, index) => {
      const screen = worldToScreen({z: point.z, x: sign * point.radius / xScale()});
      if (index || !move) ctx.lineTo(screen.x, screen.y); else ctx.moveTo(screen.x, screen.y);
    });
  };
  ctx.beginPath();
  traceProfile(profilePoints, 1, true);
  traceProfile([...profilePoints].reverse(), -1, false);
  ctx.closePath();
  ctx.fillStyle = "rgba(56, 189, 248, 0.14)";
  ctx.fill();
  ctx.beginPath();
  traceProfile(profilePoints, 1, true);
  traceProfile(profilePoints, -1, true);
  ctx.strokeStyle = "rgba(86, 204, 220, 0.55)";
  ctx.lineWidth = 0.9;
  ctx.stroke();

  ctx.strokeStyle = "rgba(56, 189, 248, 0.34)";
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(envelope.x, envelope.y, envelope.width, envelope.height);
  ctx.setLineDash([]);
}

function activeProgramToolKey() {
  return activeToolKeyAtLine(state.parsed.executableToolCalls || [], state.programLine);
}

function toolCallsForKey(toolKey) {
  return (state.parsed.executableToolCalls || []).filter((call) => call.key === toolKey);
}

function configuredToolAssembly2d(toolKey = activeProgramToolKey()) {
  const assignment = toolKey ? state.toolAssignments[toolKey] : null;
  const assemblyRef = toolAssignmentAssemblyRef(assignment);
  const definition = assemblyRef && assemblyRef.legacy !== true
    ? resolveAssignableToolAssembly2d({id: assemblyRef.id, revision: assemblyRef.revision})
    : null;
  if (!definition) return null;
  return {
    ...definition,
    cuttingModel: {
      ...definition.cuttingModel,
      tipDatum: assignment.tipDatum || definition.cuttingModel?.tipDatum || null,
      axialDirection: assignment.axialDirection || definition.cuttingModel?.axialDirection || null,
    },
  };
}

function toolAssignmentReadiness(toolKey) {
  const assignment = state.toolAssignments[toolKey];
  if (!toolAssignmentAssemblyRef(assignment)) return {status: "unassigned", ready: false, errors: ["No tool selected."]};
  const configured = configuredToolAssembly2d(toolKey);
  if (!configured) return {status: "blocked", ready: false, errors: ["The selected tool definition is unavailable."]};
  const model = buildToolAssembly2d(configured, {z: 0, x: 0});
  if (!model.valid) return {status: "blocked", ready: false, errors: model.errors};
  if (assignment.confirmed !== true) return {status: "blocked", ready: false, errors: ["The tool selection has not been explicitly confirmed."]};
  if (model.cuttingModel?.simulationReady !== true) {
    return {
      status: "blocked",
      ready: false,
      errors: [model.cuttingModel?.blockedReason || "This tool does not yet have a confirmed dimensional stock-removal model."],
    };
  }
  return {status: "confirmed", ready: true, errors: [], configured, model};
}

function resolvedCuttingModel(toolKey) {
  if (!toolKey) return null;
  const readiness = toolAssignmentReadiness(toolKey);
  if (!readiness.ready) return readiness.status === "unassigned" ? null : {mode: "unsupported"};
  return readiness.model.cuttingModel;
}

function assignmentWarnings() {
  const warnings = [];
  if (elements.stockToggle.checked) {
    const length = Math.max(0, setupValue(elements.stockLength));
    try {
      stockVerificationColumns(configuredStockBounds(length).length);
    } catch (error) {
      warnings.push({
        line: null,
        danger: true,
        message: `Stock simulation is blocked: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  const firstUnassignedMotion = (state.parsed.segments || []).find((segment) => segment.type !== "rapid" && !segment.toolKey);
  if (firstUnassignedMotion) {
    warnings.push({
      line: firstUnassignedMotion.executionLine || firstUnassignedMotion.line || null,
      danger: true,
      message: "A cutting move occurs before any executable T call. Its tool-dependent stock removal is blocked.",
    });
  }
  warnings.push(...[...new Set((state.parsed.executableToolCalls || []).map((call) => call.key))].flatMap((toolKey) => {
    const readiness = toolAssignmentReadiness(toolKey);
    if (readiness.ready) {
      const model = readiness.model.cuttingModel;
      if (model.mode !== "axial-band") return [];
      const messages = [];
      for (const segment of state.parsed.segments.filter((entry) => entry.toolKey === toolKey && entry.type !== "rapid")) {
        const sourceMotion = segment.sourceMotion || segment.type;
        if (sourceMotion === "arc-cw" || sourceMotion === "arc-ccw") {
          messages.push({line: segment.executionLine || segment.line, danger: true, message: `${toolKey} uses a finite-width cutter on an arc. Exact swept-arc stock removal is not yet supported, so that cut is blocked.`});
          continue;
        }
        const deltaZ = segment.end.z - segment.start.z;
        const allowed = model.axialDirection === "both"
          || Math.abs(deltaZ) <= 1e-9
          || (model.axialDirection === "positive-z" && deltaZ > 0)
          || (model.axialDirection === "negative-z" && deltaZ < 0);
        if (!allowed) messages.push({line: segment.executionLine || segment.line, danger: true, message: `${toolKey} is not confirmed for this Z cutting direction; stock removal is blocked for this move.`});
      }
      return messages;
    }
    const first = toolCallsForKey(toolKey)[0];
    const message = readiness.status === "unassigned"
      ? `${toolKey} is unassigned. Its motion remains visible, but stock removal is blocked until the program tool is selected.`
      : `${toolKey} tool definition is incomplete: ${readiness.errors[0]}`;
    return [{line: first?.line || null, danger: true, message}];
  }));
  return warnings;
}

function invalidateToolAssignments({renderControls = true} = {}) {
  state.toolAssignmentRevision += 1;
  state.stockProfileCache = null;
  if (renderControls) renderProgramToolAssignments();
  updateStats();
  draw();
  schedulePersist();
}

function toolChoiceLabel(definition) {
  const status = TOOL_ASSEMBLY_2D_STATUS[definition.displayVerification || definition.verification]
    || TOOL_ASSEMBLY_2D_STATUS.unverified;
  return `${definition.name} · ${status} · 2D OUTLINE`;
}

function selectField(labelText, values, selected, placeholder, onChange) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const select = document.createElement("select");
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = placeholder;
  select.append(empty);
  for (const [value, labelTextValue, disabled = false] of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labelTextValue;
    option.disabled = disabled;
    select.append(option);
  }
  select.value = selected || "";
  select.addEventListener("change", () => onChange(select.value));
  label.append(select);
  return label;
}

function renderProgramToolAssignments() {
  const calls = state.parsed.executableToolCalls || [];
  const keys = [...new Set(calls.map((call) => call.key))];
  elements.programToolList.replaceChildren();
  const mapped = keys.filter((key) => toolAssignmentReadiness(key).ready).length;
  elements.programToolSummary.textContent = keys.length ? `${mapped}/${keys.length} READY` : "NO T CALLS";
  if (!keys.length) {
    const empty = document.createElement("div");
    empty.className = "program-tool-empty";
    empty.textContent = "Plot a program containing a T call to assign its tools.";
    elements.programToolList.append(empty);
    return;
  }

  const library = listSelectableToolAssemblies2d();
  for (const toolKey of keys) {
    const toolCalls = toolCallsForKey(toolKey);
    const assignment = state.toolAssignments[toolKey] || {};
    const readiness = toolAssignmentReadiness(toolKey);
    const firstSuggestion = toolCalls.flatMap((call) => call.suggestions || [])[0] || null;
    const card = document.createElement("section");
    card.className = `program-tool-card ${readiness.status}`;
    card.dataset.toolKey = toolKey;

    const heading = document.createElement("div");
    heading.className = "program-tool-heading";
    const keyLabel = document.createElement("strong");
    keyLabel.textContent = toolKey;
    const lines = document.createElement("span");
    lines.textContent = `Line${toolCalls.length === 1 ? "" : "s"} ${toolCalls.map((call) => call.line).join(", ")}`;
    heading.append(keyLabel, lines);
    card.append(heading);

    const comments = toolCalls.flatMap((call) => call.comments || []).map((comment) => comment.text).filter(Boolean);
    if (firstSuggestion || comments.length) {
      const hint = document.createElement("p");
      hint.className = "program-tool-hint";
      const suggestionText = firstSuggestion ? `Suggested family: ${firstSuggestion.label}. ` : "";
      hint.textContent = `${suggestionText}${comments[0] ? `Header: “${comments[0]}”` : ""}`.trim();
      card.append(hint);
    }

    const controls = document.createElement("div");
    controls.className = "program-tool-controls";
    const assignmentRef = toolAssignmentAssemblyRef(assignment);
    const selectedDefinition = assignmentRef
      ? toolAssembly2dById(assignmentRef.id, assignmentRef.legacy === true ? null : assignmentRef.revision)
      : null;
    const toolChoices = library.map((definition) => [definition.id, toolChoiceLabel(definition)]);
    if (selectedDefinition && !library.some((definition) => definition.id === selectedDefinition.id)) {
      toolChoices.unshift([selectedDefinition.id, `${selectedDefinition.name} · NOT IMPLEMENTED — SELECT ANOTHER TOOL`, true]);
    }
    controls.append(selectField(
      "Tool assembly",
      toolChoices,
      assignmentRef?.id,
      firstSuggestion ? `Unassigned — suggestion: ${firstSuggestion.label}` : "Unassigned — select exact tool",
      (toolId) => {
        const selected = library.find((entry) => entry.id === toolId) || null;
        const definition = selected ? resolveAssignableToolAssembly2d({id: selected.id, revision: selected.revision}) : null;
        state.toolAssignments[toolKey] = toolId ? createVersionedToolAssignment(definition, {
          tipDatum: definition?.cuttingModel?.tipDatum || null,
          axialDirection: definition?.cuttingModel?.axialDirection || null,
        }) : {};
        invalidateToolAssignments();
      },
    ));

    const browseLibrary = document.createElement("button");
    browseLibrary.type = "button";
    browseLibrary.className = "program-tool-browse";
    browseLibrary.textContent = selectedDefinition ? "Browse / change in Tool Library" : "Choose from Tool Library";
    browseLibrary.addEventListener("click", () => openToolLibrary(toolKey, assignmentRef?.id || null));
    controls.append(browseLibrary);

    const definition = selectedDefinition;
    const datumChoices = definition?.cuttingModel?.tipDatumChoices || [];
    if (datumChoices.length) {
      controls.append(selectField(
        "Programmed Z reference",
        datumChoices.map((value) => [value, ({
          "negative-z-edge": "Negative-Z cutting edge",
          center: "Insert center",
          "positive-z-edge": "Positive-Z cutting edge",
        })[value] || value]),
        assignment.tipDatum,
        `Confirm datum (suggested: ${definition.cuttingModel.recommendedTipDatum || "none"})`,
        (tipDatum) => {
          state.toolAssignments[toolKey] = reviseToolAssignmentSetup(state.toolAssignments[toolKey], {
            tipDatum: tipDatum || null,
          });
          invalidateToolAssignments();
        },
      ));
    }
    const directionChoices = definition?.cuttingModel?.axialDirectionChoices || [];
    if (directionChoices.length) {
      controls.append(selectField(
        "Permitted cutting direction",
        directionChoices.map((value) => [value, ({
          "positive-z": "Toward +Z (back turn)",
          "negative-z": "Toward −Z",
          "radial-only": "Radial plunge only",
        })[value] || value]),
        assignment.axialDirection,
        `Confirm direction (suggested: ${definition.cuttingModel.recommendedAxialDirection || "none"})`,
        (axialDirection) => {
          state.toolAssignments[toolKey] = reviseToolAssignmentSetup(state.toolAssignments[toolKey], {
            axialDirection: axialDirection || null,
          });
          invalidateToolAssignments();
        },
      ));
    }
    const confirmation = document.createElement("button");
    confirmation.type = "button";
    confirmation.className = "program-tool-confirmation";
    const requiredConfigurationComplete = Boolean(assignmentRef)
      && library.some((entry) => entry.id === assignmentRef.id && Number(entry.revision) === Number(assignmentRef.revision))
      && (!datumChoices.length || Boolean(assignment.tipDatum))
      && (!directionChoices.length || Boolean(assignment.axialDirection));
    confirmation.disabled = !requiredConfigurationComplete;
    confirmation.setAttribute("aria-pressed", String(assignment.confirmed === true));
    confirmation.setAttribute("aria-label", `Confirm ${toolKey} mounted holder, insert, hand, and programmed reference convention`);
    confirmation.textContent = assignment.confirmed === true
      ? "Mounted setup confirmed — click to clear confirmation."
      : "Confirm mounted holder, insert, hand, and programmed reference convention.";
    confirmation.addEventListener("click", () => {
      const confirmed = state.toolAssignments[toolKey]?.confirmed !== true;
      const nextAssignment = {...state.toolAssignments[toolKey], confirmed};
      if (confirmed) nextAssignment.confirmationSource = "user";
      else delete nextAssignment.confirmationSource;
      state.toolAssignments[toolKey] = nextAssignment;
      confirmation.setAttribute("aria-pressed", String(confirmed));
      confirmation.textContent = confirmed
        ? "Mounted setup confirmed — click to clear confirmation."
        : "Confirm mounted holder, insert, hand, and programmed reference convention.";
      invalidateToolAssignments({renderControls: false});
      const nextReadiness = toolAssignmentReadiness(toolKey);
      const confirmedCount = keys.filter((key) => toolAssignmentReadiness(key).ready).length;
      elements.programToolSummary.textContent = `${confirmedCount}/${keys.length} READY`;
      card.className = `program-tool-card ${nextReadiness.status}`;
      status.className = `program-tool-chip ${nextReadiness.status === "confirmed" ? "confirmed" : (nextReadiness.status === "blocked" ? "blocked" : "warning")}`;
      status.textContent = nextReadiness.ready ? "STOCK MODEL READY" : nextReadiness.errors[0];
    });
    controls.append(confirmation);
    card.append(controls);

    const meta = document.createElement("div");
    meta.className = "program-tool-meta";
    const status = document.createElement("span");
    status.className = `program-tool-chip ${readiness.status === "confirmed" ? "confirmed" : (readiness.status === "blocked" ? "blocked" : "warning")}`;
    status.textContent = readiness.ready ? "STOCK MODEL READY" : readiness.errors[0];
    meta.append(status);
    if (definition?.insertCuttingWidth) {
      const width = document.createElement("span");
      width.className = "program-tool-chip";
      width.textContent = `W ${displayValue(definition.insertCuttingWidth).toFixed(elements.displayUnits.value === "inch" ? 4 : 3)} ${unitName()}`;
      meta.append(width);
    }
    if (firstSuggestion) {
      const suggestion = document.createElement("span");
      suggestion.className = "program-tool-chip warning";
      suggestion.textContent = "HEADER SUGGESTION · NOT CONFIRMED";
      meta.append(suggestion);
    }
    if (definition?.geometryNotice) {
      const envelope = document.createElement("span");
      envelope.className = "program-tool-chip";
      envelope.textContent = definition.renderingClaim === "manufacturer-cad-projection"
        ? "2D KENNAMETAL CAD PROJECTION"
        : definition.renderingClaim === "catalog-connected-envelope"
          ? "2D CONNECTED CATALOG ENVELOPE"
        : definition.renderingClaim === "catalog-scaled-envelope"
          ? "2D CATALOG ENVELOPE · SEAT/HEAD OMITTED"
          : "GEOMETRY UNVERIFIED";
      envelope.title = definition.geometryNotice;
      meta.append(envelope);
    }
    card.append(meta);
    elements.programToolList.append(card);
  }
}

function toolLibraryRecordKey(record, tab = state.toolLibraryTab) {
  return tab === "assemblies" ? record.id : record.revisionRef;
}

function toolLibraryRecordName(record, tab = state.toolLibraryTab) {
  if (tab === "assemblies") return record.name;
  const kind = tab === "holders" ? "Holder" : "Insert";
  return `${record.manufacturer} ${record.catalogId?.iso || record.catalogId?.ansi || record.materialNumber} · ${kind}`;
}

function toolLibraryRecordShape(record, tab = state.toolLibraryTab) {
  if (tab === "assemblies") return record.facets.shape;
  if (tab === "holders") return record.cuttingGeometry?.insertShape || (record.cuttingGeometry?.application?.includes("groove") ? "groove" : null);
  return record.cuttingGeometry?.shape || null;
}

function toolLibraryRecordFamily(record, tab = state.toolLibraryTab) {
  if (tab === "assemblies") return record.facets.family === "turning" ? "turn" : "groove-profile";
  const application = String(record.cuttingGeometry?.application || "");
  return application.includes("groove") || application.includes("back-turn") ? "groove-profile" : "turn";
}

function toolLibraryRecordDisplayTier(record, tab = state.toolLibraryTab) {
  if (tab !== "assemblies") return "catalog-only";
  const stateValue = record.claims?.displayGeometry?.state;
  if (stateValue === "manufacturer-cad-projection") return "manufacturer-cad-projection";
  if (stateValue === "catalog-construction") return "catalog-construction";
  return "catalog-only";
}

function toolLibraryRecordsForTab(tab = state.toolLibraryTab) {
  if (tab === "holders") return [...TOOL_LIBRARY_CATALOG.holders];
  if (tab === "inserts") return [...TOOL_LIBRARY_CATALOG.inserts];
  return listToolLibraryAssemblies();
}

function toolLibrarySearchText(record, tab = state.toolLibraryTab) {
  if (tab === "assemblies") {
    const detail = toolLibraryAssemblyDetail(record.id);
    return JSON.stringify({assembly: record, holder: detail?.holder, insert: detail?.insert, compatibility: detail?.compatibilityEdge}).toLowerCase();
  }
  const related = TOOL_LIBRARY_CATALOG.assemblies.filter((assembly) => (
    tab === "holders" ? assembly.holderRevisionRef === record.revisionRef : assembly.insertRevisionRef === record.revisionRef
  ));
  return JSON.stringify({record, related}).toLowerCase();
}

function filteredToolLibraryRecords() {
  const queryTokens = elements.toolLibrarySearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const family = elements.toolLibraryFamilyFilter.value;
  const shape = elements.toolLibraryShapeFilter.value;
  const authority = elements.toolLibraryAuthorityFilter.value;
  return toolLibraryRecordsForTab().filter((record) => (
    (!family || toolLibraryRecordFamily(record) === family)
    && (!shape || toolLibraryRecordShape(record) === shape)
    && (!authority || toolLibraryRecordDisplayTier(record) === authority)
    && (!queryTokens.length || queryTokens.every((token) => toolLibrarySearchText(record).includes(token)))
  ));
}

function authorityLabel(claim) {
  return String(claim?.state || "unavailable").replaceAll("-", " ").toUpperCase();
}

function makeAuthority(name, claim) {
  const item = document.createElement("div");
  item.className = `tool-library-authority ${claim?.available ? "available" : "blocked"}`;
  item.dataset.libraryAuthority = name;
  const label = document.createElement("span");
  label.textContent = name.toUpperCase();
  const value = document.createElement("strong");
  value.textContent = authorityLabel(claim);
  if (claim?.blockedReason) item.title = claim.blockedReason;
  item.append(label, value);
  if (claim?.blockedReason) {
    const reason = document.createElement("small");
    reason.textContent = claim.blockedReason;
    item.append(reason);
  }
  return item;
}

function svgNode(tag, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function appendSvgPolyline(svg, points, {className = "", closed = true} = {}) {
  if (!points?.length) return;
  const node = svgNode(closed ? "polygon" : "polyline", {
    points: points.map((point) => `${point.x},${point.y}`).join(" "),
    class: className,
    fill: "none",
  });
  svg.append(node);
}

function insertLibraryPreview(insert) {
  const svg = svgNode("svg", {class: "tool-library-preview-svg", role: "img", "aria-label": `${insert.catalogId.iso} catalog-dimension insert plan`});
  const dimensions = insert.dimensions || {};
  if (insert.cuttingGeometry?.shape === "groove") {
    const width = dimensions.cuttingWidth || 1;
    const depth = dimensions.cuttingDepth || dimensions.profileMaximum || width;
    const padding = Math.max(width, depth) * 0.2;
    svg.setAttribute("viewBox", `${-padding} ${-padding} ${width + padding * 2} ${depth + padding * 2}`);
    const outline = svgNode("rect", {x: 0, y: 0, width, height: depth, rx: dimensions.cornerRadius || 0, class: "insert-outline", fill: "none"});
    svg.append(outline);
    return svg;
  }
  const angle = insert.cuttingGeometry?.includedAngleDegrees;
  const ic = dimensions.inscribedCircle;
  if (!(angle > 0) || !(ic > 0)) return svg;
  const points = catalogDiamondInsertOutline2d({
    includedAngleDegrees: angle,
    inscribedCircle: ic,
    noseRadius: dimensions.noseRadius,
  }).points;
  const maximum = Math.max(...points.flatMap((point) => [Math.abs(point.x), Math.abs(point.y)]), dimensions.holeDiameter || 0);
  const padding = maximum * 0.18;
  svg.setAttribute("viewBox", `${-maximum - padding} ${-maximum - padding} ${(maximum + padding) * 2} ${(maximum + padding) * 2}`);
  appendSvgPolyline(svg, points, {className: "insert-outline"});
  if (dimensions.holeDiameter > 0) svg.append(svgNode("circle", {cx: 0, cy: 0, r: dimensions.holeDiameter / 2, class: "insert-hole", fill: "none"}));
  svg.append(svgNode("circle", {cx: 0, cy: 0, r: ic / 2, class: "insert-ic", fill: "none"}));
  return svg;
}

function holderLibraryPreview(holder) {
  const svg = svgNode("svg", {class: "tool-library-preview-svg", role: "img", "aria-label": `${holder.catalogId.iso} published holder envelope dimensions`});
  const dimensions = holder.dimensions || {};
  const width = dimensions.shankWidth || 1;
  const length = dimensions.overallLength || 1;
  const headLength = Math.min(length, dimensions.headLength || 0);
  const padding = width * 0.45;
  svg.setAttribute("viewBox", `${-padding} ${-padding} ${width + padding * 2} ${length + padding * 2}`);
  svg.append(svgNode("rect", {x: 0, y: 0, width, height: length, class: "holder-envelope", fill: "none"}));
  if (headLength > 0) svg.append(svgNode("rect", {x: 0, y: length - headLength, width, height: headLength, class: "holder-head-zone", fill: "none"}));
  return svg;
}

function mountedAssemblyPreview(detail) {
  const definition = toolAssembly2dById(detail.assembly.id);
  if (!definition || Number(definition.revision) !== Number(detail.assembly.revision)) return null;
  const model = buildToolAssemblyDisplay2d(definition, {z: 0, x: 0}, {spindleDirection: "m4", spindleRunning: true});
  if (!model.valid) return null;
  const paths = model.components.flatMap((component) => (component.paths || [{points: component.outline, closed: true}]).map((path) => ({...path, role: component.role})));
  const allPoints = paths.flatMap((path) => path.points || []).map((point) => ({x: point.z, y: -point.x}));
  if (!allPoints.length) return null;
  const minimumX = Math.min(...allPoints.map((point) => point.x));
  const maximumX = Math.max(...allPoints.map((point) => point.x));
  const minimumY = Math.min(...allPoints.map((point) => point.y));
  const maximumY = Math.max(...allPoints.map((point) => point.y));
  const padding = Math.max(maximumX - minimumX, maximumY - minimumY) * 0.06;
  const svg = svgNode("svg", {class: "tool-library-preview-svg mounted", role: "img", "aria-label": `${detail.assembly.name} retained manufacturer CAD top-plan projection`});
  svg.setAttribute("viewBox", `${minimumX - padding} ${minimumY - padding} ${maximumX - minimumX + padding * 2} ${maximumY - minimumY + padding * 2}`);
  for (const path of paths) {
    appendSvgPolyline(svg, (path.points || []).map((point) => ({x: point.z, y: -point.x})), {
      className: path.role === "insert" ? "insert-outline" : "holder-envelope",
      closed: path.closed !== false,
    });
  }
  return svg;
}

function dimensionLabel(key) {
  return ({
    shankHeight: "Shank height H", shankWidth: "Shank width B", fDimension: "F dimension",
    overallLength: "Overall length L1", headLength: "Head length LH", endChamfer: "End chamfer B4",
    cuttingDepth: "Cutting depth", inscribedCircle: "Insert IC", cuttingEdgeLength: "Cutting edge L10",
    thickness: "Thickness S", noseRadius: "Corner radius Rε", holeDiameter: "Hole diameter D1",
    cuttingWidth: "Cutting width W", profileApMaximum: "Profile AP max", cornerRadius: "Corner radius RR",
  })[key] || key.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function dimensionValue(value) {
  const millimeters = Number(value);
  if (!Number.isFinite(millimeters)) return String(value);
  const metric = String(millimeters);
  const inches = (millimeters / 25.4).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `${metric} mm · ${inches} in`;
}

function dimensionSection(title, record) {
  const section = document.createElement("section");
  section.className = "tool-library-section";
  const heading = document.createElement("h4");
  heading.textContent = title;
  const grid = document.createElement("dl");
  grid.className = "tool-library-dimensions";
  for (const [key, value] of Object.entries(record?.dimensions || {})) {
    if (key === "units" || value === null || value === undefined) continue;
    const term = document.createElement("dt");
    term.textContent = dimensionLabel(key);
    const description = document.createElement("dd");
    description.textContent = dimensionValue(value);
    grid.append(term, description);
  }
  section.append(heading, grid);
  return section;
}

function sourceLinkLabel(source) {
  const sourceIdentity = source.id.split(":");
  const componentIndex = sourceIdentity.findIndex((part) => part === "holder" || part === "insert");
  const component = componentIndex >= 0
    ? `${sourceIdentity[componentIndex] === "holder" ? "Holder" : "Insert"} ${sourceIdentity[componentIndex + 1] || "source"}`
    : "Manufacturer source";
  const kind = ({
    "manufacturer-product-page": "official product dimensions / drawing",
    "manufacturer-cad-step": "official CAD STEP",
    "manufacturer-cad-manifest": "official CAD manifest",
  })[source.kind] || source.kind.replaceAll("-", " ");
  return `${component} · ${kind}`;
}

function sourceSection(sources) {
  const section = document.createElement("section");
  section.className = "tool-library-section";
  const heading = document.createElement("h4");
  heading.textContent = "Official retained sources";
  const list = document.createElement("ul");
  list.className = "tool-library-sources";
  for (const source of sources) {
    if (!source) continue;
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = sourceLinkLabel(source);
    const meta = document.createElement("span");
    meta.textContent = `${source.publisher} · retrieved ${source.retrievedOn}${source.sha256 ? ` · SHA-256 ${source.sha256.slice(0, 12)}…` : ""}`;
    item.append(link, meta);
    list.append(item);
  }
  section.append(heading, list);
  return section;
}

function componentSources(record) {
  return [...new Set(record?.sourceRefs || [])].map((sourceRef) => TOOL_LIBRARY_SOURCE_BY_ID.get(sourceRef)).filter(Boolean);
}

function relatedAssemblies(record, tab = state.toolLibraryTab) {
  if (tab === "assemblies") return [record];
  return TOOL_LIBRARY_CATALOG.assemblies.filter((assembly) => (
    tab === "holders" ? assembly.holderRevisionRef === record.revisionRef : assembly.insertRevisionRef === record.revisionRef
  ));
}

function compatibilitySection(record, tab = state.toolLibraryTab) {
  const section = document.createElement("section");
  section.className = "tool-library-section";
  const heading = document.createElement("h4");
  heading.textContent = tab === "assemblies" ? "Explicit compatibility" : "Mounted assembly records";
  const list = document.createElement("div");
  list.className = "tool-library-compatibility";
  for (const assembly of relatedAssemblies(record, tab)) {
    const detail = toolLibraryAssemblyDetail(assembly.id);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${assembly.name} · ${detail?.compatibilityEdge?.state?.replaceAll("-", " ") || "recorded"}`;
    button.addEventListener("click", () => {
      resetToolLibraryFilters();
      state.toolLibraryTab = "assemblies";
      state.toolLibrarySelection = assembly.id;
      syncToolLibraryTabs();
      renderToolLibrary();
      focusToolLibraryDetail();
    });
    list.append(button);
  }
  if (!list.childElementCount) {
    const empty = document.createElement("span");
    empty.textContent = "No explicit mounted compatibility edge is retained.";
    list.append(empty);
  }
  section.append(heading, list);
  return section;
}

function renderToolLibraryDetail(record) {
  elements.toolLibraryDetail.replaceChildren();
  if (!record) {
    const empty = document.createElement("div");
    empty.className = "tool-library-detail-empty";
    const heading = document.createElement("h3");
    heading.id = "toolLibraryDetailTitle";
    heading.textContent = "No matching record selected";
    const copy = document.createElement("span");
    copy.textContent = "Clear one or more filters to inspect a sourced holder, insert, or mounted assembly record.";
    empty.append(heading, copy);
    elements.toolLibraryDetail.append(empty);
    elements.toolLibraryAssign.disabled = true;
    return;
  }
  const tab = state.toolLibraryTab;
  const detail = tab === "assemblies" ? toolLibraryAssemblyDetail(record.id) : null;
  const header = document.createElement("header");
  const titleBlock = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = tab === "assemblies" ? "MOUNTED ASSEMBLY" : tab === "holders" ? "HOLDER COMPONENT" : "INSERT COMPONENT";
  const title = document.createElement("h3");
  title.id = "toolLibraryDetailTitle";
  title.textContent = toolLibraryRecordName(record, tab);
  titleBlock.append(eyebrow, title);
  const revision = document.createElement("span");
  revision.className = "tool-library-revision";
  revision.textContent = `REV ${record.revision}`;
  header.append(titleBlock, revision);
  elements.toolLibraryDetail.append(header);

  const copy = document.createElement("p");
  copy.className = "tool-library-detail-copy";
  copy.textContent = tab === "assemblies"
    ? (detail.compatibilityEdge.evidence || record.assignment.blockedReason)
    : `${record.catalogId.iso} · material ${record.materialNumber}. Component dimensions and identity are manufacturer published; mounted placement remains an independent assembly claim.`;
  elements.toolLibraryDetail.append(copy);

  const authorities = document.createElement("div");
  authorities.className = "tool-library-authorities";
  authorities.setAttribute("aria-label", "Selected record authority");
  const unavailable = {state: "not established", available: false};
  authorities.append(
    makeAuthority("display", detail?.assembly.claims.displayGeometry || unavailable),
    makeAuthority("reference", detail?.assembly.claims.mountedReference || unavailable),
    makeAuthority("cutting", detail?.assembly.claims.cuttingModel || unavailable),
    makeAuthority("collision", detail?.assembly.claims.collisionModel || unavailable),
  );
  elements.toolLibraryDetail.append(authorities);

  const preview = document.createElement("figure");
  preview.className = "tool-library-preview";
  const previewSvg = detail?.assembly.claims.displayGeometry.available
    ? mountedAssemblyPreview(detail)
    : tab === "holders"
      ? holderLibraryPreview(record)
      : insertLibraryPreview(tab === "inserts" ? record : detail.insert);
  if (previewSvg) preview.append(previewSvg);
  const caption = document.createElement("figcaption");
  const previewInsert = tab === "inserts" ? record : detail?.insert;
  caption.textContent = detail?.assembly.claims.displayGeometry.available
    ? "Retained manufacturer-CAD top-plan display projection at source scale."
    : tab === "holders"
      ? "Published shank envelope and head-length zone only — not a mounted holder-head outline."
      : previewInsert?.cuttingGeometry?.shape === "groove"
        ? "Standalone cutter envelope constructed from published cutting width, depth, and corner radius — not a mounted assembly transform."
        : "Standalone insert plan constructed from published IC, included angle, nose radius, and hole dimensions — not a mounted assembly transform.";
  preview.append(caption);
  elements.toolLibraryDetail.append(preview);

  if (tab === "assemblies") {
    elements.toolLibraryDetail.append(
      dimensionSection(`${detail.holder.catalogId.iso} holder dimensions`, detail.holder),
      dimensionSection(`${detail.insert.catalogId.iso} insert dimensions`, detail.insert),
      compatibilitySection(record, tab),
      sourceSection(detail.sources),
    );
  } else {
    elements.toolLibraryDetail.append(
      dimensionSection(`${record.catalogId.iso} published dimensions`, record),
      compatibilitySection(record, tab),
      sourceSection(componentSources(record)),
    );
  }

  const limitation = document.createElement("div");
  limitation.className = "tool-library-limitation";
  const limitationTitle = document.createElement("strong");
  limitationTitle.textContent = detail?.assembly.assignment.assignable ? "Assignment boundary" : "Why assignment is blocked";
  const limitationText = document.createElement("span");
  limitationText.textContent = detail?.assembly.assignment.assignable
    ? detail.assembly.assignment.blockedOutsideScope
    : detail?.assembly.assignment.blockedReason || "A component record cannot be assigned without an explicit compatible mounted assembly.";
  limitation.append(limitationTitle, limitationText);
  elements.toolLibraryDetail.append(limitation);

  const selectedTarget = elements.toolLibraryTarget.value;
  elements.toolLibraryAssign.disabled = !(tab === "assemblies" && record.assignment.assignable && selectedTarget);
  elements.toolLibraryAssign.textContent = tab === "assemblies" && record.assignment.assignable
    ? "Assign mounted assembly"
    : "Catalog record only";
}

function renderToolLibraryTargetOptions(preferredTarget = null) {
  const previous = preferredTarget || elements.toolLibraryTarget.value;
  elements.toolLibraryTarget.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Choose an executable T call";
  elements.toolLibraryTarget.append(placeholder);
  for (const toolKey of [...new Set((state.parsed.executableToolCalls || []).map((call) => call.key))]) {
    const option = document.createElement("option");
    option.value = toolKey;
    option.textContent = `${toolKey} · line${toolCallsForKey(toolKey).length === 1 ? "" : "s"} ${toolCallsForKey(toolKey).map((call) => call.line).join(", ")}`;
    elements.toolLibraryTarget.append(option);
  }
  if ([...elements.toolLibraryTarget.options].some((option) => option.value === previous)) elements.toolLibraryTarget.value = previous;
  else if (elements.toolLibraryTarget.options.length === 2) elements.toolLibraryTarget.selectedIndex = 1;
}

function renderToolLibrary() {
  const records = filteredToolLibraryRecords();
  if (!records.some((record) => toolLibraryRecordKey(record) === state.toolLibrarySelection)) {
    state.toolLibrarySelection = records.length ? toolLibraryRecordKey(records[0]) : null;
  }
  elements.toolLibraryResultsTitle.textContent = ({assemblies: "MOUNTED ASSEMBLIES", holders: "HOLDERS", inserts: "INSERTS"})[state.toolLibraryTab];
  elements.toolLibraryResultCount.textContent = `${records.length} RESULT${records.length === 1 ? "" : "S"}`;
  elements.toolLibraryResults.replaceChildren();
  for (const record of records) {
    const key = toolLibraryRecordKey(record);
    const item = document.createElement("div");
    item.setAttribute("role", "listitem");
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tool-library-result ${key === state.toolLibrarySelection ? "selected" : ""}`;
    button.setAttribute("aria-pressed", String(key === state.toolLibrarySelection));
    const heading = document.createElement("strong");
    heading.textContent = toolLibraryRecordName(record);
    const identity = document.createElement("span");
    identity.textContent = state.toolLibraryTab === "assemblies"
      ? `${record.revisionRef} · ${record.facets.shape} · ${record.facets.insertIcInches ? `${record.facets.insertIcInches} in IC` : "groove"}`
      : `${record.revisionRef} · material ${record.materialNumber}`;
    const badges = document.createElement("span");
    badges.className = "tool-library-result-badges";
    const sourceBadge = document.createElement("i");
    sourceBadge.textContent = "MANUFACTURER SOURCE";
    const authorityBadge = document.createElement("i");
    authorityBadge.className = toolLibraryRecordDisplayTier(record) === "manufacturer-cad-projection" ? "verified" : "catalog";
    authorityBadge.textContent = toolLibraryRecordDisplayTier(record) === "manufacturer-cad-projection" ? "CAD DISPLAY" : "CATALOG ONLY";
    badges.append(sourceBadge, authorityBadge);
    button.append(heading, identity, badges);
    button.addEventListener("click", () => {
      state.toolLibrarySelection = key;
      renderToolLibrary();
      focusToolLibraryDetail();
    });
    item.append(button);
    elements.toolLibraryResults.append(item);
  }
  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "tool-library-empty";
    empty.setAttribute("role", "listitem");
    const title = document.createElement("strong");
    title.textContent = "No matching records";
    const copy = document.createElement("span");
    copy.textContent = "Clear one or more filters to see the locally bundled manufacturer records.";
    empty.append(title, copy);
    elements.toolLibraryResults.append(empty);
  }
  const selected = records.find((record) => toolLibraryRecordKey(record) === state.toolLibrarySelection) || null;
  renderToolLibraryDetail(selected);
}

function syncToolLibraryTabs() {
  for (const tab of document.querySelectorAll(".tool-library-tab")) {
    const active = tab.dataset.libraryTab === state.toolLibraryTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
}

function setToolLibraryTab(tab) {
  if (!["assemblies", "holders", "inserts"].includes(tab)) return;
  state.toolLibraryTab = tab;
  state.toolLibrarySelection = null;
  syncToolLibraryTabs();
  renderToolLibrary();
}

function resetToolLibraryFilters() {
  elements.toolLibrarySearch.value = "";
  elements.toolLibraryFamilyFilter.value = "";
  elements.toolLibraryShapeFilter.value = "";
  elements.toolLibraryAuthorityFilter.value = "";
}

function focusToolLibraryDetail() {
  const stacked = window.matchMedia("(max-width: 740px)").matches;
  elements.toolLibraryDetail.focus({preventScroll: !stacked});
  if (stacked) elements.toolLibraryDetail.scrollIntoView({block: "start"});
}

function openToolLibrary(targetToolKey = null, selectedAssemblyId = null) {
  if (selectedAssemblyId) resetToolLibraryFilters();
  state.toolLibraryTab = "assemblies";
  state.toolLibrarySelection = selectedAssemblyId || state.toolLibrarySelection || listToolLibraryAssemblies()[0]?.id || null;
  syncToolLibraryTabs();
  renderToolLibraryTargetOptions(targetToolKey);
  renderToolLibrary();
  elements.toolLibraryDialog.showModal();
  requestAnimationFrame(() => elements.toolLibrarySearch.focus());
}

function toolPhysicalToScreen(point) {
  return worldToScreen({z: point.z, x: point.x / xScale()});
}

function updateToolControls() {
  const available = state.viewMode === "2d";
  const active = available && state.showTool2d;
  elements.toolOverlay.disabled = !available;
  elements.toolOverlay.classList.toggle("active", active);
  elements.toolOverlay.setAttribute("aria-pressed", String(active));
  elements.toolOverlay.title = available
    ? "Show or hide the dimension-driven 2D tool outline"
    : "The tool assembly is currently available in 2D only";
  if (!active) elements.toolVerificationBadge.hidden = true;
}

function drawToolAssembly2d() {
  if (state.viewMode !== "2d" || !state.showTool2d) {
    elements.toolVerificationBadge.hidden = true;
    return;
  }
  const toolKey = activeProgramToolKey();
  const configured = configuredToolAssembly2d(toolKey);
  const programmedReference = toolReferencePointForExecution(state.parsed.segments, state.visibleBlocks);
  const physicalReference = programmedReference ? {z: programmedReference.z, x: programmedReference.x * xScale()} : null;
  const spindle = spindleStateAtLine(state.parsed.spindleEvents, state.programLine);
  const badgeStatus = elements.toolVerificationBadge.querySelector("strong");
  elements.toolVerificationBadge.hidden = false;
  if (!toolKey || !configured) {
    elements.toolVerificationBadge.classList.add("invalid");
    badgeStatus.textContent = toolKey ? `${toolKey} UNASSIGNED` : "NO ACTIVE TOOL";
    return;
  }
  const model = buildToolAssemblyDisplay2d(configured, physicalReference, {
    spindleDirection: spindle.direction,
    spindleRunning: spindle.running,
  });
  if (!model.valid) {
    elements.toolVerificationBadge.classList.add("invalid");
    badgeStatus.textContent = `${toolKey} · OUTLINE UNAVAILABLE`;
    return;
  }
  const stoppedLabel = spindle.running === false ? " · STOPPED" : "";
  const spindleLabel = spindle.direction === "m3"
    ? `M3 FACE DOWN${stoppedLabel}`
    : spindle.direction === "m4"
      ? `M4 FACE UP${stoppedLabel}`
      : "ROTATION UNKNOWN · DASHED";
  elements.toolVerificationBadge.classList.toggle("invalid", spindle.direction === "unknown");
  badgeStatus.textContent = `${toolKey} · ${spindleLabel}`;

  const tracePolygon = (points) => {
    points.forEach((point, index) => {
      const screen = toolPhysicalToScreen(point);
      if (index === 0) ctx.moveTo(screen.x, screen.y); else ctx.lineTo(screen.x, screen.y);
    });
  };
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const reference = toolPhysicalToScreen(model.referencePoint);

  const strokePath = (path, stroke, lineWidth = 1.2, dashed = false) => {
    const points = path?.points || [];
    if (points.length < 2) return;
    ctx.beginPath();
    tracePolygon(points);
    if (path.closed !== false) ctx.closePath();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dashed ? [4, 3] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  };

  const componentStyle = {
    holder: ["rgba(203, 213, 225, .92)", 1.2],
    insert: ["#fde68a", 1.45],
    cutter: ["#fde68a", 1.45],
  };
  const components = [...model.components].sort((left, right) => (left.renderOrder || 0) - (right.renderOrder || 0));
  for (const component of components) {
    const [stroke, lineWidth] = componentStyle[component.role] || ["#e5eefc", 1.2];
    const paths = component.paths || [{points: component.outline, closed: true}];
    for (const path of paths) strokePath(path, stroke, lineWidth, component.dashed === true || path.dashed === true);
  }

  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(reference.x - 5, reference.y); ctx.lineTo(reference.x + 5, reference.y);
  ctx.moveTo(reference.x, reference.y - 5); ctx.lineTo(reference.x, reference.y + 5);
  ctx.stroke();
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(reference.x, reference.y, 2.3, 0, Math.PI * 2); ctx.stroke();

  const labelAnchor = toolPhysicalToScreen(model.holder.outline.at(-2) || model.referencePoint);
  ctx.fillStyle = "rgba(253, 230, 138, .88)";
  ctx.font = '8px "Cascadia Code", Consolas, monospace';
  ctx.fillText(`${toolKey} · ${model.name} · ${spindleLabel}`, labelAnchor.x + 5, labelAnchor.y - 5);
  ctx.restore();
}

function segmentScreenPoints(segment) {
  return segment.points.map((point) => worldToScreen(point));
}

function strokeSegment(segment, pending = false) {
  const colors = {rapid: "#f59e0b", rough: "#22c55e", "cycle-profile": "#67e8f9", finish: "#e5eefc", linear: "#38bdf8", "arc-cw": "#a78bfa", "arc-ccw": "#a78bfa"};
  const collision = !pending && collisionPointForSegment(segment, collisionOptions());
  ctx.strokeStyle = pending ? "#64748b" : (collision ? "#fb7185" : (colors[segment.type] || "#94a3b8"));
  ctx.lineWidth = collision ? 2.8 : (segment.type === "rapid" ? 1.2 : (pending ? 1.35 : 2.15));
  ctx.globalAlpha = pending ? 0.38 : 0.98;
  ctx.setLineDash(segment.type === "rapid" ? [6, 5] : []);
  ctx.beginPath();
  segmentScreenPoints(segment).forEach((screen, index) => {
    if (index === 0) ctx.moveTo(screen.x, screen.y); else ctx.lineTo(screen.x, screen.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawProgramPointMarkers2d(count) {
  for (const hit of state.graphicsHits) {
    const point = hit.points.at(-1);
    if (!point) continue;
    const visible = hit.blockIndex < count;
    const hovered = hit.blockIndex === state.hoverBlockIndex;
    ctx.beginPath();
    ctx.arc(point.x, point.y, hovered ? 4.5 : 2.2, 0, Math.PI * 2);
    ctx.fillStyle = hovered ? "#f8fafc" : (visible ? "rgba(86, 227, 159, .82)" : "rgba(148, 163, 184, .45)");
    ctx.strokeStyle = hovered ? "#56e39f" : "rgba(7, 16, 18, .78)";
    ctx.lineWidth = hovered ? 1.8 : 1;
    ctx.fill();
    ctx.stroke();
  }
}

function drawToolpath() {
  if (!elements.toolpathToggle.checked) {
    state.graphicsHits = [];
    state.hoverBlockIndex = null;
    return;
  }
  const count = Math.min(state.visibleBlocks, state.parsed.segments.length);
  state.graphicsHits = state.parsed.segments.map((segment, blockIndex) => ({blockIndex, points: segmentScreenPoints(segment)}));
  for (const segment of state.parsed.segments) {
    strokeSegment(segment, true);
  }
  for (let index = 0; index < count; index += 1) {
    const segment = state.parsed.segments[index];
    strokeSegment(segment);
  }
  drawProgramPointMarkers2d(count);
  if (!count) return;
  const finalPoint = state.parsed.segments[count - 1].end;
  const marker = worldToScreen(finalPoint);
  ctx.fillStyle = "#e5eefc";
  ctx.shadowColor = "#56e39f";
  ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.arc(marker.x, marker.y, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  const collisions = findCollisions(state.parsed.segments.slice(0, count), collisionOptions());
  for (const collision of collisions) {
    const point = worldToScreen({z: collision.point.z, x: collision.point.x});
    ctx.strokeStyle = "#fb7185";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(point.x - 5, point.y - 5); ctx.lineTo(point.x + 5, point.y + 5);
    ctx.moveTo(point.x + 5, point.y - 5); ctx.lineTo(point.x - 5, point.y + 5);
    ctx.stroke();
  }
}

function drawGeometryInspection() {
  state.componentGeometry = currentComponentGeometry();
  const refreshHit = (hit) => {
    if (!hit) return null;
    const entity = state.componentGeometry.find((candidate) => candidate.id === hit.entity?.id);
    if (!entity) return null;
    const fraction = Math.max(0, Math.min(1, Number(hit.fraction) || 0));
    return {
      ...hit,
      entity,
      modelPoint: geometryPointAt(entity, fraction),
    };
  };
  state.geometryHover = refreshHit(state.geometryHover);
  state.geometrySelection = refreshHit(state.geometrySelection);
  if (state.viewMode !== "2d") return;
  const hit = state.geometryHover || state.geometrySelection;
  if (!hit?.entity) return;
  const points = sampleGeometryEntity(hit.entity).map(geometryToScreen);
  ctx.save();
  ctx.strokeStyle = "#7dd3fc";
  ctx.lineWidth = state.geometrySelection?.entity?.id === hit.entity.id ? 3 : 2;
  ctx.shadowColor = "#38bdf8";
  ctx.shadowBlur = 9;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.stroke();
  const snap = geometryToScreen(hit.modelPoint);
  ctx.fillStyle = "#f8fafc";
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(snap.x, snap.y, hit.kind === "line" ? 4 : 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function dimensionEntityKey(entity) {
  return entity.id;
}

function updateDimensionControls() {
  const available = state.viewMode === "2d";
  elements.dimensionButton.disabled = !available;
  elements.dimensionButton.classList.toggle("active", available && state.dimensionMode);
  elements.dimensionButton.setAttribute("aria-pressed", String(available && state.dimensionMode));
  elements.clearDimensionsButton.disabled = !available || state.dimensions.length === 0;
}

function clearPinnedDimensions({disableMode = false} = {}) {
  state.dimensions = [];
  if (disableMode) state.dimensionMode = false;
  updateDimensionControls();
}

function pinDimension(entity) {
  if (entity.metadata?.sampledContour) {
    elements.status.textContent = "Sampled stock-grid chords cannot be pinned as exact dimensions; select an exact programmed line or radius.";
    return;
  }
  const key = dimensionEntityKey(entity);
  if (state.dimensions.some((dimension) => dimension.key === key)) return;
  state.dimensions.push({key, entity: JSON.parse(JSON.stringify(entity))});
  updateDimensionControls();
}

function strokeScreenPolyline(points) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

function drawDimensionArrow(tip, direction, size = 6) {
  const length = Math.hypot(direction.x, direction.y) || 1;
  const x = direction.x / length;
  const y = direction.y / length;
  const normal = {x: -y, y: x};
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x + x * size + normal.x * size * 0.45, tip.y + y * size + normal.y * size * 0.45);
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x + x * size - normal.x * size * 0.45, tip.y + y * size - normal.y * size * 0.45);
  ctx.stroke();
}

function drawDimensionLabel(text, point) {
  ctx.save();
  ctx.font = '600 11px "Cascadia Code", Consolas, monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const width = ctx.measureText(text).width + 12;
  const height = 20;
  ctx.fillStyle = "rgba(6, 20, 29, 0.94)";
  ctx.strokeStyle = "rgba(250, 204, 21, 0.72)";
  ctx.lineWidth = 1;
  ctx.fillRect(point.x - width / 2, point.y - height / 2, width, height);
  ctx.strokeRect(point.x - width / 2, point.y - height / 2, width, height);
  ctx.fillStyle = "#fde68a";
  ctx.fillText(text, point.x, point.y + 0.5);
  ctx.restore();
}

function drawLineDimension(entity) {
  const measurement = geometryMeasurement(entity);
  const start = geometryToScreen(entity.start);
  const end = geometryToScreen(entity.end);
  const delta = {x: end.x - start.x, y: end.y - start.y};
  const length = Math.hypot(delta.x, delta.y) || 1;
  let normal = {x: -delta.y / length, y: delta.x / length};
  const modelMidpoint = measurement.midpoint;
  const outward = Math.abs(modelMidpoint.x) > 1e-9
    ? {x: 0, y: -Math.sign(modelMidpoint.x)}
    : {x: 1, y: 0};
  if (normal.x * outward.x + normal.y * outward.y < 0) {
    normal = {x: -normal.x, y: -normal.y};
  }
  const offset = 28;
  const extension = 5;
  const first = {x: start.x + normal.x * offset, y: start.y + normal.y * offset};
  const second = {x: end.x + normal.x * offset, y: end.y + normal.y * offset};
  ctx.strokeStyle = "#facc15";
  ctx.lineWidth = 1.25;
  strokeScreenPolyline([start, {x: first.x + normal.x * extension, y: first.y + normal.y * extension}]);
  strokeScreenPolyline([end, {x: second.x + normal.x * extension, y: second.y + normal.y * extension}]);
  strokeScreenPolyline([first, second]);
  drawDimensionArrow(first, delta);
  drawDimensionArrow(second, {x: -delta.x, y: -delta.y});
  drawDimensionLabel(
    formatDistance(measurement.length, elements.displayUnits.value === "inch" ? 4 : 3),
    {x: (first.x + second.x) / 2 + normal.x * 13, y: (first.y + second.y) / 2 + normal.y * 13},
  );
}

function drawRadiusDimension(entity) {
  const measurement = geometryMeasurement(entity);
  const center = geometryToScreen(measurement.center);
  const curve = geometryToScreen(measurement.midpoint);
  const delta = {x: curve.x - center.x, y: curve.y - center.y};
  const length = Math.hypot(delta.x, delta.y) || 1;
  const direction = {x: delta.x / length, y: delta.y / length};
  const leaderEnd = {x: curve.x + direction.x * 34, y: curve.y + direction.y * 34};
  ctx.strokeStyle = "#facc15";
  ctx.lineWidth = 1.25;
  strokeScreenPolyline([center, curve, leaderEnd]);
  drawDimensionArrow(curve, {x: -delta.x, y: -delta.y});
  ctx.beginPath();
  ctx.moveTo(center.x - 4, center.y); ctx.lineTo(center.x + 4, center.y);
  ctx.moveTo(center.x, center.y - 4); ctx.lineTo(center.x, center.y + 4);
  ctx.stroke();
  drawDimensionLabel(
    `R ${formatDistance(measurement.radius, elements.displayUnits.value === "inch" ? 4 : 3)}`,
    {x: leaderEnd.x + direction.x * 24, y: leaderEnd.y + direction.y * 24},
  );
}

function drawPinnedDimensions() {
  if (state.viewMode !== "2d" || !state.dimensions.length) return;
  ctx.save();
  ctx.setLineDash([]);
  for (const dimension of state.dimensions) {
    if (dimension.entity.type === "arc") drawRadiusDimension(dimension.entity);
    else drawLineDimension(dimension.entity);
  }
  ctx.restore();
}

function formatGeometryPoint(point) {
  const places = elements.displayUnits.value === "inch" ? 4 : 3;
  return `Z ${displayValue(point.z).toFixed(places)}  X ${displayValue(point.x).toFixed(places)} ${unitName()}`;
}

function renderGeometryInspector() {
  const active = state.viewMode === "2d" && Boolean(state.geometrySelection);
  elements.geometryInspector.hidden = !active;
  if (!active) return;
  const hit = state.geometrySelection;
  const measurement = geometryMeasurement(hit.entity);
  const sampledContour = hit.entity.metadata?.sampledContour === true;
  const snapNames = {corner: "Corner / intersection", midpoint: "Midpoint", line: "On line", arc: "On radius"};
  $("geometryComponent").textContent = hit.entity.component;
  const samplingNote = sampledContour
    ? ` · GRID APPROXIMATION ≤ ${formatDistance(hit.entity.metadata.maximumAxialStep, elements.displayUnits.value === "inch" ? 4 : 3)} AXIAL STEP`
    : "";
  $("geometryEntity").textContent = `${hit.entity.label} · ${snapNames[hit.kind] || "Geometry"}${samplingNote}`;
  $("geometrySelectedPoint").textContent = formatGeometryPoint(hit.modelPoint);
  if (hit.entity.type === "arc") {
    $("geometryPrimaryLabel").textContent = "Radius";
    $("geometryLength").textContent = formatDistance(measurement.radius, elements.displayUnits.value === "inch" ? 4 : 3);
    $("geometrySecondaryLabel").textContent = "Arc length";
    $("geometrySecondaryValue").textContent = formatDistance(measurement.arcLength, elements.displayUnits.value === "inch" ? 4 : 3);
    $("geometryCenter").textContent = formatGeometryPoint(measurement.center);
  } else {
    $("geometryPrimaryLabel").textContent = sampledContour ? "Approx. chord" : "Length";
    $("geometryLength").textContent = formatDistance(measurement.length, elements.displayUnits.value === "inch" ? 4 : 3);
    $("geometrySecondaryLabel").textContent = "ΔZ / ΔX";
    $("geometrySecondaryValue").textContent = `${formatDistance(Math.abs(measurement.deltaZ), elements.displayUnits.value === "inch" ? 4 : 3)} / ${formatDistance(Math.abs(measurement.deltaX), elements.displayUnits.value === "inch" ? 4 : 3)}`;
    $("geometryCenter").textContent = "—";
  }
  $("geometryStart").textContent = formatGeometryPoint(measurement.start);
  $("geometryMidpoint").textContent = formatGeometryPoint(measurement.midpoint);
  $("geometryEnd").textContent = formatGeometryPoint(measurement.end);
}

function drawViewCube() {
  const cubeRect = elements.viewCubeCanvas.getBoundingClientRect();
  const cubeDpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  elements.viewCubeCanvas.width = Math.max(1, Math.round(cubeRect.width * cubeDpr));
  elements.viewCubeCanvas.height = Math.max(1, Math.round(cubeRect.height * cubeDpr));
  const cubeContext = elements.viewCubeCanvas.getContext("2d");
  cubeContext.setTransform(cubeDpr, 0, 0, cubeDpr, 0, 0);
  state.viewCubeRegions = renderViewCube(cubeContext, {
    width: cubeRect.width,
    height: cubeRect.height,
    camera: state.camera3d,
    hoverTarget: state.viewCubeHover,
  });
}

function draw3d(rect) {
  let stock = null;
  const quality = graphicsQuality();
  const interactive = state.playing || Date.now() < state.preview3dUntil || state.drag?.mode?.startsWith("3d-");
  const renderQuality = renderGraphicsQualityPreset(quality.id, {interactive});
  if (elements.stockToggle.checked) {
    const stockDiameter = Math.max(0, setupValue(elements.stockDiameter));
    const stockLength = Math.max(0, setupValue(elements.stockLength));
    if (stockDiameter && stockLength) {
      stock = stockProfileFor(stockDiameter, stockLength);
      $("stockRemoved").textContent = stock ? `${stock.removedPercent.toFixed(1)}%` : "BLOCKED";
    }
  } else {
    $("stockRemoved").textContent = "OFF";
  }
  renderLathe3d(ctx, {
    width: rect.width,
    height: rect.height,
    segments: state.parsed.segments,
    visibleCount: state.visibleBlocks,
    stock,
    xScale: xScale(),
    orientationSign: orientationSign(),
    camera: state.camera3d,
    quality: renderQuality,
    showToolpaths: elements.toolpathToggle.checked,
  });
  state.graphicsHits = [];
  drawViewCube();
}

function draw() {
  const rect = elements.wrap.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (state.viewMode === "3d") {
    draw3d(rect);
  } else {
    drawGrid(rect.width, rect.height);
    drawKeepout();
    drawStock();
    drawToolpath();
    drawToolAssembly2d();
    drawGeometryInspection();
    drawPinnedDimensions();
  }
  renderGeometryInspector();
  updateDimensionControls();
  elements.empty.hidden = state.parsed.segments.length > 0;
}

function updateStats() {
  const segments = state.parsed.segments;
  const rapid = segments.filter((segment) => segment.type === "rapid").reduce((sum, segment) => sum + segmentLength(segment, xScale()), 0);
  const cut = segments.filter((segment) => segment.type !== "rapid").reduce((sum, segment) => sum + segmentLength(segment, xScale()), 0);
  const bounds = programBounds(segments, xScale());
  const collisions = findCollisions(segments, collisionOptions());
  $("motionCount").textContent = String(segments.length);
  $("cycleCount").textContent = String(state.parsed.cycles.length);
  $("rapidDistance").textContent = formatDistance(rapid);
  $("cutDistance").textContent = formatDistance(cut);
  const machineOptions = machinePlotOptions(currentMachineProfile());
  const cycleTime = estimateCycleTime(state.parsed, {
    xScale: xScale(),
    rapidXMax: machineOptions.rapidXMax,
    rapidZMax: machineOptions.rapidZMax,
  });
  state.cycleTime = cycleTime;
  const timeText = cycleTime.hasEstimate
    ? qualifiedTime(cycleTime.seconds, cycleTime.quality)
    : "—";
  const timeTitleParts = [
    cycleTime.hasEstimate
      ? `Estimated motion and dwell time: ${formatCycleTime(cycleTime.seconds)} (cut ${formatCycleTime(cycleTime.cuttingSeconds)}, rapid ${formatCycleTime(cycleTime.rapidSeconds)}, dwell ${formatCycleTime(cycleTime.dwellSeconds)}).`
      : "Cycle time cannot be estimated from the available program and machine data.",
    ...cycleTime.limitations,
    "Excludes operator stops, tool-change duration, and spindle acceleration.",
  ];
  for (const element of [$("cycleTimeHeader"), $("cycleTimeStat")]) {
    element.textContent = timeText;
    element.title = timeTitleParts.join(" ");
    element.classList.toggle("partial-time", cycleTime.quality === "partial");
    element.classList.toggle("assumed-time", cycleTime.quality === "assumed");
  }
  $("boundsReadout").textContent = bounds ? `${displayValue(bounds.maxZ - bounds.minZ).toFixed(elements.displayUnits.value === "inch" ? 3 : 1)} × ${displayValue(bounds.maxX - bounds.minX).toFixed(elements.displayUnits.value === "inch" ? 3 : 1)} ${unitName()}` : "—";
  const collisionStatus = $("collisionStatus");
  collisionStatus.textContent = collisions.length ? `${collisions.length} HIT${collisions.length === 1 ? "" : "S"}` : "CLEAR";
  collisionStatus.className = collisions.length ? "danger-value" : "safe-value";
  const notes = [...state.parsed.warnings, ...assignmentWarnings()];
  const rapidAssumption = cycleTime.limitations.find((limitation) => limitation.includes("rapid timing assumes"));
  if (rapidAssumption) notes.unshift({line: null, info: true, message: rapidAssumption});
  if (collisions.length) {
    const lines = [...new Set(collisions.map((collision) => collision.segment.line).filter(Boolean))];
    notes.unshift({line: lines[0] || null, danger: true, message: `${collisions.length} toolpath move${collisions.length === 1 ? "" : "s"} enter the configured chuck keep-out envelope.`});
  }
  for (const cycle of state.parsed.cycles) {
    if (cycle.code === "G70") continue;
    notes.push({line: cycle.line, info: true, message: `${cycle.code} Type ${cycle.type} expanded to ${cycle.passes} roughing passes (P${cycle.p}–Q${cycle.q}).`});
  }
  $("warningCount").textContent = String(notes.length);
  const list = $("warningList");
  list.replaceChildren();
  if (!notes.length) {
    const item = document.createElement("li"); item.className = "muted"; item.textContent = "No parser warnings."; list.append(item);
  } else {
    notes.slice(0, 12).forEach((warning) => {
      const item = document.createElement("li");
      if (warning.danger) item.className = "danger";
      else if (warning.info) item.className = "muted";
      item.textContent = `${warning.line ? `Line ${warning.line}: ` : ""}${warning.message}`; list.append(item);
    });
  }
}

function qualifiedTime(seconds, quality, {tenths = false} = {}) {
  const prefix = quality === "partial" ? "≥ " : (quality === "assumed" ? "≈ " : "");
  return `${prefix}${formatCycleTime(seconds, {tenths})}`;
}

function updateReaderTime() {
  const estimate = state.cycleTime;
  const values = [
    [elements.readerElapsedTime, "elapsedSeconds", "elapsedQuality"],
    [elements.readerRemainingTime, "remainingSeconds", "remainingQuality"],
    [elements.readerTotalTime, "totalSeconds", "totalQuality"],
  ];
  if (!estimate?.hasEstimate) {
    for (const [element] of values) {
      element.textContent = "—";
      element.classList.remove("partial-time", "assumed-time");
    }
    return;
  }
  const position = cycleTimeAtPosition(estimate, {
    visibleBlocks: state.visibleBlocks,
    sourceLine: state.programLine,
  });
  for (const [element, secondsKey, qualityKey] of values) {
    const quality = position[qualityKey];
    element.textContent = qualifiedTime(position[secondsKey], quality, {tenths: true});
    element.classList.toggle("partial-time", quality === "partial");
    element.classList.toggle("assumed-time", quality === "assumed");
  }
}

function updateTransport({scrollProgram = false} = {}) {
  const totalBlocks = state.parsed.segments.length;
  const totalLines = state.parsed.sourceLines || programLineCount();
  const range = executionRangeForSourceLine(state.parsed.segments, state.programLine);
  const substep = range.count ? Math.max(1, Math.min(range.count, state.visibleBlocks - range.start)) : 0;
  const cycle = range.count > 1 ? state.parsed.segments[range.start]?.cycle : null;
  elements.timeline.max = String(Math.max(1, totalLines));
  elements.timeline.value = String(state.programLine);
  elements.blockReadout.textContent = range.count > 1
    ? `Line ${state.programLine} / ${totalLines} · ${cycle ? `${cycle} cycle` : "Move"} ${substep} / ${range.count}`
    : `Line ${state.programLine} / ${totalLines} · Block ${state.visibleBlocks} / ${totalBlocks}`;
  elements.play.dataset.transportState = state.playing ? "pause" : "play";
  elements.play.setAttribute("aria-label", state.playing ? "Pause" : "Play");
  elements.stepBack.disabled = state.programLine <= 0;
  elements.stepForward.disabled = state.programLine >= totalLines && state.visibleBlocks >= range.end;
  updateReaderTime();
  if (state.visibleBlocks > 0) {
    const point = state.parsed.segments[Math.min(state.visibleBlocks, totalBlocks) - 1].end;
    const places = elements.displayUnits.value === "inch" ? 4 : 3;
    $("zReadout").textContent = displayValue(point.z).toFixed(places);
    $("xReadout").textContent = displayValue(point.x).toFixed(places);
  } else {
    const zero = elements.displayUnits.value === "inch" ? "0.0000" : "0.000";
    $("zReadout").textContent = zero; $("xReadout").textContent = zero;
  }
  updateProgramLineHighlight({scroll: scrollProgram});
}

function setProgramLine(line, {scrollProgram = true, visibleBlocks = null} = {}) {
  const totalLines = state.parsed.sourceLines || programLineCount();
  state.programLine = Math.max(0, Math.min(totalLines, Number(line) || 0));
  state.visibleBlocks = visibleBlocks === null
    ? entryVisibleBlocksForSourceLine(state.parsed.segments, state.programLine)
    : Math.max(0, Math.min(state.parsed.segments.length, visibleBlocks));
  begin3dInteractivePreview();
  updateTransport({scrollProgram});
  draw();
}

function cancel3dPrecisionRedraw() {
  if (state.precisionRedrawTimer !== null) clearTimeout(state.precisionRedrawTimer);
  state.precisionRedrawTimer = null;
}

function request3dNavigationDraw() {
  if (state.viewMode !== "3d") return;
  begin3dInteractivePreview();
  navigation3dRenderer.request();
}

function begin3dInteractivePreview() {
  if (state.viewMode !== "3d") return;
  state.preview3dUntil = Date.now() + THREE_D_SETTLE_MS;
  cancel3dPrecisionRedraw();
  state.precisionRedrawTimer = setTimeout(() => {
    state.precisionRedrawTimer = null;
    if (state.viewMode !== "3d" || state.playing || state.drag?.mode?.startsWith("3d-")) return;
    state.preview3dUntil = 0;
    navigation3dRenderer.cancel();
    draw();
  }, THREE_D_SETTLE_MS + 20);
}

function stepProgram(direction) {
  const totalLines = state.parsed.sourceLines || programLineCount();
  if (!totalLines) return;
  state.playing = false;
  state.lastFrame = 0;
  const next = advanceExecutionPosition(state.parsed.segments, totalLines, state, direction);
  setProgramLine(next.line, {visibleBlocks: next.visibleBlocks});
}

function plotProgram({fit = true, clearDimensions = true} = {}) {
  const machine = currentMachineProfile();
  const previousAssignments = state.toolAssignments;
  const previousAssignmentScope = state.toolAssignmentScope;
  const nextAssignmentScope = programAssignmentScope(elements.input.value, {fileName: elements.fileName.textContent});
  state.parsed = parseGcode(elements.input.value, {
    xMode: elements.xMode.value,
    arcChordTolerance: graphicsQuality().arcChordTolerance,
    ...machinePlotOptions(machine),
  });
  if (machine?.status === "draft") {
    state.parsed.warnings.unshift({line: null, info: true, message: `${machine.name} draft estimates are active; verify the machine definition before relying on approach or rapid geometry.`});
  }
  state.toolAssignments = reconcileToolAssignments(state.parsed.executableToolCalls || [], previousAssignments, {
    previousScope: previousAssignmentScope,
    nextScope: nextAssignmentScope,
  });
  state.toolAssignments = Object.fromEntries(Object.entries(state.toolAssignments).map(([toolKey, assignment]) => {
    const assignmentRef = toolAssignmentAssemblyRef(assignment);
    const currentCatalogAssembly = assignmentRef ? toolLibraryAssemblyById(assignmentRef.id) : null;
    const resolvedAssembly = currentCatalogAssembly
      ? resolveAssignableToolAssembly2d({id: currentCatalogAssembly.id, revision: currentCatalogAssembly.revision})
      : null;
    return [toolKey, normalizeVersionedToolAssignment(assignment, resolvedAssembly)];
  }));
  state.toolAssignmentScope = nextAssignmentScope;
  if (isExactBundledProgram(elements.input.value, sampleProgram, state.bundledSample)
    && (state.parsed.executableToolCalls || []).some((call) => call.key === "T0101")) {
    state.toolAssignments.T0101 ||= {
      ...createVersionedToolAssignment(DEFAULT_TOOL_ASSEMBLY_2D, {tipDatum: null, axialDirection: "negative-z"}),
      confirmed: true,
      confirmationSource: "bundled-sample",
    };
  }
  state.toolAssignmentRevision += 1;
  state.stockProfileCache = null;
  state.programLine = 0;
  state.visibleBlocks = 0;
  state.playing = false;
  state.programDirty = false;
  state.hoverBlockIndex = null;
  state.geometryHover = null;
  state.geometrySelection = null;
  if (clearDimensions) clearPinnedDimensions({disableMode: true});
  renderProgramLineNumbers();
  renderProgramToolAssignments();
  const cycleStatus = state.parsed.cycles.filter((cycle) => cycle.code !== "G70").map((cycle) => `${cycle.code} ${cycle.passes} passes`).join(" • ");
  elements.status.textContent = state.parsed.segments.length ? `${state.parsed.segments.length} motion blocks${cycleStatus ? ` • ${cycleStatus}` : ""}` : "No motion found";
  updateStats(); updateTransport();
  if (fit) fitView(); else draw();
}

function zoomAt(factor, x = elements.wrap.clientWidth / 2, y = elements.wrap.clientHeight / 2) {
  if (state.viewMode === "3d") {
    state.camera3d = zoomCameraAt(state.camera3d, factor, {x, y}, {
      width: elements.wrap.clientWidth,
      height: elements.wrap.clientHeight,
    });
    request3dNavigationDraw();
    return;
  }
  const before = screenToProgram(x, y);
  state.camera.scale = Math.max(0.25, Math.min(500, state.camera.scale * factor));
  const after = worldToScreen(before);
  state.camera.offsetX += x - after.x;
  state.camera.offsetY += y - after.y;
  draw();
}

function animate(timestamp) {
  if (!state.playing) return;
  const interval = 260 / Number(elements.speed.value);
  if (!state.lastFrame || timestamp - state.lastFrame >= interval) {
    state.lastFrame = timestamp;
    const totalLines = state.parsed.sourceLines || programLineCount();
    const next = advanceExecutionPosition(state.parsed.segments, totalLines, state, 1);
    state.programLine = next.line;
    state.visibleBlocks = next.visibleBlocks;
    begin3dInteractivePreview();
    const activeRange = executionRangeForSourceLine(state.parsed.segments, state.programLine);
    if (state.programLine >= totalLines && state.visibleBlocks >= activeRange.end) {
      state.playing = false;
    }
    updateTransport({scrollProgram: true}); draw();
  }
  if (state.playing) requestAnimationFrame(animate);
}

const dimensionalInputs = [
  elements.stockDiameter, elements.stockLength, elements.stockGripLength, elements.chuckFaceZ, elements.jawDiameter, elements.clearance,
];
let activeUnitScale = 25.4;

function refreshStockPlacementUi() {
  const overall = Math.max(0, Number(elements.stockLength.value) || 0);
  const held = Math.min(overall, Math.max(0, Number(elements.stockGripLength.value) || 0));
  const stickout = Math.max(0, overall - held);
  const places = elements.displayUnits.value === "inch" ? 4 : 3;
  elements.stockGripLength.max = String(overall);
  elements.stockStickout.value = String(Number(stickout.toFixed(places)));
}

function refreshUnitUi() {
  const label = unitName();
  elements.unitReadout.textContent = label;
  document.querySelectorAll("[data-unit-label]").forEach((element) => { element.textContent = label; });
  const standardStep = elements.displayUnits.value === "inch" ? "0.01" : "0.1";
  for (const input of [elements.stockDiameter, elements.stockLength, elements.stockGripLength, elements.chuckFaceZ, elements.jawDiameter]) input.step = standardStep;
  elements.clearance.step = elements.displayUnits.value === "inch" ? "0.005" : "0.1";
  elements.stockStickout.step = standardStep;
  refreshStockPlacementUi();
  updateGraphicsQualityHint();
}

elements.displayUnits.addEventListener("change", () => {
  const previousUnits = activeUnitScale === 25.4 ? "inch" : "mm";
  const nextUnits = elements.displayUnits.value;
  const nextScale = unitScale();
  const places = elements.displayUnits.value === "inch" ? 4 : 3;
  for (const input of dimensionalInputs) {
    const converted = convertUnitValue(Number(input.value) || 0, previousUnits, nextUnits);
    input.value = String(Number(converted.toFixed(places)));
  }
  activeUnitScale = nextScale;
  refreshUnitUi();
  renderProgramToolAssignments();
  renderGeometryInspector();
  updateStats(); updateTransport(); fitView();
  persistSession();
});

elements.programUnits.addEventListener("change", () => {
  updateProgramUnitsHint();
  plotProgram();
  persistSession();
});

elements.graphicsQuality.addEventListener("change", () => {
  const programLine = state.programLine;
  const visibleBlocks = state.visibleBlocks;
  updateGraphicsQualityHint();
  plotProgram({fit: false, clearDimensions: false});
  state.programLine = Math.min(programLine, state.parsed.sourceLines || programLineCount());
  state.visibleBlocks = Math.min(visibleBlocks, state.parsed.segments.length);
  updateStats();
  updateTransport();
  draw();
  persistSession();
});

elements.editMachine.addEventListener("click", openMachineEditor);
elements.toolLibraryButton.addEventListener("click", () => openToolLibrary());
elements.toolLibraryClose.addEventListener("click", () => elements.toolLibraryDialog.close());
elements.toolLibraryDialog.addEventListener("click", (event) => {
  if (event.target === elements.toolLibraryDialog) elements.toolLibraryDialog.close();
});
for (const tab of document.querySelectorAll(".tool-library-tab")) {
  tab.addEventListener("click", () => setToolLibraryTab(tab.dataset.libraryTab));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll(".tool-library-tab")];
    const next = event.key === "Home"
      ? tabs[0]
      : event.key === "End"
        ? tabs[tabs.length - 1]
        : tabs[(tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    setToolLibraryTab(next.dataset.libraryTab);
    next.focus();
  });
}
elements.toolLibrarySearch.addEventListener("input", renderToolLibrary);
elements.toolLibraryFamilyFilter.addEventListener("change", renderToolLibrary);
elements.toolLibraryShapeFilter.addEventListener("change", renderToolLibrary);
elements.toolLibraryAuthorityFilter.addEventListener("change", renderToolLibrary);
elements.toolLibraryTarget.addEventListener("change", renderToolLibrary);
elements.toolLibraryAssign.addEventListener("click", () => {
  const toolKey = elements.toolLibraryTarget.value;
  const assembly = state.toolLibraryTab === "assemblies" ? toolLibraryAssemblyById(state.toolLibrarySelection) : null;
  const definition = assembly ? resolveAssignableToolAssembly2d({id: assembly.id, revision: assembly.revision}) : null;
  if (!toolKey || !assembly?.assignment.assignable || !definition) return;
  state.toolAssignments[toolKey] = createVersionedToolAssignment(definition, {
    tipDatum: definition.cuttingModel?.tipDatum || null,
    axialDirection: definition.cuttingModel?.axialDirection || null,
  });
  invalidateToolAssignments();
  elements.programToolsSetup.open = true;
  elements.toolLibraryDialog.close();
  requestAnimationFrame(() => {
    const card = [...elements.programToolList.querySelectorAll(".program-tool-card")]
      .find((candidate) => candidate.dataset.toolKey === toolKey);
    card?.querySelector(".program-tool-browse")?.focus();
  });
});
elements.machineForm.addEventListener("submit", saveMachineEditor);
elements.machineForm.elements.namedItem("status").addEventListener("change", (event) => updateMachineStatusBadge(event.target.value));
$("closeMachineButton").addEventListener("click", () => elements.machineDialog.close());
$("cancelMachineButton").addEventListener("click", () => elements.machineDialog.close());
elements.machineDialog.addEventListener("click", (event) => {
  if (event.target === elements.machineDialog) elements.machineDialog.close();
});
elements.machine.addEventListener("change", () => {
  const machine = currentMachineProfile();
  if (machine?.orientation) elements.orientation.value = machine.orientation;
  if (machine?.xProgramming) elements.xMode.value = machine.xProgramming;
  updateProgramUnitsHint(machine);
  refreshUnitUi();
  plotProgram();
  persistSession();
});

$("plotButton").addEventListener("click", () => { plotProgram(); persistSession(); });
$("loadSampleButton").addEventListener("click", () => loadProgram("sample-g71-rough.nc", sampleProgram, {bundledSample: true}));
$("openButton").addEventListener("click", openProgram);
$("compareButton").addEventListener("click", openComparison);
elements.save.addEventListener("click", saveProgram);
elements.fileInput.addEventListener("change", async () => {
  await loadBrowserFile(elements.fileInput.files[0]);
  elements.fileInput.value = "";
});
elements.originalFileInput.addEventListener("change", async () => {
  const file = elements.originalFileInput.files[0];
  if (file) setComparisonOriginal(file.name, await file.text());
  elements.originalFileInput.value = "";
});
$("chooseOriginalButton").addEventListener("click", chooseComparisonOriginal);
$("chooseOriginalEmptyButton").addEventListener("click", chooseComparisonOriginal);
$("snapshotOriginalButton").addEventListener("click", () => setComparisonOriginal(`${elements.fileName.textContent || "program.nc"} · snapshot`, elements.input.value));
$("closeCompareButton").addEventListener("click", () => elements.compareDialog.close());
elements.compareDialog.addEventListener("click", (event) => {
  if (event.target === elements.compareDialog) elements.compareDialog.close();
});
elements.ignoreFormatting.addEventListener("change", renderComparison);
elements.differencesOnly.addEventListener("change", renderComparisonRows);
elements.compareCodeView.addEventListener("click", () => setComparisonView("code"));
elements.compareGraphicsView.addEventListener("click", () => setComparisonView("graphics"));
elements.compareSplitLayout.addEventListener("click", () => setComparisonGraphicsLayout("split"));
elements.compareOverlayLayout.addEventListener("click", () => setComparisonGraphicsLayout("overlay"));
elements.fitGeometryDifferences.addEventListener("change", () => {
  if (elements.fitGeometryDifferences.checked) elements.fitGeometryPart.checked = false;
  renderComparisonGraphics();
});
elements.fitGeometryPart.addEventListener("change", () => {
  if (elements.fitGeometryPart.checked) elements.fitGeometryDifferences.checked = false;
  renderComparisonGraphics();
});
elements.graphicsInfoButton.addEventListener("click", () => setGraphicsInfo(elements.graphicsInfoPanel.hidden));
$("closeGraphicsInfoButton").addEventListener("click", () => setGraphicsInfo(false));
elements.previousCompareChange.addEventListener("click", () => scrollToComparisonChange(state.compareChangeIndex < 0 ? -1 : state.compareChangeIndex - 1));
elements.nextCompareChange.addEventListener("click", () => scrollToComparisonChange(state.compareChangeIndex + 1));
$("fitButton").addEventListener("click", fitView);
$("zoomInButton").addEventListener("click", () => zoomAt(1.25));
$("zoomOutButton").addEventListener("click", () => zoomAt(0.8));
function setGraphicsDimension(mode) {
  state.viewMode = mode;
  const threeDimensional = mode === "3d";
  if (!threeDimensional) {
    cancel3dPrecisionRedraw();
    navigation3dRenderer.cancel();
    state.preview3dUntil = 0;
  }
  state.hoverBlockIndex = null;
  state.geometryHover = null;
  state.graphicsHits = [];
  elements.view2d.classList.toggle("active", !threeDimensional);
  elements.view3d.classList.toggle("active", threeDimensional);
  elements.view2d.setAttribute("aria-pressed", String(!threeDimensional));
  elements.view3d.setAttribute("aria-pressed", String(threeDimensional));
  elements.canvas.style.cursor = threeDimensional ? "grab" : "crosshair";
  elements.viewCube.hidden = !threeDimensional;
  if (threeDimensional) {
    state.geometrySelection = null;
    state.dimensionMode = false;
  }
  elements.wrap.classList.toggle("three-d", threeDimensional);
  state.drag = null;
  updateDimensionControls();
  updateToolControls();
  fitView();
}
elements.view2d.addEventListener("click", () => setGraphicsDimension("2d"));
elements.view3d.addEventListener("click", () => setGraphicsDimension("3d"));
elements.toolOverlay.addEventListener("click", () => {
  if (state.viewMode !== "2d") return;
  state.showTool2d = !state.showTool2d;
  updateToolControls();
  draw();
});
elements.dimensionButton.addEventListener("click", () => {
  if (state.viewMode !== "2d") return;
  state.dimensionMode = !state.dimensionMode;
  elements.canvas.style.cursor = "crosshair";
  updateDimensionControls();
  draw();
});
elements.clearDimensionsButton.addEventListener("click", () => {
  clearPinnedDimensions();
  draw();
});
elements.toolpathToggle.addEventListener("change", () => {
  state.hoverBlockIndex = null;
  draw();
  persistSession();
});
elements.clearGeometrySelection.addEventListener("click", () => {
  state.geometrySelection = null;
  draw();
});
elements.viewCubeHome.addEventListener("click", () => {
  state.camera3d = standardCameraView("iso", state.camera3d);
  state.viewCubeHover = null;
  request3dNavigationDraw();
});
function viewCubeRegionAt(event) {
  const rect = elements.viewCubeCanvas.getBoundingClientRect();
  return viewCubeHitTarget(state.viewCubeRegions, event.clientX - rect.left, event.clientY - rect.top);
}
elements.viewCubeCanvas.addEventListener("pointermove", (event) => {
  const region = viewCubeRegionAt(event);
  const hoverTarget = region?.id || null;
  elements.viewCubeCanvas.style.cursor = region ? "pointer" : "default";
  elements.viewCubeCanvas.title = region ? `${region.label} view` : "Click a face, edge, or corner to orient the view";
  if (hoverTarget !== state.viewCubeHover) {
    state.viewCubeHover = hoverTarget;
    drawViewCube();
  }
});
elements.viewCubeCanvas.addEventListener("pointerleave", () => {
  state.viewCubeHover = null;
  elements.viewCubeCanvas.style.cursor = "default";
  drawViewCube();
});
elements.viewCubeCanvas.addEventListener("click", (event) => {
  const region = viewCubeRegionAt(event);
  if (!region) return;
  state.camera3d = cameraViewForDirection(region.direction, state.camera3d);
  state.viewCubeHover = null;
  request3dNavigationDraw();
});
elements.timeline.addEventListener("input", () => { state.playing = false; setProgramLine(Number(elements.timeline.value)); });
elements.stepBack.addEventListener("click", () => stepProgram(-1));
elements.stepForward.addEventListener("click", () => stepProgram(1));
elements.play.addEventListener("click", () => {
  const totalLines = state.parsed.sourceLines || programLineCount();
  if (!totalLines) return;
  state.playing = !state.playing;
  const range = executionRangeForSourceLine(state.parsed.segments, state.programLine);
  if (state.playing && state.programLine >= totalLines && state.visibleBlocks >= range.end) {
    state.programLine = 0;
    state.visibleBlocks = 0;
  }
  if (state.playing) {
    begin3dInteractivePreview();
  } else {
    cancel3dPrecisionRedraw();
    navigation3dRenderer.cancel();
    state.preview3dUntil = 0;
    if (state.viewMode === "3d") draw();
  }
  state.lastFrame = 0; updateTransport(); if (state.playing) requestAnimationFrame(animate);
});

for (const control of [
  elements.orientation, elements.xMode, elements.stockDiameter, elements.stockLength, elements.stockGripLength, elements.stockToggle,
  elements.chuckFaceZ, elements.jawDiameter, elements.clearance, elements.collisionToggle,
]) {
  control.addEventListener("change", () => {
    state.geometryHover = null;
    state.geometrySelection = null;
    refreshStockPlacementUi();
    clearPinnedDimensions({disableMode: true});
    if (control === elements.xMode) plotProgram(); else { updateStats(); fitView(); }
    persistSession();
  });
}

for (const control of [elements.stockLength, elements.stockGripLength]) {
  control.addEventListener("input", refreshStockPlacementUi);
}

elements.canvas.addEventListener("wheel", (event) => { event.preventDefault(); const rect = elements.canvas.getBoundingClientRect(); zoomAt(event.deltaY < 0 ? 1.12 : 0.89, event.clientX - rect.left, event.clientY - rect.top); }, {passive: false});
function graphicsHitForEvent(event) {
  if (!graphicsSelectionEnabled(state.viewMode)) return null;
  const rect = elements.canvas.getBoundingClientRect();
  return graphicsHitAt(state.graphicsHits, event.clientX - rect.left, event.clientY - rect.top, {currentBlock: state.visibleBlocks});
}
function geometryHitForEvent(event) {
  if (state.viewMode !== "2d") return null;
  const rect = elements.canvas.getBoundingClientRect();
  return geometryHitAt(
    state.componentGeometry,
    geometryToScreen,
    {x: event.clientX - rect.left, y: event.clientY - rect.top},
  );
}
function updateGraphicsHover(event) {
  if (state.viewMode === "2d") {
    const geometryHit = geometryHitForEvent(event);
    if (geometryHit) {
      state.hoverBlockIndex = null;
      state.geometryHover = geometryHit;
      draw();
      elements.canvas.style.cursor = "pointer";
      return geometryHit;
    }
    const hadGeometryHover = state.geometryHover !== null;
    state.geometryHover = null;
    const hit = graphicsHitForEvent(event);
    const nextHover = hit?.blockIndex ?? null;
    if (hadGeometryHover || nextHover !== state.hoverBlockIndex) {
      state.hoverBlockIndex = nextHover;
      draw();
    }
    elements.canvas.style.cursor = hit ? "pointer" : "crosshair";
    return hit;
  }
  const hit = graphicsHitForEvent(event);
  const nextHover = hit?.blockIndex ?? null;
  if (nextHover !== state.hoverBlockIndex) {
    state.hoverBlockIndex = nextHover;
    draw();
  }
  elements.canvas.style.cursor = state.viewMode === "3d" ? "grab" : "crosshair";
  return hit;
}
function selectGeometryAt(event) {
  if (state.viewMode !== "2d") return false;
  const hit = geometryHitForEvent(event);
  if (!hit) return false;
  state.playing = false;
  state.lastFrame = 0;
  state.geometrySelection = hit;
  state.geometryHover = hit;
  state.hoverBlockIndex = null;
  if (state.dimensionMode) pinDimension(hit.entity);
  draw();
  return true;
}
function selectGraphicsAt(event) {
  const hit = graphicsHitForEvent(event);
  if (!hit) return false;
  state.playing = false;
  state.lastFrame = 0;
  const visibleBlocks = Math.max(0, Math.min(state.parsed.segments.length, hit.blockIndex + 1));
  state.programLine = executionLineForPosition(state.parsed.segments, visibleBlocks) || state.programLine;
  state.visibleBlocks = visibleBlocks;
  state.hoverBlockIndex = hit.blockIndex;
  state.geometrySelection = null;
  updateTransport({scrollProgram: true});
  draw();
  return true;
}
elements.canvas.addEventListener("pointerdown", (event) => {
  if (state.viewMode === "3d") {
    const navigationMode = navigationDragMode(event.button, event.pointerType);
    if (!navigationMode) return;
    event.preventDefault();
    elements.canvas.setPointerCapture(event.pointerId);
    state.drag = navigationMode === "orbit"
      ? {mode: "3d-orbit", x: event.clientX, y: event.clientY, yaw: state.camera3d.yaw, pitch: state.camera3d.pitch, button: event.button, moved: false}
      : {mode: "3d-pan", x: event.clientX, y: event.clientY, panX: state.camera3d.panX, panY: state.camera3d.panY, button: event.button, moved: false};
    elements.canvas.style.cursor = navigationMode === "orbit" ? "grabbing" : "move";
    return;
  }
  if (event.button !== 0) return;
  elements.canvas.setPointerCapture(event.pointerId);
  state.drag = {mode: "2d", x: event.clientX, y: event.clientY, offsetX: state.camera.offsetX, offsetY: state.camera.offsetY, button: event.button, moved: false};
  elements.canvas.style.cursor = "grabbing";
});
elements.canvas.addEventListener("pointermove", (event) => {
  if (state.drag && Math.hypot(event.clientX - state.drag.x, event.clientY - state.drag.y) > 3) state.drag.moved = true;
  if (state.viewMode === "3d") {
    if (state.drag?.mode === "3d-orbit" && state.drag.moved) {
      const camera = orbitCameraFromDrag(
        {...state.camera3d, yaw: state.drag.yaw, pitch: state.drag.pitch},
        event.clientX - state.drag.x,
        event.clientY - state.drag.y,
      );
      state.camera3d.yaw = camera.yaw;
      state.camera3d.pitch = camera.pitch;
      request3dNavigationDraw();
    } else if (state.drag?.mode === "3d-pan" && state.drag.moved) {
      state.camera3d.panX = state.drag.panX + event.clientX - state.drag.x;
      state.camera3d.panY = state.drag.panY + event.clientY - state.drag.y;
      request3dNavigationDraw();
    } else if (!state.drag) {
      updateGraphicsHover(event);
    }
    return;
  }
  const rect = elements.canvas.getBoundingClientRect();
  const point = screenToProgram(event.clientX - rect.left, event.clientY - rect.top);
  const places = elements.displayUnits.value === "inch" ? 4 : 3;
  $("zReadout").textContent = displayValue(point.z).toFixed(places); $("xReadout").textContent = displayValue(point.x).toFixed(places);
  if (state.drag?.mode === "2d" && state.drag.moved) {
    state.camera.offsetX = state.drag.offsetX + event.clientX - state.drag.x;
    state.camera.offsetY = state.drag.offsetY + event.clientY - state.drag.y;
    draw();
  } else if (!state.drag) {
    updateGraphicsHover(event);
  }
});
function finishCanvasDrag(event, cancelled = false) {
  const drag = state.drag;
  const restorePrecision = state.viewMode === "3d" && drag?.mode?.startsWith("3d-");
  const shouldSelect = !cancelled && drag?.button === 0 && !drag.moved;
  state.drag = null;
  if (shouldSelect && state.dimensionMode) {
    selectGeometryAt(event);
    elements.canvas.style.cursor = "crosshair";
    return;
  }
  if (shouldSelect && selectGeometryAt(event)) {
    elements.canvas.style.cursor = "pointer";
    return;
  }
  if (shouldSelect && selectGraphicsAt(event)) {
    elements.canvas.style.cursor = "pointer";
    return;
  }
  const hasHover = state.hoverBlockIndex !== null || state.geometryHover !== null;
  elements.canvas.style.cursor = hasHover ? "pointer" : (state.viewMode === "3d" ? "grab" : "crosshair");
  if (restorePrecision) request3dNavigationDraw();
}
elements.canvas.addEventListener("pointerup", (event) => finishCanvasDrag(event));
elements.canvas.addEventListener("pointercancel", (event) => finishCanvasDrag(event, true));
elements.canvas.addEventListener("auxclick", (event) => { if (event.button === 1) event.preventDefault(); });
elements.canvas.addEventListener("pointerleave", () => {
  if (state.drag) return;
  if (state.hoverBlockIndex !== null || state.geometryHover !== null) {
    state.hoverBlockIndex = null;
    state.geometryHover = null;
    draw();
  }
  elements.canvas.style.cursor = state.viewMode === "3d" ? "grab" : "crosshair";
  updateTransport();
});
elements.input.addEventListener("scroll", () => {
  positionProgramLineHighlight();
  renderProgramSearchHighlights();
});
function syncProgramLineToCursor({force = false} = {}) {
  if (state.programDirty) return;
  const line = sourceLineAtOffset(elements.input.value, elements.input.selectionStart);
  if (!force && line === state.programLine) return;
  state.playing = false;
  state.lastFrame = 0;
  setProgramLine(line, {scrollProgram: false});
}
function scheduleProgramCursorSync() {
  if (programCursorFrame !== null) return;
  programCursorFrame = requestAnimationFrame(() => {
    programCursorFrame = null;
    syncProgramLineToCursor();
  });
}
elements.input.addEventListener("click", () => syncProgramLineToCursor({force: true}));
elements.input.addEventListener("keydown", (event) => {
  if (programCursorNavigationKey(event.key)) scheduleProgramCursorSync();
});
elements.input.addEventListener("input", markProgramChanged);
elements.programSearchInput.addEventListener("input", refreshProgramSearch);
elements.programSearchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); closeProgramSearch(); }
  if (event.key === "Enter") { event.preventDefault(); stepProgramSearch(event.shiftKey ? -1 : 1); }
});
elements.programReplaceInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); closeProgramSearch(); }
  if (event.key === "Enter") { event.preventDefault(); replaceCurrentProgramMatch(); }
});
elements.programSearchPrevious.addEventListener("click", () => stepProgramSearch(-1));
elements.programSearchNext.addEventListener("click", () => stepProgramSearch(1));
elements.programSearchClose.addEventListener("click", closeProgramSearch);
elements.programReplaceOne.addEventListener("click", replaceCurrentProgramMatch);
elements.programReplaceAll.addEventListener("click", replaceEveryProgramMatch);

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  elements.install.hidden = false;
});
elements.install.addEventListener("click", async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  installPrompt = null;
  elements.install.hidden = true;
});
window.addEventListener("appinstalled", () => { elements.install.hidden = true; });
window.addEventListener("resize", renderProgramSearchHighlights);

let dragDepth = 0;
window.addEventListener("dragenter", (event) => {
  if (![...(event.dataTransfer?.items || [])].some((item) => item.kind === "file")) return;
  event.preventDefault();
  dragDepth += 1;
  elements.dropOverlay.hidden = false;
});
window.addEventListener("dragover", (event) => {
  if ([...(event.dataTransfer?.items || [])].some((item) => item.kind === "file")) event.preventDefault();
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) elements.dropOverlay.hidden = true;
});
window.addEventListener("drop", async (event) => {
  event.preventDefault();
  dragDepth = 0;
  elements.dropOverlay.hidden = true;
  await loadBrowserFile(event.dataTransfer?.files?.[0]);
});

window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) return;
  if (elements.toolLibraryDialog.open || elements.machineDialog.open || elements.compareDialog.open) return;
  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      openProgramSearch({replace: false});
    }
    if (event.key.toLowerCase() === "h") {
      event.preventDefault();
      openProgramSearch({replace: true});
    }
    if (event.key.toLowerCase() === "o") { event.preventDefault(); openProgram(); }
    if (event.key.toLowerCase() === "s") { event.preventDefault(); saveProgram(); }
    if (event.key === "Enter") { event.preventDefault(); plotProgram(); persistSession(); }
    return;
  }
  if (event.altKey || event.shiftKey || (event.target instanceof Element && event.target.matches("input, textarea, select"))) return;
  if (event.key === "ArrowLeft") { event.preventDefault(); stepProgram(-1); }
  if (event.key === "ArrowRight") { event.preventDefault(); stepProgram(1); }
});

document.addEventListener("pywebviewready", async () => {
  document.documentElement.dataset.desktop = "true";
  const initial = await window.pywebview.api.get_initial_file();
  if (initial?.error) { elements.status.textContent = initial.error; return; }
  if (initial?.content) loadProgram(initial.name, initial.content);
});

if ("serviceWorker" in navigator && !window.pywebview) {
  let refreshingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshingForUpdate) return;
    refreshingForUpdate = true;
    window.location.reload();
  });
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js", {updateViaCache: "none"})
    .then((registration) => registration.update())
    .catch(() => {}));
}

new ResizeObserver(resizeCanvas).observe(elements.wrap);
new ResizeObserver(() => {
  if (elements.compareDialog.open && state.compareView === "graphics") requestAnimationFrame(renderComparisonGraphics);
}).observe(elements.compareGraphicsAudit);
state.machineProfiles = mergeMachineProfiles(DEFAULT_MACHINE_PROFILES, readMachineProfileCache());
renderMachineSelect();
const restored = restoreSession();
activeUnitScale = unitScale();
refreshUnitUi();
updateProgramUnitsHint();
updateToolControls();
if (!restored) {
  elements.input.value = sampleProgram;
  state.bundledSample = true;
}
plotProgram();
loadMachineProfiles();
