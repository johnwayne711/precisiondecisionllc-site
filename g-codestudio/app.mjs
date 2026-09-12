import {parseGcode, programBounds, segmentLength} from "./gcode.mjs";
import {nominalCutterEdges, nominalNoseCircle} from "./lathe-cutter-edges.mjs";
import {latheControllerSettings} from "./lathe-controller-settings.mjs";
import {compensateLathePath, noseCompensationSetupIssues} from "./lathe-compensation.mjs";
import {
  MILL_PARSE_LIMITS, millPositionAt, millProgramBounds, millSegmentLengthMm, millSourceByteSummary,
  millSourceRecordSummary, parseMillGcode,
} from "./mill-gcode.mjs";
import {cycleTimeAtPosition, estimateCycleTime, formatCycleTime} from "./runtime.mjs";
import {spindleFeedAtPosition} from "./spindle-feed.mjs";
import {
  buildStockProfile, collisionPointForSegment, evaluateCollisions, extendStockProfile, isLiveToolSegment,
  stockContourPoints, stockMaterialIntervals, stockPlacement, stockVerificationColumns,
} from "./simulation.mjs";
import {convertUnitValue, scaleForUnits} from "./units.mjs";
import {
  PRIVATE_PREFERENCE_IDS, clearLocalApplicationData, isRememberJobEnabled, migrateLegacySession,
  readPrivatePreferences, readRememberedJob, saveRememberedJob, setRememberJobEnabled,
  writePrivatePreferences,
} from "./session-storage.mjs";
import {
  quarantineLegacyMachineProfileCache, readLocalMachineProfiles, writeLocalMachineProfiles,
} from "./machine-profile-storage.mjs";
import {roundBarSetup, roundBarSetupFromLegacy} from "./stock-setup.mjs";
import {hasStockCavities, stockSectionPolygons} from "./stock-section-view.mjs";
import {turningSpindleIssue} from "./tool-mounting.mjs";
import {buildA4cNominalPartoffSection} from "./tool-partoff-nominal.mjs";
import {COMPARISON_COLORS, comparePrograms, compareSegmentGeometry, diffLineTokens, firstComparisonBlocker, geometryItemsForFit, overlayGeometryLayers, segmentVerificationBlocked} from "./compare.mjs";
import {MAX_DXF_MATERIAL_CONTOURS, parseDxf, toLatheGeometry} from "./dxf-import.mjs";
import {mapStepSectionToLatheGeometry} from "./step-import.mjs";
import {MAX_STEP_BYTES, StepKernelClient} from "./step-worker-client.mjs";
import {createSolidSetupDialog} from "./solid-setup-dialog.mjs";
import {
  MAX_REFERENCE_UI_COMPARISON_OPERATIONS, REFERENCE_DISPLAY_ARC_MAXIMUM_SEGMENTS,
  referenceDisplayWorkload, worstReferenceWitness,
} from "./reference-display-budget.mjs";
import {
  compareProgramProfileMaterialEntry, compareProgramProfileToNominal,
  DEFAULT_PROFILE_NUMERICAL_BUDGET_MM, DEFAULT_PROFILE_TOLERANCE_MM, MAX_PROFILE_PENETRATION_FRAGMENTS,
  isProfileComparisonWorkloadError,
} from "./profile-compare.mjs";
import {blocksCuttingProfileVerification, materialEntryDiagnostics} from "./profile-diagnostics.mjs";
import {graphicsQualityPreset, renderGraphicsQualityPreset} from "./graphics-quality.mjs";
import {createFrameScheduler} from "./render-scheduler.mjs";
import {
  buildToolAssembly2d, buildToolAssemblyDisplay2d, DEFAULT_TOOL_ASSEMBLY_2D, listSelectableToolAssemblies2d,
  resolveAssignableToolAssembly2d, TOOL_ASSEMBLY_2D_STATUS, toolAssembly2dById,
  toolPhysicalReferencePointForExecution,
} from "./tool-assembly.mjs";
import {
  TOOL_LIBRARY_CATALOG, catalogDiamondInsertOutline2d, listToolLibraryAssemblies,
  toolLibraryAssemblyById, toolLibraryAssemblyDetail,
} from "./tool-library.mjs";
import {LIVE_TOOL_LIBRARY_CATALOG, listLiveToolLibraryRecords} from "./live-tool-library.mjs";
import {renderLiveFace2d} from "./live-view.mjs";
import {buildAxialFlatBoreStock, LIVE_STOCK_STATUS, summarizeAxialFlatBoreStock} from "./live-stock.mjs";
import {
  MILLING_TOOL_LIBRARY_CATALOG, listMillingToolLibraryRecords, millingToolLibraryRecordById,
} from "./milling-tool-library.mjs";
import {millingToolPreviewClaimLabels, millingToolPreviewViewModel} from "./milling-tool-preview.mjs";
import {plottedProgramStart, sl75SpindleGearContract} from "./machine-semantics.mjs";
import {displayHomeEstimate, machineProfileForVerification, onlyDisplayHomeChanged, strokeSizedHomeEstimate} from "./machine-semantics.mjs";
import {
  activeToolKeyAtLine, createProgramIdentity, createVersionedToolAssignment, editedProgramIdentity,
  isExactBundledProgram, normalizeVersionedToolAssignment,
  programAssignmentScope, programIdentityLabel, programToolDocumentIdentity, reconcileToolAssignments, restoredProgramIdentity,
  reconcileToolAssignmentsForEditorEdit, reviseToolAssignmentSetup, toolAssignmentAssemblyRef, toolAssignmentsForPersistence,
} from "./program-tools.mjs";
import {
  arcGeometry, geometryHitAt, geometryMeasurement, geometryPointAt, lineGeometry, motionGeometry, polylineGeometry, rectangleGeometry,
  sampleGeometryEntity,
} from "./geometry-inspector.mjs";
import {
  advanceExecutionPosition, blockedPathPreviewAtPosition, entryVisibleBlocksForSourceLine, executionLineForPosition, executionRangeForSourceLine,
  graphicsHitAt, graphicsSelectionEnabled, latestMachineEventAtPosition, machineRunningState,
  programCursorNavigationKey, programEndAtPosition, programStopAtPosition, programStopEventAtPosition, sourceEndAtPosition, sourceLineAtOffset,
} from "./interaction.mjs";
import {
  nextProgramSearchIndex, programSearchIndexFromAnchor, programSearchMatches, replaceAllProgramSearchMatches,
  replaceProgramSearchMatch,
} from "./editor-search.mjs";
import {gcodeTokenAtOffset, identifyGcodeToken, tokenizeGcodeLanguage} from "./gcode-language.mjs";
import {createPaneSplitter} from "./pane-splitter.mjs";
import {
  cameraViewForDirection, navigationDragMode, orbitCameraFromDrag, renderLathe3d, renderViewCube, standardCameraView,
  zoomCameraAt,
  viewCubeHitTarget,
} from "./view3d.mjs";
import {renderMill3d, renderMillTop2d} from "./mill-view.mjs";

const APP_VERSION = "v0.3.13";
const APP_BUILD = 115;

// Pairing acknowledgements belong only to this exact in-memory job and setup.
let toolOffsetConfirmationScope = null;
const confirmedToolOffsetPairings = new Set();

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

// The paired solid demo removes the unplaceable G28 machine-reference move so
// its otherwise exact G70 profile can produce a resolved geometry comparison.
const stepSampleProgram = sampleProgram
  .replace("G-CODE STUDIO SAMPLE - G71 ROUGH TURN", "G-CODE STUDIO SAMPLE - G71 + EXACT STEP")
  .replace("G28 U0 W0\n", "")
  .replace("G0 Z5.000\nX2.200", "G0 X2.200 Z5.000");
const dxfSampleProgram = stepSampleProgram
  .replace("G-CODE STUDIO SAMPLE - G71 + EXACT STEP", "G-CODE STUDIO SAMPLE - G71 + CLOSED DXF");
const STEP_SAMPLE_BYTE_LENGTH = 19_284;
const STEP_SAMPLE_SHA256 = "e4ccc03f7b42d8577b8c1fb2f54ae100018719a1bdc07bc02b4f41ebe0135f6e";
const STEP_SAMPLE_NAME = "sample-g71-finished-part.step";
const DXF_SAMPLE_BYTE_LENGTH = 462;
const DXF_SAMPLE_SHA256 = "c8e72ff386bef13150bdeb6e0df85c064105ce74e229a9e1e392594ba57718b3";
const DXF_SAMPLE_NAME = "sample-g71-finished-part.dxf";

const liveBoreSampleProgram = `%
O9003 (G-CODE STUDIO AXIAL LIVE-TOOL BORE DEMO)
G20 G390 G18
M5
T0202
G0 X3.000 Z2.100 (DEMO PLOTTED START - NOT MACHINE HOME)
G0 Z-0.400
G0 X2.000
M154
G0 C0.
M133 P3000
G17 G98 G112
G0 X0.500 Y0.000 Z-0.400
G1 Z-0.650 F5.0
G0 Z-0.400
G113
M135
M155
M30
%`;

const millSampleProgram = `%
O1001 (G-CODE STUDIO 3-AXIS MILL PATH SAMPLE)
G17 G20 G40 G49 G80 G90 G91.1 G94
G54
T1 M6
S6000 M3
G0 X-1.000 Y-1.000
G43 H1 Z0.250
G1 Z-0.100 F12.0
G1 X1.000 F24.0
Y1.000
X-1.000
Y-1.000
G0 Z0.250
X0.500 Y0.000
G1 Z-0.050 F12.0
G3 X-0.500 Y0.000 Z-0.150 I-0.500 J0.000 F18.0
G3 X0.500 Y0.000 Z-0.250 I0.500 J0.000
G0 Z0.250
M5
M30
%`;

const LIVE_BORE_SAMPLE_CUTTER_ID = "milling-tool:harvey-tool:771416";

function isExactBundledSample(source, bundledOrigin = false) {
  return isExactBundledProgram(source, sampleProgram, bundledOrigin)
    || isExactBundledProgram(source, stepSampleProgram, bundledOrigin)
    || isExactBundledProgram(source, dxfSampleProgram, bundledOrigin)
    || isExactBundledProgram(source, liveBoreSampleProgram, bundledOrigin)
    || isExactBundledProgram(source, millSampleProgram, bundledOrigin);
}

function isExactBundledTurningSample(source, bundledOrigin = false) {
  return isExactBundledProgram(source, sampleProgram, bundledOrigin)
    || isExactBundledProgram(source, stepSampleProgram, bundledOrigin)
    || isExactBundledProgram(source, dxfSampleProgram, bundledOrigin);
}

// Match only the untouched prior template notes when upgrading saved profiles.
const SL75_REVISION_1_NOTES = "DRAFT — owner-requested SL-75 turning environment. Initial plane is X/Z (G18); an explicit program plane command overrides it. Inch and diameter inputs match the owner's current setup. Exact controller, machine travels, home, rapid rates, spindle limits, turret and installed options are unconfirmed. Mori SL-series programming manual PM-NLTMSC518-I1EN lists the SL-75 and shows ordinary X/Z radius programming without G18 (B-12/B-13); its edition/control applicability to this older machine is unconfirmed. Source: https://www.remontservo.ru/arys/pages/publications/article-610/img-article/Mori-Seiki-SLSeries-Programming-Manua-l2008PMNLTMSC518I1ENL12002H02.pdf";
const DEFAULT_MACHINE_PROFILES = [
  {
    id: "hardinge-conquest-t42", name: "Hardinge Conquest T42 · Fanuc 18-T", manufacturer: "Hardinge",
    model: "Conquest T42", serialNumber: "", controlMake: "GE Fanuc", controlModel: "18-T",
    status: "draft", templateRevision: 1, units: "inch", xProgramming: "diameter", orientation: "left",
    xTravelMin: -6.37, xTravelMax: 0, zTravelMin: -16, zTravelMax: 0, homeX: 0, homeZ: 0,
    startMode: "home", startX: 12.74, startZ: 16, rapidBehavior: "dogleg", rapidXMax: 945, rapidZMax: 1200,
    liveToolDialect: "unconfigured", liveToolCapability: "unknown", cAxisCapability: "unknown",
    yAxisCapability: "unknown", cAxisEngagement: "unknown", rapidYMax: null, rapidCMax: null,
    liveToolMaxRpm: null, haasDefaultToFloat: "unknown", haasIntegerFeedScale: "unknown", liveToolEvidence: "",
    toolChangeX: 0, toolChangeZ: 0, safeIndexX: 0, safeIndexZ: 0, turretStations: 12,
    notes: "BEST-EFFORT DRAFT — NOT VERIFIED. Travel and rapid estimates come from Hardinge T-Series brochure 1312-1E; applicability to this older Conquest is unconfirmed. The 12-station turret is a guess from the 10/12-station options in Conquest parts list PL-60A. Assumes machine reference X0/Z0, negative machine travel, diameter-mode plotted home X12.74/Z16, and independent-axis rapid motion. Check every value at the machine before relying on it.",
    updatedAt: null,
  },
  {
    id: "mori-seiki-sl75", name: "Mori-Seiki SL-75", manufacturer: "Mori Seiki",
    model: "SL-75", serialNumber: "", controlMake: "", controlModel: "",
    status: "draft", templateRevision: 4, units: "inch", xProgramming: "diameter", orientation: "left", cssUnits: "program",
    initialPlane: "G18", initialFeedMode: "G99", startMode: "unknown", rapidBehavior: "unknown",
    xAxisStroke: 400 / 25.4, zAxisStroke: 1550 / 25.4, turretStations: 12,
    rapidXMax: 5000 / 25.4, rapidYMax: null, rapidZMax: 8000 / 25.4, rapidCMax: null,
    liveToolDialect: "unconfigured", liveToolCapability: "unknown", cAxisCapability: "unknown",
    yAxisCapability: "unknown", cAxisEngagement: "unknown", liveToolMaxRpm: null,
    haasDefaultToFloat: "unknown", haasIntegerFeedScale: "unknown", liveToolEvidence: "",
    notes: "DRAFT — factory specifications, pending confirmation on this machine. Mori Seiki SL-75 brochure, specification table (PDF page 4): 12 turret stations; physical X slide stroke 20 + 380 = 400 mm; Z stroke 1550 mm; X rapid 5000 mm/min; Z rapid 8000 mm/min. Inch fields are converted from these published metric values. Source: https://t-mt.com/kousaku/img/25809/25809.pdf\nThe brochure distinguishes SL-75A/B/C and several controls. Exact variant/control, spindle limits, installed options, machine-coordinate limits, home, tool-change positions and rapid interpolation remain unconfirmed. Stroke lengths do not establish coordinate limits or part zero.\nInitial plane is X/Z (G18); programmed plane changes override it. Inch/diameter inputs match the owner's setup. Ordinary X/Z radius programming is shown without G18 in Mori manual PM-NLTMSC518-I1EN, B-12/B-13; edition/control applicability remains unconfirmed. Source: https://www.remontservo.ru/arys/pages/publications/article-610/img-article/Mori-Seiki-SLSeries-Programming-Manua-l2008PMNLTMSC518I1ENL12002H02.pdf",
    updatedAt: null,
  },
  {
    id: "haas-ngc-live-tool-syntax", name: "Haas NGC lathe · live-tool syntax", manufacturer: "Haas Automation",
    model: "Lathe with live tooling", serialNumber: "", controlMake: "Haas", controlModel: "NGC",
    status: "draft", templateRevision: 1, units: "inch", xProgramming: "diameter", orientation: "left",
    startMode: "unknown", rapidBehavior: "unknown", rapidXMax: null, rapidYMax: null, rapidZMax: null, rapidCMax: null,
    liveToolDialect: "haas-lathe-ngc", liveToolCapability: "equipped", cAxisCapability: "available",
    yAxisCapability: "unavailable", cAxisEngagement: "automatic", liveToolMaxRpm: null, haasDefaultToFloat: "unknown",
    haasIntegerFeedScale: "unknown",
    liveToolEvidence: "https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dlathe.value%3DM134.html",
    notes: "DRAFT SYNTAX PROFILE ONLY — official Haas NGC live-tool command documentation is linked as evidence. This profile does not establish a specific machine's installed options, travels, rapid rates, spindle limit, offsets, or mounted-tool geometry.",
    updatedAt: null,
  },
  {
    id: "generic-lathe", name: "Generic lathe", manufacturer: "", model: "", serialNumber: "",
    controlMake: "", controlModel: "", status: "draft", templateRevision: 0, units: "inch", xProgramming: "diameter",
    orientation: "left", startMode: "unknown", rapidBehavior: "unknown", rapidXMax: null, rapidYMax: null,
    rapidZMax: null, rapidCMax: null, liveToolDialect: "unconfigured", liveToolCapability: "unknown",
    cAxisCapability: "unknown", yAxisCapability: "unknown", cAxisEngagement: "unknown", liveToolMaxRpm: null, haasDefaultToFloat: "unknown",
    haasIntegerFeedScale: "unknown",
    liveToolEvidence: "", notes: "", updatedAt: null,
  },
];
const MACHINE_PROFILE_FIELDS = [
  "name", "manufacturer", "model", "serialNumber", "controlMake", "controlModel", "status", "units",
  "xProgramming", "orientation", "initialPlane", "initialFeedMode", "cssUnits", "xTravelMin", "xTravelMax", "zTravelMin", "zTravelMax", "homeX", "homeZ",
  "xAxisStroke", "zAxisStroke",
  "displayHomeMode", "displayHomeX", "displayHomeZ",
  "startMode", "startX", "startZ", "rapidBehavior", "rapidXMax", "rapidZMax", "toolChangeX", "toolChangeZ",
  "safeIndexX", "safeIndexZ", "turretStations", "liveToolDialect", "liveToolCapability", "cAxisCapability",
  "yAxisCapability", "cAxisEngagement", "rapidYMax", "rapidCMax", "liveToolMaxRpm", "haasDefaultToFloat",
  "haasIntegerFeedScale", "liveToolEvidence", "notes",
];
const NUMERIC_MACHINE_FIELDS = new Set([
  "displayHomeX", "displayHomeZ",
  "xAxisStroke", "zAxisStroke",
  "xTravelMin", "xTravelMax", "zTravelMin", "zTravelMax", "homeX", "homeZ", "startX", "startZ",
  "rapidXMax", "rapidYMax", "rapidZMax", "rapidCMax", "liveToolMaxRpm", "toolChangeX", "toolChangeZ",
  "safeIndexX", "safeIndexZ", "turretStations",
]);

const $ = (id) => document.getElementById(id);
const elements = {
  workspace: $("workspace"), canvas: $("plotCanvas"), wrap: $("canvasWrap"), input: $("gcodeInput"), fileInput: $("fileInput"),
  geometryFileInput: $("geometryFileInput"), importGeometry: $("importGeometryButton"),
  stepFileInput: $("stepFileInput"), importStep: $("importStepButton"),
  programPanel: $("programPanel"), editor: $("gcodeEditor"), activeLine: $("gcodeActiveLine"), lineNumbers: $("gcodeLineNumbers"),
  syntaxLayer: $("gcodeSyntaxLayer"), syntaxCode: $("gcodeSyntaxCode"), paneSplitter: $("programPaneSplitter"), graphicsPanel: $("graphicsPanel"),
  activeLineNumber: $("gcodeActiveNumber"), searchHighlights: $("gcodeSearchHighlights"), riskHighlights: $("gcodeRiskHighlights"),
  codeInspector: $("gcodeCodeInspector"), codeInspectorCode: $("gcodeCodeInspectorCode"),
  codeInspectorStatus: $("gcodeCodeInspectorStatus"), codeInspectorTitle: $("gcodeCodeInspectorTitle"),
  codeInspectorDescription: $("gcodeCodeInspectorDescription"), codeInspectorScope: $("gcodeCodeInspectorScope"),
  codeInspectorClose: $("gcodeCodeInspectorClose"),
  programSearchPanel: $("programSearchPanel"), programSearchInput: $("programSearchInput"),
  programSearchStatus: $("programSearchStatus"), programSearchPrevious: $("programSearchPrevious"),
  programSearchNext: $("programSearchNext"), programSearchClose: $("programSearchClose"),
  programReplaceRow: $("programReplaceRow"), programReplaceInput: $("programReplaceInput"),
  programReplaceOne: $("programReplaceOne"), programReplaceAll: $("programReplaceAll"),
  fileName: $("fileName"), lineCount: $("lineCount"), status: $("programStatus"), timeline: $("timeline"),
  sessionPrivacy: $("sessionPrivacy"), sessionPrivacyTitle: $("sessionPrivacyTitle"),
  sessionPrivacyStatus: $("sessionPrivacyStatus"), sessionPrivacyMessage: $("sessionPrivacyMessage"),
  rememberJob: $("rememberJobToggle"), clearLocalData: $("clearLocalDataButton"),
  blockReadout: $("blockReadout"), play: $("playButton"), stepBack: $("stepBackButton"), stepForward: $("stepForwardButton"),
  readerElapsedTime: $("readerElapsedTime"), readerRemainingTime: $("readerRemainingTime"), readerTotalTime: $("readerTotalTime"),
  speed: $("speedSelect"), optionalStopControl: $("optionalStopControl"), optionalStop: $("optionalStopToggle"), optionalStopStatus: $("optionalStopStatus"),
  machineMode: $("machineModeSelect"), machine: $("machineSelect"), editMachine: $("editMachineButton"), orientation: $("orientationSelect"),
  xMode: $("xModeSelect"), programUnits: $("programUnits"), programUnitsHint: $("programUnitsHint"), stockDiameter: $("stockDiameter"), stockLength: $("stockLength"), stockGripLength: $("stockGripLength"), stockStickout: $("stockStickout"), stockFrontZ: $("stockFrontZ"), stockToggle: $("stockToggle"),
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
  compareOriginalToggle: $("compareOriginalToggle"), compareRevisedToggle: $("compareRevisedToggle"), compareMatchingToggle: $("compareMatchingToggle"),
  compareZoomIn: $("compareZoomIn"), compareZoomOut: $("compareZoomOut"), compareFit: $("compareFit"), compareZoomLevel: $("compareZoomLevel"),
  fitGeometryDifferences: $("fitGeometryDifferences"), fitGeometryPart: $("fitGeometryPart"), compareNavigation: $("compareNavigation"),
  graphicsInfoButton: $("graphicsInfoButton"), graphicsInfoPanel: $("graphicsInfoPanel"),
  view2d: $("view2dButton"), viewFace: $("viewFaceButton"), view3d: $("view3dButton"), faceViewStatus: $("faceViewStatus"),
  millViewStatus: $("millViewStatus"), latheReadout: $("latheReadout"), millReadout: $("millReadout"),
  toolOverlay: $("toolOverlayButton"), toolVerificationBadge: $("toolVerificationBadge"),
  programToolsSetup: $("programToolsSetup"), programToolSummary: $("programToolSummary"), programToolList: $("programToolList"),
  toolLibraryButton: $("toolLibraryButton"), toolLibraryDialog: $("toolLibraryDialog"), toolLibraryClose: $("toolLibraryClose"),
  toolLibrarySearch: $("toolLibrarySearch"), toolLibraryFamilyFilter: $("toolLibraryFamilyFilter"),
  toolLibraryShapeFilter: $("toolLibraryShapeFilter"), toolLibraryAuthorityFilter: $("toolLibraryAuthorityFilter"),
  toolLibraryFamilyFilterLabel: $("toolLibraryFamilyFilterLabel"), toolLibraryShapeFilterLabel: $("toolLibraryShapeFilterLabel"),
  toolLibraryResults: $("toolLibraryResults"), toolLibraryResultsTitle: $("toolLibraryResultsTitle"),
  toolLibraryResultCount: $("toolLibraryResultCount"), toolLibraryDetail: $("toolLibraryDetail"),
  toolLibraryTarget: $("toolLibraryTarget"), toolLibraryAssign: $("toolLibraryAssign"),
  viewCube: $("viewCube"), viewCubeCanvas: $("viewCubeCanvas"), viewCubeHome: $("viewCubeHome"),
  graphicsQuality: $("graphicsQuality"), graphicsQualityHint: $("graphicsQualityHint"),
  toolpathToggle: $("toolpathToggle"), liveToolStatus: $("liveToolStatus"),
  referenceGeometrySetup: $("referenceGeometrySetup"), referenceGeometrySummary: $("referenceGeometrySummary"),
  referenceGeometryFile: $("referenceGeometryFile"), referenceGeometryUnits: $("referenceGeometryUnits"),
  referenceGeometryTolerance: $("referenceGeometryTolerance"), referenceGeometryOriginX: $("referenceGeometryOriginX"),
  referenceGeometryOriginY: $("referenceGeometryOriginY"), referenceGeometryZDirection: $("referenceGeometryZDirection"),
  referenceGeometryXDirection: $("referenceGeometryXDirection"), referenceGeometryToggle: $("referenceGeometryToggle"),
  referenceDxfMaterialContour: $("referenceDxfMaterialContour"),
  referenceDxfMaterialInside: $("referenceDxfMaterialInside"),
  referenceDxfMaterialState: $("referenceDxfMaterialState"),
  referenceDxfMaterialStatus: $("referenceDxfMaterialStatus"),
  referenceGeometryImportStatus: $("referenceGeometryImportStatus"),
  referenceGeometryAlignmentStatus: $("referenceGeometryAlignmentStatus"),
  referenceGeometryDeviation: $("referenceGeometryDeviation"),
  referenceGeometryPenetrationStatus: $("referenceGeometryPenetrationStatus"),
  referenceGeometryPenetrationDepth: $("referenceGeometryPenetrationDepth"),
  profilePenetrationAlert: $("profilePenetrationAlert"),
  profilePenetrationAlertTitle: $("profilePenetrationAlertTitle"),
  profilePenetrationAlertMessage: $("profilePenetrationAlertMessage"),
  profilePenetrationJump: $("profilePenetrationJump"),
  toolRotationAlert: $("toolRotationAlert"), toolRotationAlertTitle: $("toolRotationAlertTitle"),
  toolRotationAlertMessage: $("toolRotationAlertMessage"),
  toolRotationSetup: $("toolRotationSetup"), toolRotationJump: $("toolRotationJump"),
  loadDxfReferenceDemo: $("loadDxfReferenceDemoButton"), loadStepReferenceDemo: $("loadStepReferenceDemoButton"),
  inspectReferenceDeviation: $("inspectReferenceDeviationButton"),
  referenceGeometryDiagnostics: $("referenceGeometryDiagnostics"), removeGeometry: $("removeGeometryButton"),
  referenceDxfControls: $("referenceDxfControls"), referenceStepControls: $("referenceStepControls"),
  stepAxialAxis: $("stepAxialAxis"), stepRadialAxis: $("stepRadialAxis"), stepNormalAxis: $("stepNormalAxis"),
  stepPlaneOffset: $("stepPlaneOffset"), stepContour: $("stepContour"), stepAxialOrigin: $("stepAxialOrigin"),
  stepRadialOrigin: $("stepRadialOrigin"), stepAxialDirection: $("stepAxialDirection"),
  stepRadialDirection: $("stepRadialDirection"), buildStepSection: $("buildStepSectionButton"),
  dimensionButton: $("dimensionButton"), clearDimensionsButton: $("clearDimensionsButton"),
  geometryInspector: $("geometryInspector"), clearGeometrySelection: $("clearGeometrySelection"),
  latheMachineSelectRow: $("latheMachineSelectRow"), millSetupIdentity: $("millSetupIdentity"),
  latheOrientationControl: $("latheOrientationControl"), latheXModeControl: $("latheXModeControl"),
  latheSetupControls: $("latheSetupControls"), millSetupBoundary: $("millSetupBoundary"),
  compare: $("compareButton"), workspaceSafetyNote: $("workspaceSafetyNote"),
};

const state = {
  parsed: {segments: [], warnings: []}, cycleTime: null, programLine: 0, visibleBlocks: 0, playing: false, lastFrame: 0,
  feedReadoutMode: "per-minute",
  camera: {scale: 1, offsetX: 0, offsetY: 0, fitted: false}, drag: null, cursor: null,
  machineProfiles: DEFAULT_MACHINE_PROFILES.map((profile) => ({...profile})),
  comparisonOriginal: null, comparison: null, compareChangeIndex: -1, comparisonOriginalRevision: 0, comparisonPickerRevision: null,
  compareView: "code", compareGraphicsLayout: "overlay", comparisonGeometry: null,
  compareLayers: {original: true, revised: true, matching: true},
  compareCamera: {zoom: 1, offsetZ: 0, offsetX: 0}, compareViewport: null, compareDrag: null,
  viewMode: "2d", camera3d: {yaw: -Math.PI / 4, pitch: Math.asin(1 / Math.sqrt(3)), zoom: 1, panX: 0, panY: 0},
  viewCubeRegions: [], viewCubeHover: null,
  stockProfileCache: null, stockSamplingError: null,
  preview3dUntil: 0, precisionRedrawTimer: null,
  graphicsHits: [], hoverBlockIndex: null, highlightedSourceLine: null, programDirty: false,
  componentGeometry: [], geometryHover: null, geometrySelection: null,
  dimensions: [], dimensionMode: false,
  showTool2d: false,
  toolAssignments: {}, toolAssignmentRevision: 0, toolAssignmentScope: null,
  toolAssignmentDocumentIdentity: null, programEditOrigin: null, bundledSample: false,
  programIdentity: createProgramIdentity(sampleProgram, {fileName: "sample-g71-rough.nc", origin: "sample"}),
  bundledStepReference: false,
  toolLibraryTab: "assemblies", toolLibrarySelection: null,
  referenceGeometry: null, referenceComparison: null, showReferenceWitness: false, referenceGeneration: 0, referenceIntentRevision: 0,
  programRevision: 0,
  solidSetupActive: false,
  rememberJob: false, rememberedJobSaved: false,
};
const ctx = elements.canvas.getContext("2d");
const solidSetupDialog = createSolidSetupDialog({
  getMachineContext: () => ({orientation: elements.orientation.value, xMode: elements.xMode.value, units: elements.displayUnits.value}),
  onApply: applyGuidedStepSection,
  onRecoverWorker: recoverStepAnalyticWorker,
  onActiveChange: (active) => {
    state.solidSetupActive = active;
    updateToolRotationAlert();
    elements.wrap.classList.toggle("solid-placement-active", active);
    elements.wrap.closest(".workspace")?.classList.toggle("solid-placement-mode", active);
    if (active) {
      state.playing = false;
      elements.play.dataset.transportState = "play";
      elements.play.setAttribute("aria-label", "Play");
    }
  },
});
const navigation3dRenderer = createFrameScheduler({
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (frame) => cancelAnimationFrame(frame),
  render: () => { if (state.viewMode === "3d") draw(); },
});
// Keep the established saved L / jaw-face / grip contract. UI drafts never
// become simulation or persisted stock until the whole setup is valid.
const stockSetupKeys = {
  stockDiameter: "diameter", stockLength: "length", stockGripLength: "gripLength",
  stockStickout: "stickoutLength", stockFrontZ: "frontZ", chuckFaceZ: "faceZ",
  stockPilotBore: "pilotBoreDiameter",
};
let appliedStockSetup = null;
let stockDimensionFocus = null;
const preferenceIds = [
  "machineModeSelect", "machineSelect", "orientationSelect", "xModeSelect", "programUnits", "displayUnits", "stockDiameter", "stockLength", "stockGripLength",
  "stockToggle", "chuckFaceZ", "jawDiameter", "clearanceInput", "collisionToggle", "graphicsQuality",
  "toolpathToggle", "stockPilotBore",
];
let installPrompt = null;
let persistTimer = null;
let programCursorFrame = null;
let programLanguageFrame = null;
let programLanguageSource = "";
let programLanguage = tokenizeGcodeLanguage("");
let programSyntaxDisplayEnabled = true;
const programSearch = {
  matches: [], index: -1, kind: "empty", anchorStart: 0, anchorEnd: 0, selectionDirection: "none",
  anchorScrollTop: 0, anchorScrollLeft: 0,
};
const programTextMeasureContext = document.createElement("canvas").getContext("2d");
const STOCK_FRAME_CACHE_LIMIT = 64;
const THREE_D_SETTLE_MS = 850;
const MAX_DXF_BYTES = 25 * 1024 * 1024;
const PROGRAM_EDITOR_LINE_LIMIT = MILL_PARSE_LIMITS.maxRecords;
const PROGRAM_SYNTAX_SOURCE_LIMIT = 1024 * 1024;
const PROGRAM_SYNTAX_TOKEN_LIMIT = 25_000;
const PROGRAM_SYNTAX_LINE_LIMIT = 512;
const PROGRAM_INSPECT_LINE_LIMIT = 4096;
const TOOL_LIBRARY_SOURCE_BY_ID = new Map(TOOL_LIBRARY_CATALOG.sources.map((source) => [source.id, source]));
const LIVE_TOOL_LIBRARY_SOURCE_BY_ID = new Map(LIVE_TOOL_LIBRARY_CATALOG.sources.map((source) => [source.id, source]));
const MILLING_TOOL_LIBRARY_SOURCE_BY_ID = new Map(MILLING_TOOL_LIBRARY_CATALOG.sources.map((source) => [source.id, source]));
const PROGRAM_SYNTAX_STYLED_TYPES = new Set([
  "comment", "sequence", "g-code", "m-code", "tool", "speed", "feed", "coordinate", "address",
  "number", "punctuation", "malformed-word", "unknown",
]);

function positionProgramSyntax() {
  elements.editor.classList.toggle(
    "syntax-horizontal-fallback",
    programSyntaxDisplayEnabled && elements.input.scrollLeft > 0.5,
  );
  elements.syntaxCode.style.transform = `translate(${-elements.input.scrollLeft}px, ${-elements.input.scrollTop}px)`;
}

function programSyntaxLineLimitExceeded(source) {
  let lineCharacters = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\r" || source[index] === "\n") lineCharacters = 0;
    else if (++lineCharacters > PROGRAM_SYNTAX_LINE_LIMIT) return true;
  }
  return false;
}

function showNativeProgramText(source, message) {
  programLanguageSource = source;
  programLanguage = {
    sourceLength: source.length,
    lineCount: null,
    complete: false,
    tokens: [],
    diagnostics: [{severity: "warning", code: "syntax-display-limit", message, offset: 0}],
  };
  programSyntaxDisplayEnabled = false;
  elements.syntaxCode.replaceChildren();
  elements.editor.classList.remove("syntax-ready");
  elements.syntaxLayer.title = message;
  positionProgramSyntax();
  if (!elements.codeInspector.hidden) inspectProgramTokenAtCaret({hideWhenNone: true});
}

function renderProgramSyntax() {
  if (programLanguageFrame !== null) {
    cancelAnimationFrame(programLanguageFrame);
    programLanguageFrame = null;
  }
  const source = elements.input.value;
  if (source.length > PROGRAM_SYNTAX_SOURCE_LIMIT) {
    showNativeProgramText(
      source,
      `Native editor shown because syntax coloring is limited to ${PROGRAM_SYNTAX_SOURCE_LIMIT.toLocaleString("en-US")} characters. Click help remains available for an individual bounded line.`,
    );
    return;
  }
  if (programSyntaxLineLimitExceeded(source)) {
    showNativeProgramText(
      source,
      `Native editor shown because a line exceeds the ${PROGRAM_SYNTAX_LINE_LIMIT.toLocaleString("en-US")}-character color-alignment limit. Click help remains available for an individual bounded line.`,
    );
    return;
  }
  const language = tokenizeGcodeLanguage(source, {
    maxSourceCharacters: PROGRAM_SYNTAX_SOURCE_LIMIT,
    maxTokens: PROGRAM_SYNTAX_TOKEN_LIMIT,
  });
  if (!language.complete) {
    showNativeProgramText(
      source,
      language.diagnostics[0]?.message || "Native editor shown because syntax coloring reached its bounded local limit.",
    );
    return;
  }
  programLanguage = language;
  programLanguageSource = source;
  programSyntaxDisplayEnabled = true;
  const fragment = document.createDocumentFragment();
  for (const token of programLanguage.tokens) {
    if (!PROGRAM_SYNTAX_STYLED_TYPES.has(token.type)) {
      fragment.append(document.createTextNode(token.text));
      continue;
    }
    const span = document.createElement("span");
    span.className = `gcode-token-${token.type}`;
    if (token.malformed) span.classList.add("gcode-token-malformed-word");
    span.textContent = token.text;
    fragment.append(span);
  }
  elements.syntaxCode.replaceChildren(fragment);
  elements.editor.classList.add("syntax-ready");
  elements.syntaxLayer.title = "Color-coded G-code. Click a code in the editor to identify it.";
  positionProgramSyntax();
  if (!elements.codeInspector.hidden) inspectProgramTokenAtCaret({hideWhenNone: true});
}

function scheduleProgramSyntaxRender() {
  if (programLanguageFrame !== null) return;
  programLanguageFrame = requestAnimationFrame(() => {
    programLanguageFrame = null;
    renderProgramSyntax();
  });
}

function programLanguageContext() {
  const profile = currentMachineProfile();
  return {
    machineType: isMillMode() ? "mill" : "lathe",
    dialect: profile?.liveToolDialect === "haas-lathe-ngc" ? "haas-lathe-ngc" : "generic",
    spindleGearContract: sl75SpindleGearContract(profile),
    optionalStopEnabled: elements.optionalStop.checked,
  };
}

function updateOptionalStopControl() {
  const enabled = elements.optionalStop.checked;
  elements.optionalStopStatus.textContent = enabled ? "ON" : "OFF";
  elements.optionalStopControl.title = enabled
    ? "M01 pauses the local reader; Play resumes at the following block"
    : "M01 is recognized and the local reader continues without pausing";
}

function nonCodeTokenIdentification(token) {
  const exact = token.normalized || token.text.trim() || token.text;
  const base = {
    status: "not-code", code: exact, title: "Program word", description: "This token is not a G or M command.",
    scope: "Its meaning is not inferred without the surrounding block and selected controller context.",
  };
  if (token.type === "sequence") return {...base, title: `${exact} · sequence number`, description: "Labels this source block for navigation and supported P/Q contour references.", scope: "A sequence number does not command motion by itself."};
  if (token.type === "tool") return {...base, title: `${exact} · tool call`, description: "Selects the exact program tool key used by this block.", scope: "Tool assignment is optional for command-centerline backplotting. Confirmed tool geometry is still required for tool-dependent stock removal and cutter authority."};
  if (token.type === "speed") return {...base, title: `${exact} · spindle speed word`, description: "Supplies a speed value to the active spindle mode.", scope: "RPM or surface-speed interpretation depends on the active G-code and controller context; the word alone does not establish a safe machine speed."};
  if (token.type === "feed") return {...base, title: `${exact} · feed word`, description: "Supplies a feed value to the active motion and feed mode.", scope: "Per-minute, per-revolution, and cycle-specific interpretation depends on established modal state."};
  if (token.type === "coordinate") return {...base, title: `${exact} · coordinate / geometry word`, description: `Supplies an ${token.address}-address value to the active command.`, scope: "Axis, arc-center, radius, or auxiliary meaning depends on the active plane, motion, controller, and units; no standalone meaning is guessed."};
  if (token.type === "address") return {...base, title: `${exact} · address word`, description: `Supplies a ${token.address}-address value to the active command.`, scope: "The local inspector does not assign it a standalone controller meaning."};
  if (token.type === "comment") return {...base, status: token.malformed ? "malformed" : "not-code", code: "COMMENT", title: token.malformed ? "Malformed program comment" : "Program comment", description: "Human-readable program text; it does not command modeled motion.", scope: token.malformed ? "This comment is malformed and may change how a controller reads the rest of the line." : "Comment conventions can still vary by controller."};
  if (token.type === "malformed-word" || token.malformed) return {...base, status: "malformed", title: `${exact || "TOKEN"} · malformed`, description: "This is not a complete numeric address word.", scope: "Review the exact machine/control syntax; G-Code Studio will not repair or infer the missing value."};
  if (token.type === "unknown" || token.type === "unparsed") return {...base, status: "unresolved", title: `${exact || "TOKEN"} · unresolved`, description: "This source text is outside the bounded local syntax classification.", scope: "No controller meaning is guessed or executed."};
  if (token.type === "punctuation" && token.text === "#") return {...base, status: "unresolved", title: "# · macro expression marker", description: "Macro-variable and expression execution is not modeled by the current local engine.", scope: "Treat the affected control flow and values as unresolved; no expression result is guessed."};
  if (token.type === "punctuation" && token.text === "/") return {...base, status: "unresolved", title: "/ · optional block marker", description: "Marks a block whose execution can depend on the control's block-delete state.", scope: "Reachability is unresolved unless that machine setting is explicitly established; G-Code Studio does not guess it."};
  if (token.type === "punctuation" && (token.text === "%" || token.text === "$")) return {...base, title: `${token.text} · tape boundary marker`, description: "Marks a program transport boundary in the bounded local source envelope.", scope: `${token.text} is accepted only in its exact supported boundary position; it is not a machining command.`};
  return base;
}

function programLineNumberAtOffset(source, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n" || (source[index] === "\r" && source[index + 1] !== "\n")) line += 1;
  }
  return line;
}

function programTokenAtCaret(offset) {
  if (programSyntaxDisplayEnabled) return gcodeTokenAtOffset(programLanguage, offset);
  const source = elements.input.value;
  const caret = Math.max(0, Math.min(source.length, Number(offset) || 0));
  let lineStart = caret;
  while (lineStart > 0 && source[lineStart - 1] !== "\n" && source[lineStart - 1] !== "\r") {
    lineStart -= 1;
    if (caret - lineStart > PROGRAM_INSPECT_LINE_LIMIT) return null;
  }
  let lineEnd = caret;
  while (lineEnd < source.length && source[lineEnd] !== "\n" && source[lineEnd] !== "\r") {
    lineEnd += 1;
    if (lineEnd - lineStart > PROGRAM_INSPECT_LINE_LIMIT) return null;
  }
  const lineSource = source.slice(lineStart, lineEnd);
  const localLanguage = tokenizeGcodeLanguage(lineSource, {
    maxSourceCharacters: PROGRAM_INSPECT_LINE_LIMIT,
    maxTokens: PROGRAM_INSPECT_LINE_LIMIT,
  });
  if (!localLanguage.complete) return null;
  const localToken = gcodeTokenAtOffset(localLanguage, caret - lineStart);
  if (!localToken) return null;
  const lineOffset = programLineNumberAtOffset(source, lineStart) - 1;
  return {
    ...localToken,
    start: localToken.start + lineStart,
    end: localToken.end + lineStart,
    line: localToken.line + lineOffset,
    endLine: localToken.endLine + lineOffset,
  };
}

function inspectProgramTokenAtCaret({hideWhenNone = false} = {}) {
  if (programLanguageSource !== elements.input.value) renderProgramSyntax();
  const token = programTokenAtCaret(elements.input.selectionStart);
  if (!token) {
    if (hideWhenNone) elements.codeInspector.hidden = true;
    return;
  }
  const identified = identifyGcodeToken(token, programLanguageContext());
  const detail = identified.status === "not-code" ? nonCodeTokenIdentification(token) : identified;
  const statusLabels = {
    modeled: "MODELED HERE",
    "not-modeled-here": "NOT MODELED HERE",
    unresolved: "UNRESOLVED",
    malformed: "MALFORMED",
    "not-code": "PROGRAM WORD",
  };
  const profile = currentMachineProfile();
  elements.codeInspector.dataset.status = detail.status;
  elements.codeInspectorCode.textContent = detail.code || token.normalized || token.text.trim() || "TOKEN";
  elements.codeInspectorStatus.textContent = statusLabels[detail.status] || "IDENTIFIED";
  elements.codeInspectorTitle.textContent = detail.title;
  elements.codeInspectorDescription.textContent = detail.description;
  elements.codeInspectorScope.textContent = `Line ${token.line} · ${detail.scope} Selected context: ${isMillMode() ? "3-axis mill / Fanuc-style" : `lathe / ${profile?.name || "generic controller"}`}.`;
  elements.codeInspector.hidden = false;
}

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
  if (isMillMode() && millSourceByteSummary(elements.input.value).exceeded) return PROGRAM_EDITOR_LINE_LIMIT + 1;
  return millSourceRecordSummary(elements.input.value, {maxRecords: PROGRAM_EDITOR_LINE_LIMIT}).count;
}

function renderProgramLineNumbers() {
  const byteSummary = isMillMode() ? millSourceByteSummary(elements.input.value) : null;
  if (byteSummary?.exceeded) {
    elements.lineNumbers.textContent = "";
    elements.lineNumbers.dataset.suppressed = "true";
    elements.lineCount.textContent = `>${byteSummary.maxSourceBytes.toLocaleString("en-US")} bytes · gutter hidden`;
    return;
  }
  const summary = millSourceRecordSummary(elements.input.value, {maxRecords: PROGRAM_EDITOR_LINE_LIMIT});
  if (summary.exceeded) {
    elements.lineNumbers.textContent = "";
    elements.lineNumbers.dataset.suppressed = "true";
    elements.lineCount.textContent = `>${summary.maxRecords.toLocaleString("en-US")} lines · gutter hidden`;
    return;
  }
  delete elements.lineNumbers.dataset.suppressed;
  const numbers = [];
  for (let line = 1; line <= summary.count; line += 1) numbers.push(line);
  elements.lineNumbers.textContent = numbers.join("\n");
  elements.lineCount.textContent = `${summary.count} lines`;
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
  const {lineHeight, paddingTop, paddingLeft, characterWidth, tabSize} = programEditorMetrics();
  const fragment = document.createDocumentFragment();
  for (const [index, match] of programSearch.matches.entries()) {
    const top = paddingTop + (match.line - 1) * lineHeight - elements.input.scrollTop;
    if (top + lineHeight < 0 || top > elements.input.clientHeight) continue;
    const lineStart = match.lineStart;
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

function penetratingMaterialSegmentResults() {
  if (state.programDirty || state.referenceComparison?.pending) return [];
  return (state.referenceComparison?.materialEntry?.segmentResults || [])
    .filter((result) => result.classification === "penetration");
}

function renderProgramRiskHighlights() {
  elements.riskHighlights.replaceChildren();
  const sourceLines = [...new Set(penetratingMaterialSegmentResults()
    .map((result) => Number(result.sourceLine))
    .filter((line) => Number.isInteger(line) && line > 0))]
    .slice(0, MAX_PROFILE_PENETRATION_FRAGMENTS);
  if (!sourceLines.length) return;
  const {lineHeight, paddingTop} = programEditorMetrics();
  const fragment = document.createDocumentFragment();
  for (const line of sourceLines) {
    const top = paddingTop + (line - 1) * lineHeight - elements.input.scrollTop;
    if (top + lineHeight < 0 || top > elements.input.clientHeight) continue;
    const highlight = document.createElement("span");
    highlight.className = "gcode-risk-line";
    highlight.style.top = `${top}px`;
    highlight.style.height = `${lineHeight}px`;
    fragment.append(highlight);
  }
  elements.riskHighlights.append(fragment);
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
    elements.programSearchStatus.textContent = result.kind === "blocked"
      ? result.reason
      : (result.kind === "empty" ? "Type to find" : "No matches");
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

function invalidateReferenceComparison(label, message) {
  if (!state.referenceGeometry?.ready) return;
  const witnessWasVisible = state.showReferenceWitness;
  state.showReferenceWitness = false;
  state.referenceComparison = {pending: true, pendingLabel: label, pendingMessage: message};
  renderReferenceGeometryUi();
  if (witnessWasVisible) draw();
}

function currentProgramFileName() {
  return state.programIdentity?.fileName || "program.nc";
}

function renderProgramIdentity() {
  elements.fileName.textContent = programIdentityLabel(state.programIdentity, elements.input.value);
  elements.fileName.title = state.programIdentity?.origin === "editor" ? "Unsaved editor program"
    : state.programIdentity?.origin === "sample" ? "Bundled sample or an edited sample" : currentProgramFileName();
}

function markProgramChanged() {
  state.programRevision += 1;
  state.programIdentity = editedProgramIdentity(state.programIdentity, elements.input.value);
  renderProgramIdentity();
  clearToolOffsetConfirmations();
  state.playing = false;
  state.lastFrame = 0;
  state.programEditOrigin = "editor";
  state.stockProfileCache = null;
  state.bundledSample = false;
  state.bundledStepReference = false;
  state.programDirty = true;
  updateToolOffsetAlert();
  updateToolRotationAlert();
  state.highlightedSourceLine = null;
  positionProgramLineHighlight();
  renderProgramLineNumbers();
  elements.editor.classList.remove("syntax-ready");
  scheduleProgramSyntaxRender();
  elements.status.textContent = "Program changed — plot to refresh";
  updateStockRemovedStatus(null, "PLOT REQUIRED");
  updateTransport();
  invalidateReferenceComparison("PLOT REQUIRED", "The G-code changed; plot it again before using the reference-path result.");
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
  if (replaced.blocked) {
    elements.programSearchStatus.textContent = replaced.reason;
    elements.programReplaceInput.focus();
    return;
  }
  elements.input.value = replaced.value;
  preserveProgramSearchAnchor(anchorStart, anchorEnd);
  markProgramChanged();
  refreshProgramSearch();
  elements.programSearchStatus.textContent = `Replaced ${replaced.count}`;
  elements.programReplaceInput.focus();
}

function capturedPreferences(ids = preferenceIds) {
  const preferences = {};
  for (const id of ids) {
    const control = $(id);
    if (!control) continue;
    preferences[id] = control.type === "checkbox" ? control.checked : control.value;
    if (appliedStockSetup && stockSetupKeys[id]) preferences[id] = preciseDisplayInput(appliedStockSetup[stockSetupKeys[id]]);
  }
  return preferences;
}

function applyStoredPreferences(preferences) {
  for (const [id, value] of Object.entries(preferences || {})) {
    const control = $(id);
    if (!control) continue;
    if (control.type === "checkbox") control.checked = Boolean(value);
    else if (control.tagName !== "SELECT" || [...control.options].some((option) => option.value === value)) control.value = String(value);
  }
}

function renderSessionPrivacy() {
  const remembered = state.rememberJob && state.rememberedJobSaved;
  elements.rememberJob.checked = state.rememberJob;
  elements.sessionPrivacy.dataset.mode = remembered ? "remembered" : "private";
  elements.sessionPrivacyTitle.textContent = remembered ? "JOB REMEMBERED" : "PRIVATE SESSION";
  elements.sessionPrivacyStatus.textContent = remembered ? "SAVED LOCALLY" : "RAM ONLY";
}

function disableRememberedJob(message) {
  state.rememberJob = false;
  state.rememberedJobSaved = false;
  setRememberJobEnabled(localStorage, false);
  renderSessionPrivacy();
  if (message) elements.sessionPrivacyMessage.textContent = message;
}

function persistSession() {
  writePrivatePreferences(localStorage, capturedPreferences(PRIVATE_PREFERENCE_IDS));
  if (!state.rememberJob) {
    setRememberJobEnabled(localStorage, false);
    state.rememberedJobSaved = false;
    renderSessionPrivacy();
    return true;
  }
  if (isMillMode()) {
    if (millSourceByteSummary(elements.input.value).exceeded
      || millSourceRecordSummary(elements.input.value, {maxRecords: PROGRAM_EDITOR_LINE_LIMIT}).exceeded) {
      disableRememberedJob("This program exceeds the bounded save limit. The job remains private and was not stored.");
      return false;
    }
  }
  const result = saveRememberedJob(localStorage, {
    preferences: capturedPreferences(),
    fileName: currentProgramFileName(),
    programIdentity: state.programIdentity,
    program: elements.input.value,
    toolAssignments: toolAssignmentsForPersistence(state.toolAssignments),
    latheControllerSettings: state.latheControllerSettings || null,
    toolAssignmentScope: state.toolAssignmentScope,
    bundledSample: isExactBundledSample(elements.input.value, state.bundledSample),
    bundledStepReference: state.bundledStepReference === true
      && isExactBundledProgram(elements.input.value, stepSampleProgram, state.bundledSample),
  });
  if (!result.saved) {
    disableRememberedJob("Browser storage is unavailable. The job remains private and was not stored.");
    return false;
  }
  state.rememberedJobSaved = true;
  renderSessionPrivacy();
  return true;
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistSession, 180);
}

function restoreSession(saved) {
  if (!saved || typeof saved !== "object") return false;
  state.latheControllerSettings = saved.latheControllerSettings || null;
  applyStoredPreferences(saved.preferences);
  if (typeof saved.program === "string" && saved.program.trim()) {
    elements.input.value = saved.program;
    state.programIdentity = restoredProgramIdentity(saved.program, saved, {
      "sample-g71-rough.nc": sampleProgram, "sample-g71-solid-match.nc": stepSampleProgram,
      "sample-g71-dxf-match.nc": dxfSampleProgram, "sample-live-bore.nc": liveBoreSampleProgram,
      "sample-3-axis-mill.nc": millSampleProgram,
    });
    renderProgramIdentity();
    state.bundledSample = isExactBundledSample(saved.program, saved.bundledSample === true);
    state.bundledStepReference = saved.bundledStepReference === true
      && isExactBundledProgram(saved.program, stepSampleProgram, state.bundledSample);
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
  return false;
}

function normalizeMachineProfile(profile) {
  const template = DEFAULT_MACHINE_PROFILES.find((item) => item.id === profile?.id)
    || DEFAULT_MACHINE_PROFILES.find((item) => item.id === "generic-lathe");
  const fallback = {...template};
  // A saved metric profile must receive metric factory values, not inch numbers.
  if (template.id === "mori-seiki-sl75" && profile?.units === "mm") {
    for (const field of ["xAxisStroke", "zAxisStroke", "rapidXMax", "rapidZMax"]) fallback[field] *= 25.4;
  }
  const needsTemplateUpgrade = Number(profile?.templateRevision || 0) < Number(fallback.templateRevision || 0);
  const upgraded = {...profile};
  if (needsTemplateUpgrade) {
    for (const [field, estimate] of Object.entries(fallback)) {
      // Upgrade only newly introduced defaults; preserve explicit unknowns and
      // user values, including revision-3 CSS choices and starting feed modes.
      const revision = Number(profile?.templateRevision || 0);
      if (template.id === "mori-seiki-sl75" && revision >= 2
        && !(field === "cssUnits" && revision < 3) && field !== "initialFeedMode") continue;
      if (["initialPlane", "initialFeedMode"].includes(field) && Object.hasOwn(upgraded, field)) continue;
      const existing = upgraded[field];
      if (existing === null || existing === undefined || existing === "" || existing === "unknown") upgraded[field] = estimate;
    }
    if (!upgraded.notes || upgraded.notes === "Control model is provisional. Confirm against the machine control panel.") upgraded.notes = fallback.notes;
    if (template.id === "mori-seiki-sl75" && upgraded.notes === SL75_REVISION_1_NOTES) upgraded.notes = fallback.notes;
    upgraded.templateRevision = fallback.templateRevision;
  }
  const normalized = {...fallback, ...upgraded};
  normalized.initialPlane = normalized.initialPlane === "G18" ? "G18" : "unknown";
  normalized.initialFeedMode = ["G98", "G99"].includes(normalized.initialFeedMode) ? normalized.initialFeedMode : "unknown";
  normalized.cssUnits = ["sfm", "m/min", "program"].includes(normalized.cssUnits) ? normalized.cssUnits : "unknown";
  normalized.displayHomeMode = normalized.displayHomeMode === "estimate" ? "estimate" : "off";
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
  return readLocalMachineProfiles(localStorage);
}

function persistMachineProfileCache() {
  return writeLocalMachineProfiles(localStorage, state.machineProfiles);
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

function currentMachineProfile() {
  return state.machineProfiles.find((profile) => profile.id === elements.machine.value) || state.machineProfiles[0];
}

function machineLengthMm(value, profile) {
  return Number(value) * (profile.units === "inch" ? 25.4 : 1);
}

function selectedProgramUnits(profile = currentMachineProfile()) {
  if (elements.programUnits.value === "inch" || elements.programUnits.value === "mm") return elements.programUnits.value;
  if (isMillMode()) return "inch";
  return profile?.units === "mm" ? "mm" : "inch";
}

function updateProgramUnitsHint(profile = currentMachineProfile()) {
  $("machineReferenceLink").hidden = profile?.id !== "mori-seiki-sl75";
  const selected = selectedProgramUnits(profile);
  const label = selected === "inch" ? "Inches" : "Millimeters";
  const source = elements.programUnits.value === "machine"
    ? `${isMillMode() ? "Bounded mill default" : "Machine default"}: ${label}.`
    : `Fallback: ${label}.`;
  elements.programUnitsHint.textContent = `${source} Used when G20/G21 is absent.`;
}

function machinePlotOptions(profile) {
  const optionalStopEnabled = elements.optionalStop.checked;
  if (!profile) return {initialPosition: null, referencePosition: null, optionalStopEnabled};
  const hasNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  const point = (x, z) => hasNumber(x) && hasNumber(z)
    ? {x: machineLengthMm(x, profile), z: machineLengthMm(z, profile)}
    : null;
  const configuredStart = plottedProgramStart(profile);
  const initialPosition = configuredStart.point
    ? point(configuredStart.point.x, configuredStart.point.z)
    : null;
  const referencePosition = configuredStart.mode === "home" ? initialPosition : null;
  return {
    initialPosition,
    referencePosition,
    initialPlane: profile.initialPlane === "G18" ? "G18" : null,
    initialFeedMode: profile.initialFeedMode || "unknown",
    cssUnits: profile.cssUnits || "unknown",
    spindleGearContract: sl75SpindleGearContract(profile),
    initialPositionMode: configuredStart.mode,
    initialPositionIssue: configuredStart.reason,
    defaultUnits: selectedProgramUnits(profile),
    warnOnAssumedUnits: true,
    rapidBehavior: profile.rapidBehavior,
    rapidXMax: hasNumber(profile.rapidXMax) ? machineLengthMm(profile.rapidXMax, profile) : null,
    rapidYMax: hasNumber(profile.rapidYMax) ? machineLengthMm(profile.rapidYMax, profile) : null,
    rapidZMax: hasNumber(profile.rapidZMax) ? machineLengthMm(profile.rapidZMax, profile) : null,
    rapidCMax: hasNumber(profile.rapidCMax) ? Number(profile.rapidCMax) : null,
    liveToolDialect: profile.liveToolDialect || "unconfigured",
    liveToolCapability: profile.liveToolCapability || "unknown",
    cAxisCapability: profile.cAxisCapability || "unknown",
    yAxisCapability: profile.yAxisCapability || "unknown",
    cAxisEngagement: profile.cAxisEngagement || "unknown",
    liveToolMaxRpm: hasNumber(profile.liveToolMaxRpm) ? Number(profile.liveToolMaxRpm) : null,
    haasDefaultToFloat: profile.haasDefaultToFloat || "unknown",
    haasIntegerFeedScale: profile.haasIntegerFeedScale || "unknown",
    g76Settings: latheControllerSettings(state.latheControllerSettings, profile.id),
    cutterCompensationContract: profile.liveToolDialect === 'haas-lathe-ngc' ? 'haas-lathe-ngc-nose-v1' : null,
    retainBlockedPathAfterUnsupportedM: true,
    optionalStopEnabled,
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
  $("sl75MachineReference").hidden = profile.id !== "mori-seiki-sl75";
  elements.machineSaveStatus.textContent = "";
  elements.machineSaveStatus.className = "";
  $("mf-initialFeedMode").disabled = profile.liveToolDialect === "haas-lathe-ngc";
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

function saveMachineEditor(event) {
  event.preventDefault();
  if (!elements.machineForm.reportValidity()) return;
  const current = currentMachineProfile();
  if (!current) return;
  const profile = readMachineEditor(current);
  const index = state.machineProfiles.findIndex((item) => item.id === profile.id);
  if (index >= 0) state.machineProfiles[index] = profile;
  const stored = persistMachineProfileCache();
  renderMachineSelect(profile.id);
  updateProgramUnitsHint(profile);
  elements.machineDialogTitle.textContent = profile.name;
  updateMachineStatusBadge(profile.status);
  if (onlyDisplayHomeChanged(current, profile)) {
    fitView();
  } else {
    clearToolAssignmentContext();
    plotProgram();
  }
  persistSession();
  elements.machineSaveStatus.className = stored ? "" : "error";
  elements.machineSaveStatus.textContent = stored
    ? "Saved on this device."
    : "Saved for this session; device storage is unavailable.";
  if (stored) setTimeout(() => { if (elements.machineDialog.open) elements.machineDialog.close(); }, 450);
}

function clearToolAssignmentContext() {
  clearToolOffsetConfirmations();
  state.toolAssignments = {};
  state.toolAssignmentScope = null;
  state.toolAssignmentDocumentIdentity = null;
  state.programEditOrigin = null;
  state.toolAssignmentRevision += 1;
  state.stockProfileCache = null;
}

function loadProgram(name, content, {bundledSample = false, machineMode = null} = {}) {
  state.programRevision += 1;
  if (machineMode === "lathe" || machineMode === "mill") {
    elements.machineMode.value = machineMode;
    applyMachineModeUi();
  }
  clearToolAssignmentContext();
  state.bundledSample = bundledSample === true;
  state.bundledStepReference = false;
  elements.input.value = content;
  elements.codeInspector.hidden = true;
  state.programIdentity = createProgramIdentity(content, {
    fileName: name, origin: bundledSample ? "sample" : name ? "file" : "editor",
  });
  renderProgramIdentity();
  clearComparison();
  elements.programSearchPanel.hidden = true;
  elements.programReplaceRow.hidden = true;
  programSearch.matches = [];
  programSearch.index = -1;
  programSearch.kind = "empty";
  elements.searchHighlights.replaceChildren();
  plotProgram();
  persistSession();
}

function loadLiveBoreSample() {
  elements.machineMode.value = "lathe";
  applyMachineModeUi();
  const machineId = "haas-ngc-live-tool-syntax";
  if ([...elements.machine.options].some((option) => option.value === machineId)) elements.machine.value = machineId;
  elements.orientation.value = "left";
  elements.xMode.value = "diameter";
  elements.programUnits.value = "machine";
  applyDisplayUnits("inch");
  $("stockPilotBore").value = "0";
  elements.stockDiameter.value = "2.05";
  elements.stockLength.value = "3.15";
  elements.stockGripLength.value = "0.50";
  elements.chuckFaceZ.value = "-3.15";
  elements.jawDiameter.value = "2.75";
  elements.clearance.value = "0.12";
  elements.stockToggle.checked = true;
  elements.toolpathToggle.checked = true;
  restoreStockSetupFromLegacyControls();
  refreshUnitUi();
  updateProgramUnitsHint(currentMachineProfile());
  loadProgram("sample-live-bore.nc", liveBoreSampleProgram, {bundledSample: true});
  state.programLine = state.parsed.sourceLines || programLineCount();
  state.visibleBlocks = state.parsed.segments.length;
  setGraphicsDimension("3d");
  updateTransport({scrollProgram: true});
  fitView();
  elements.status.textContent = "Axial live-tool bore demo · final stock shown";
  persistSession();
}

function loadMillSample() {
  state.referenceIntentRevision += 1;
  solidSetupDialog.close();
  elements.machineMode.value = "mill";
  elements.programUnits.value = "machine";
  elements.toolpathToggle.checked = true;
  refreshUnitUi();
  applyMachineModeUi();
  loadProgram("sample-3-axis-mill.nc", millSampleProgram, {bundledSample: true, machineMode: "mill"});
  state.programLine = state.parsed.sourceLines || programLineCount();
  state.visibleBlocks = state.parsed.segments.length;
  setGraphicsDimension("3d");
  updateTransport({scrollProgram: true});
  fitView();
  elements.status.textContent = "3-axis mill command-centerline demo · final path shown";
  persistSession();
}

function configureStepSampleEnvironment() {
  elements.machineMode.value = "lathe";
  applyMachineModeUi();
  elements.orientation.value = "left";
  elements.xMode.value = "diameter";
  elements.programUnits.value = "machine";
  applyDisplayUnits("inch");
  $("stockPilotBore").value = "0";
  elements.stockDiameter.value = "2.05";
  elements.stockLength.value = "3.775";
  elements.stockGripLength.value = "0.50";
  elements.chuckFaceZ.value = "-3.15";
  elements.jawDiameter.value = "2.75";
  elements.clearance.value = "0.12";
  elements.stockToggle.checked = true;
  elements.toolpathToggle.checked = true;
  restoreStockSetupFromLegacyControls();
  refreshUnitUi();
  updateProgramUnitsHint(currentMachineProfile());
}

function showStepSampleFinalFrame() {
  state.programLine = state.parsed.sourceLines || programLineCount();
  state.visibleBlocks = state.parsed.segments.length;
  updateTransport({scrollProgram: true});
  fitView();
  draw();
}

async function loadStepSample({reuseProgram = false} = {}) {
  const intentRevision = ++state.referenceIntentRevision;
  const programRevision = ++state.programRevision;
  let installedProgramRevision = null;
  elements.status.textContent = "Loading the matching stepped-shaft solid locally…";
  try {
    const response = await fetch(new URL("./samples/sample-g71-finished-part.step", import.meta.url));
    if (!response.ok) throw new Error("The bundled stepped-shaft solid could not be opened.");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_STEP_BYTES) throw new Error("The bundled stepped-shaft solid exceeds the STEP import limit.");
    const originalBytes = new Uint8Array(buffer);
    const sha256 = await sha256Hex(buffer);
    if (originalBytes.byteLength !== STEP_SAMPLE_BYTE_LENGTH || sha256 !== STEP_SAMPLE_SHA256) {
      originalBytes.fill(0);
      throw new Error("The bundled stepped-shaft solid failed its pinned size and SHA-256 check.");
    }
    if (state.referenceIntentRevision !== intentRevision || state.programRevision !== programRevision) {
      originalBytes.fill(0);
      return;
    }
    if (reuseProgram) {
      if (!isExactBundledProgram(elements.input.value, stepSampleProgram, state.bundledSample)
        || isMillMode() || elements.xMode.value !== "diameter") {
        originalBytes.fill(0);
        state.bundledStepReference = false;
        persistSession();
        return;
      }
      plotProgram();
    } else {
      configureStepSampleEnvironment();
      loadProgram("sample-g71-solid-match.nc", stepSampleProgram, {bundledSample: true, machineMode: "lathe"});
    }
    installedProgramRevision = state.programRevision;
    if (state.referenceIntentRevision !== intentRevision || state.programRevision !== installedProgramRevision) {
      originalBytes.fill(0);
      return;
    }
    // Persist only the authority to re-fetch this exact application-owned demo.
    // Doing so before the slower local kernel work makes a service-worker reload
    // restart the import instead of silently returning the reference panel to NONE.
    state.bundledStepReference = true;
    persistSession();
    const accepted = await acceptStepSource({
      name: STEP_SAMPLE_NAME,
      byteLength: originalBytes.byteLength,
      sha256,
      originalBytes,
    }, intentRevision, {
      openPlacement: false,
      preserveBundledStepReference: true,
      expectedProgramRevision: installedProgramRevision,
    });
    if (!accepted || state.referenceIntentRevision !== intentRevision
      || state.programRevision !== installedProgramRevision) {
      if (state.referenceIntentRevision === intentRevision
        && state.programRevision !== installedProgramRevision
        && state.referenceGeometry?.source?.name === STEP_SAMPLE_NAME) {
        beginReferenceReplacement(intentRevision);
        renderReferenceGeometryUi();
        draw();
      }
      if (state.referenceIntentRevision === intentRevision && state.programRevision === installedProgramRevision) {
        state.bundledStepReference = false;
        persistSession();
      }
      return;
    }
    const reference = state.referenceGeometry;
    const applied = await applyBundledStepSampleReference(reference, {
      expectedIntentRevision: intentRevision,
      expectedProgramRevision: installedProgramRevision,
    });
    if (!applied) return;
    if (state.referenceIntentRevision !== intentRevision || state.programRevision !== installedProgramRevision
      || state.referenceGeometry !== reference || !reference.ready) return;
    showStepSampleFinalFrame();
    elements.status.textContent = "G71 + STEP demo ready · final stock and exact reference shown";
    persistSession();
  } catch (error) {
    if (state.referenceIntentRevision === intentRevision
      && (state.programRevision === programRevision || state.programRevision === installedProgramRevision)) {
      state.bundledStepReference = false;
      elements.status.textContent = error instanceof Error ? error.message : "Could not load the bundled stepped-shaft solid.";
      persistSession();
    }
  }
}

async function loadDxfSample() {
  const intentRevision = ++state.referenceIntentRevision;
  const programRevision = ++state.programRevision;
  let installedProgramRevision = null;
  let originalBytes = null;
  elements.status.textContent = "Loading the pinned inch DXF closed-profile demo locally…";
  try {
    const response = await fetch(new URL("./samples/sample-g71-finished-part.dxf", import.meta.url));
    if (!response.ok) throw new Error("The bundled closed-profile DXF could not be opened.");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_DXF_BYTES) throw new Error("The bundled closed-profile DXF exceeds the DXF import limit.");
    originalBytes = new Uint8Array(buffer);
    const sha256 = await sha256Hex(buffer);
    if (originalBytes.byteLength !== DXF_SAMPLE_BYTE_LENGTH || sha256 !== DXF_SAMPLE_SHA256) {
      originalBytes.fill(0);
      originalBytes = null;
      throw new Error("The bundled closed-profile DXF failed its pinned size and SHA-256 check.");
    }
    if (state.referenceIntentRevision !== intentRevision || state.programRevision !== programRevision) {
      originalBytes.fill(0);
      return;
    }
    configureStepSampleEnvironment();
    elements.referenceGeometryTolerance.value = "0.0005";
    loadProgram("sample-g71-dxf-match.nc", dxfSampleProgram, {bundledSample: true, machineMode: "lathe"});
    installedProgramRevision = state.programRevision;
    if (state.referenceIntentRevision !== intentRevision || state.programRevision !== installedProgramRevision) {
      originalBytes.fill(0);
      return;
    }
    const decoded = decodeDxfBytes(originalBytes);
    const accepted = acceptDxfSource({
      name: DXF_SAMPLE_NAME,
      content: decoded.content,
      byteLength: originalBytes.byteLength,
      sha256,
      encoding: decoded.encoding,
      originalBytes,
    }, intentRevision);
    if (!accepted || state.referenceIntentRevision !== intentRevision
      || state.programRevision !== installedProgramRevision) return;
    const reference = state.referenceGeometry;
    const candidates = dxfMaterialCandidates(reference);
    const eligible = candidates.filter((candidate) => candidate?.eligible === true);
    if (candidates.length !== 1 || eligible.length !== 1) {
      throw new Error("The bundled DXF did not reproduce its one pinned eligible closed contour.");
    }
    elements.referenceDxfMaterialContour.value = String(eligible[0].contourId);
    elements.referenceDxfMaterialInside.disabled = false;
    elements.referenceDxfMaterialInside.checked = true;
    reference.bundledMaterialAuthority = {
      kind: "application-pinned-dxf-inside",
      sourceHash: DXF_SAMPLE_SHA256,
    };
    refreshReferenceGeometry({fit: true});
    if (reference.mapped?.materialRegion?.qualified !== true) {
      throw new Error(dxfMaterialReason(
        reference.mapped?.materialRegion?.unqualifiedReason,
        "The bundled DXF interior did not reproduce its pinned nominal-material qualification.",
      ));
    }
    if (state.referenceIntentRevision !== intentRevision || state.programRevision !== installedProgramRevision
      || state.referenceGeometry !== reference) return;
    showStepSampleFinalFrame();
    elements.status.textContent = "G71 + DXF demo ready · pinned inch contour interior enabled as nominal material";
    persistSession();
  } catch (error) {
    const activeSample = state.referenceGeometry?.kind === "dxf"
      && state.referenceGeometry?.source?.name === DXF_SAMPLE_NAME;
    if (state.referenceIntentRevision === intentRevision && activeSample) {
      beginReferenceReplacement(intentRevision);
      renderReferenceGeometryUi();
      draw();
    } else if (originalBytes instanceof Uint8Array
      && state.referenceGeometry?.source?.originalBytes !== originalBytes) {
      originalBytes.fill(0);
    }
    if (state.referenceIntentRevision === intentRevision
      && (state.programRevision === programRevision || state.programRevision === installedProgramRevision)) {
      elements.status.textContent = error instanceof Error ? error.message : "Could not load the bundled closed-profile DXF.";
    }
  }
}

async function loadBrowserFile(file) {
  if (!file) return;
  const programRevision = ++state.programRevision;
  if (isMillMode() && Number.isFinite(Number(file.size)) && Number(file.size) > MILL_PARSE_LIMITS.maxSourceBytes) {
    elements.status.textContent = `Mill G-code import stopped before reading: file exceeds the bounded ${MILL_PARSE_LIMITS.maxSourceBytes.toLocaleString("en-US")}-byte limit.`;
    return;
  }
  const content = await file.text();
  if (state.programRevision !== programRevision) return;
  loadProgram(file.name, content);
}

async function openProgram() {
  if (window.pywebview?.api?.open_gcode) {
    const programRevision = ++state.programRevision;
    const selected = await window.pywebview.api.open_gcode();
    if (state.programRevision !== programRevision) return;
    if (selected?.error) { elements.status.textContent = selected.error; return; }
    if (selected?.content) loadProgram(selected.name, selected.content);
    return;
  }
  state.programRevision += 1;
  elements.fileInput.click();
}

function bytesAsHex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Secure SHA-256 hashing is unavailable, so the reference geometry was not imported.");
  }
  return bytesAsHex(await globalThis.crypto.subtle.digest("SHA-256", bytes));
}

function decodeDxfBytes(bytes) {
  try {
    return {content: new TextDecoder("utf-8", {fatal: true}).decode(bytes), encoding: "utf-8"};
  } catch {
    return {content: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252"};
  }
}

function bytesFromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function setReferenceResult(element, text, tone = null) {
  element.textContent = text;
  element.className = tone || "";
}

function setDxfMaterialStatus(text, tone = null) {
  elements.referenceDxfMaterialStatus.textContent = text;
  elements.referenceDxfMaterialStatus.className = `dxf-material-status${tone ? ` ${tone}` : ""}`;
}

function resetDxfMaterialControls(message = "Import and map a DXF to find eligible closed contours.") {
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Map DXF to find closed contours";
  elements.referenceDxfMaterialContour.replaceChildren(placeholder);
  elements.referenceDxfMaterialContour.value = "";
  elements.referenceDxfMaterialContour.disabled = true;
  elements.referenceDxfMaterialInside.checked = false;
  elements.referenceDxfMaterialInside.disabled = true;
  setReferenceResult(elements.referenceDxfMaterialState, "OFF");
  setDxfMaterialStatus(message);
}

function dxfMaterialCandidates(reference = state.referenceGeometry) {
  return reference?.kind === "dxf" && Array.isArray(reference.mapped?.materialContours)
    ? reference.mapped.materialContours
    : [];
}

function dxfMaterialReason(reason, fallback = "") {
  if (typeof reason === "string") return reason;
  if (reason && typeof reason.message === "string") return reason.message;
  return fallback;
}

function selectedDxfMaterialCandidate(reference = state.referenceGeometry) {
  const selectedId = elements.referenceDxfMaterialContour.value;
  return dxfMaterialCandidates(reference).find((candidate) => String(candidate.contourId) === selectedId) || null;
}

function dxfMaterialCandidateLabel(candidate, index) {
  const primitiveCount = Number(candidate?.primitiveCount) || candidate?.primitiveIds?.length || 0;
  const bounds = candidate?.bounds;
  const size = Number.isFinite(bounds?.zSpan) && Number.isFinite(bounds?.xSpan)
    ? ` · Z ${formatReferenceDistance(bounds.zSpan)} × R ${formatReferenceDistance(bounds.xSpan)}`
    : "";
  return `Contour ${index + 1} · ${primitiveCount} analytic curve${primitiveCount === 1 ? "" : "s"}${size}`
    + `${candidate?.eligible === true ? "" : " · blocked"}`;
}

function syncDxfMaterialControls(reference = state.referenceGeometry) {
  if (reference?.kind !== "dxf") {
    resetDxfMaterialControls();
    return;
  }
  const selectedId = elements.referenceDxfMaterialContour.value;
  const wasConfirmed = elements.referenceDxfMaterialInside.checked;
  const receivedCandidates = dxfMaterialCandidates(reference);
  const materialTopology = reference.mapped?.materialTopology;
  const candidateLimitExceeded = materialTopology?.contourLimitExceeded === true
    || receivedCandidates.length > MAX_DXF_MATERIAL_CONTOURS;
  const reportedContourCount = Number.isSafeInteger(materialTopology?.closedContours)
    ? materialTopology.closedContours
    : receivedCandidates.length;
  const candidates = candidateLimitExceeded ? [] : receivedCandidates;
  const eligible = candidates.filter((candidate) => candidate?.eligible === true);
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = candidateLimitExceeded
    ? `Too many closed contours (${MAX_DXF_MATERIAL_CONTOURS} max)`
    : reference.mapped?.authorized !== true
    ? "Finish DXF mapping first"
    : (eligible.length ? "Select explicitly" : "No eligible simple closed contour");
  const options = [placeholder];
  candidates.forEach((candidate, index) => {
    const option = document.createElement("option");
    option.value = String(candidate.contourId);
    option.textContent = dxfMaterialCandidateLabel(candidate, index);
    option.disabled = candidate.eligible !== true;
    const reason = dxfMaterialReason(candidate.unqualifiedReason);
    if (reason) option.title = reason.slice(0, 240);
    options.push(option);
  });
  elements.referenceDxfMaterialContour.replaceChildren(...options);
  const retained = candidates.find((candidate) => (
    candidate?.eligible === true && String(candidate.contourId) === selectedId
  ));
  elements.referenceDxfMaterialContour.value = retained ? selectedId : "";
  elements.referenceDxfMaterialContour.disabled = reference.mapped?.authorized !== true || eligible.length === 0;
  elements.referenceDxfMaterialInside.checked = Boolean(retained && wasConfirmed);
  elements.referenceDxfMaterialInside.disabled = !retained;

  const selected = retained || null;
  const materialRegion = reference.mapped?.materialRegion;
  if (candidateLimitExceeded) {
    setReferenceResult(elements.referenceDxfMaterialState, "NOT AVAILABLE", "blocked");
    setDxfMaterialStatus(
      `DXF contains ${reportedContourCount.toLocaleString()} closed contours; the signed-material selector supports at most ${MAX_DXF_MATERIAL_CONTOURS.toLocaleString()}. No partial list is shown.`,
      "blocked",
    );
  } else if (reference.mapped?.authorized !== true) {
    setReferenceResult(elements.referenceDxfMaterialState, "WAITING", "review");
    setDxfMaterialStatus("Finish units and mapping before choosing nominal material.", "review");
  } else if (!eligible.length) {
    setReferenceResult(elements.referenceDxfMaterialState, "NOT AVAILABLE", "blocked");
    setDxfMaterialStatus("No simple closed contour is eligible. Signed DXF material entry stays off; review the diagnostics.", "blocked");
  } else if (!selected) {
    setReferenceResult(elements.referenceDxfMaterialState, "SELECT CONTOUR", "review");
    setDxfMaterialStatus(`${eligible.length} eligible closed contour${eligible.length === 1 ? "" : "s"}. Select one explicitly; no material side is assumed.`, "review");
  } else if (!elements.referenceDxfMaterialInside.checked) {
    setReferenceResult(elements.referenceDxfMaterialState, "CONFIRM INSIDE", "review");
    setDxfMaterialStatus("The cyan contour is selected for review. Confirm that its inside is nominal material to enable signed entry.", "review");
  } else if (materialRegion?.qualified === true) {
    setReferenceResult(elements.referenceDxfMaterialState, "ENABLED", "ready");
    setDxfMaterialStatus("Enabled · the violet contour bounds the explicitly confirmed nominal material interior.", "ready");
  } else {
    setReferenceResult(elements.referenceDxfMaterialState, "BLOCKED", "blocked");
    setDxfMaterialStatus(dxfMaterialReason(
      materialRegion?.unqualifiedReason,
      "The selected contour could not qualify one unambiguous nominal-material interior.",
    ), "blocked");
  }
}

function dxfMaterialSelectionFromControls() {
  if (state.referenceGeometry?.kind !== "dxf" || !elements.referenceDxfMaterialInside.checked) return null;
  const candidate = selectedDxfMaterialCandidate();
  return candidate?.eligible === true
    ? {contourId: candidate.contourId, materialSide: "inside"}
    : null;
}

function revokeBundledDxfMaterialAuthority({remap = true} = {}) {
  const reference = state.referenceGeometry;
  if (reference?.kind !== "dxf" || !reference.bundledMaterialAuthority) return false;
  reference.bundledMaterialAuthority = null;
  elements.referenceDxfMaterialInside.checked = false;
  if (remap && reference.mapped) refreshReferenceGeometry();
  else syncDxfMaterialControls(reference);
  return true;
}

function worstProfilePenetrationResult(materialEntry = state.referenceComparison?.materialEntry) {
  let worst = null;
  for (const result of materialEntry?.segmentResults || []) {
    if (result.classification !== "penetration" || !result.penetration) continue;
    if (!worst || result.penetration.lowerBoundMm > worst.penetration.lowerBoundMm) worst = result;
  }
  return worst;
}

function formatReferenceBound(bounds) {
  if (!bounds) return "—";
  return bounds.upperBoundMm - bounds.lowerBoundMm <= 1e-10
    ? formatReferenceDistance(bounds.upperBoundMm)
    : `${formatReferenceDistance(bounds.lowerBoundMm)}–${formatReferenceDistance(bounds.upperBoundMm)}`;
}

function formatMaterialDiagnostic(diagnostic) {
  const {sourceLine, executionLine, message} = diagnostic;
  const location = sourceLine
    ? `Source line ${sourceLine}${executionLine && executionLine !== sourceLine ? ` (executed at line ${executionLine})` : ""}`
    : "Whole-program check";
  return `${location}: ${message}`;
}

function renderProfilePenetrationUi({ready = false, comparison = null} = {}) {
  const materialEntry = comparison?.materialEntry;
  const calculationIncomplete = comparison?.materialEntryCalculationIncomplete;
  const cutterAware = materialEntry?.cutterAware === true;
  const scopeText = cutterAware
    ? `Nominal active cutting-edge sweep${materialEntry.cutterCoverageComplete ? '' : ' with point-only or unresolved portions'}. Not a full insert/holder collision or finished-part guarantee.`
    : 'Program reference-point path only; no confirmed finite cutting edge is available for these moves.';
  const aggregate = materialEntry?.aggregate;
  const classification = comparison?.pending
    ? "pending"
    : (calculationIncomplete && aggregate?.classification !== "penetration"
      ? "calculation-incomplete"
      : (comparison?.materialEntryError ? "unresolved" : aggregate?.classification));
  const labels = {
    penetration: ["PATH ENTERS MATERIAL", "blocked"],
    "within-tolerance-entry": ["ENTRY ≤ REPORTING THRESHOLD", "review"],
    clear: ["NO ENTRY ABOVE THRESHOLD", "ready"],
    "tolerance-boundary": ["ENTRY NEAR THRESHOLD · REVIEW", "review"],
    "calculation-incomplete": ["CALCULATION INCOMPLETE", "review"],
    unresolved: ["UNRESOLVED", "blocked"],
    "not-qualified": ["MATERIAL SIDE NOT QUALIFIED", "review"],
    "no-comparable-segments": ["NO CUTTING PATH", "blocked"],
    pending: ["PLOT REQUIRED", "review"],
  };
  const [status, tone] = ready && labels[classification]
    ? labels[classification]
    : ["—", null];
  setReferenceResult(elements.referenceGeometryPenetrationStatus, status, tone);
  const showPenetrationDepth = ["penetration", "within-tolerance-entry", "tolerance-boundary"].includes(classification);
  setReferenceResult(
    elements.referenceGeometryPenetrationDepth,
    ready && showPenetrationDepth && aggregate?.maximumPenetration
      ? formatReferenceBound(aggregate.maximumPenetration)
      : "—",
    classification === "penetration" ? "blocked" : (classification === "within-tolerance-entry" ? "review" : null),
  );

  const worst = worstProfilePenetrationResult(materialEntry);
  const cutterWitness = worst?.cuttingBasis === 'nominal-cutting-edge';
  const showRisk = ready && classification === "penetration";
  const showReview = ready && ["within-tolerance-entry", "tolerance-boundary", "calculation-incomplete", "unresolved"].includes(classification);
  elements.referenceGeometrySetup.classList.toggle("penetration", showRisk);
  elements.profilePenetrationAlert.hidden = !(showRisk || showReview);
  elements.profilePenetrationAlert.classList.toggle("review", !showRisk);
  const diagnostics = showReview ? materialEntryDiagnostics(comparison) : [];
  const review = diagnostics[0];
  const jumpAvailable = Boolean(worst || review?.sourceLine);
  elements.profilePenetrationJump.hidden = !jumpAvailable;
  elements.profilePenetrationJump.disabled = !jumpAvailable;
  if (showRisk) {
    const sourceLine = Number(worst?.sourceLine);
    const executionLine = Number(worst?.executionLine);
    const lineText = Number.isInteger(sourceLine) && sourceLine > 0
      ? ` Source line ${sourceLine}${Number.isInteger(executionLine) && executionLine > 0 && executionLine !== sourceLine ? `, executed at line ${executionLine}` : ""}.`
      : "";
    const completenessText = aggregate.complete ? "" : " Other path portions remain unresolved.";
    elements.profilePenetrationAlertTitle.textContent = cutterWitness ? "CUTTING EDGE ENTERS NOMINAL PART" : "PATH ENTERS NOMINAL MATERIAL";
    elements.profilePenetrationAlertMessage.textContent = `${comparison.materialSelectionLabel || "Program path"}: proven penetration ${formatReferenceBound(aggregate.maximumPenetration)}.${lineText}${completenessText} ${scopeText}`;
    elements.referenceGeometrySummary.textContent = cutterWitness ? "CUTTER ENTERS PART" : "PATH ENTERS MATERIAL";
  } else if (showReview) {
    const title = classification === "calculation-incomplete"
      ? "REFERENCE CHECK CALCULATION INCOMPLETE"
      : classification === "within-tolerance-entry"
      ? "NOMINAL PROFILE ENTRY WITHIN REPORTING THRESHOLD"
      : classification === "tolerance-boundary"
        ? "NOMINAL MATERIAL ENTRY NEAR THRESHOLD"
        : "NOMINAL MATERIAL CHECK INCOMPLETE";
    elements.profilePenetrationAlertTitle.textContent = title;
    elements.profilePenetrationAlertMessage.textContent = classification === "calculation-incomplete"
      ? calculationIncomplete
      : classification === "within-tolerance-entry"
      ? `${comparison.materialSelectionLabel || "Program path"}: bounded penetration ${formatReferenceBound(aggregate.maximumPenetration)}. ${scopeText}`
      : (review ? formatMaterialDiagnostic(review)
        + (diagnostics.length > 1 ? ` ${diagnostics.length - 1} additional issue(s) listed under Reference geometry.` : "")
        : "Material-entry verification is incomplete; no detailed reason was returned.");
    elements.referenceGeometrySummary.textContent = classification === "calculation-incomplete"
      ? "CALCULATION INCOMPLETE"
      : (classification === "within-tolerance-entry" ? "ENTRY ≤ THRESHOLD" : "ENTRY UNRESOLVED");
  }
  renderProgramRiskHighlights();
}

function detectedReferenceUnits(model) {
  if (model?.units?.status !== "declared") return "";
  if (model.units.name === "inch") return "inch";
  if (model.units.name === "millimeter") return "mm";
  return "";
}

function referenceHasNonUnitParseError(model) {
  const resolvableUnitCodes = new Set(["units-invalid", "units-missing", "units-unitless", "units-unsupported"]);
  return (model?.diagnostics || []).some((diagnostic) => (
    diagnostic.severity === "error" && !resolvableUnitCodes.has(diagnostic.code)
  ));
}

function referenceInspectorEntities(mapped, sourceName) {
  const entities = [];
  for (const primitive of mapped?.primitives || []) {
    const isStep = mapped.format === "step-section" || mapped.sourceModel?.format === "step-section";
    const component = `${isStep ? "STEP section" : "DXF reference"} · ${sourceName}`;
    const layer = primitive.layer || "0";
    const label = isStep
      ? `${String(primitive.source?.curveType || primitive.type).replace(/^GeomAbs_/, "").toUpperCase()} · analytic B-rep edge`
      : `${String(primitive.source?.dxfType || primitive.type).toUpperCase()} · layer ${layer}`;
    const metadata = {
      exact: false,
      analytic: true,
      referenceGeometry: true,
      referenceFormat: isStep ? "step" : "dxf",
      geometryUncertaintyMm: Number(primitive.geometryUncertaintyMm) || 0,
      dxfEntityId: primitive.source?.entityId || primitive.id,
      dxfType: primitive.source?.dxfType || primitive.type,
      stepEdgeId: primitive.source?.edgeId || null,
      layer,
      handle: primitive.source?.handle || null,
    };
    if (primitive.type === "line") {
      entities.push(lineGeometry({
        id: `reference-${primitive.id}`, component, label, start: primitive.start, end: primitive.end, metadata,
      }));
    } else if (primitive.type === "arc") {
      entities.push(arcGeometry({
        id: `reference-${primitive.id}`, component, label, center: primitive.center, radius: primitive.radius,
        startAngle: primitive.startAngle, sweep: primitive.sweep, metadata,
      }));
    } else if (primitive.type === "circle") {
      for (const [suffix, startAngle] of [["a", 0], ["b", Math.PI]]) {
        entities.push(arcGeometry({
          id: `reference-${primitive.id}-${suffix}`, component, label, center: primitive.center,
          radius: primitive.radius, startAngle, sweep: Math.PI, metadata: {...metadata, fullCircle: true},
        }));
      }
    }
  }
  return entities;
}

function referenceComparisonSegments(segments = state.parsed.segments) {
  // Nearest-profile comparison remains commanded contour vs drawing. The
  // separate material-entry pass consumes the resolved physical nose sweep.
  segments = segments.map(segment => segment.compensationResolved && segment.programmedGeometry
    ? {...segment, ...segment.programmedGeometry} : segment);
  const finish = segments.filter((segment) => segment.type === "finish");
  if (finish.length) return {segments: finish, label: "G70 finish path"};
  const cycleProfile = segments.filter((segment) => segment.type === "cycle-profile");
  if (cycleProfile.length) return {segments: cycleProfile, label: "turning-cycle profile path"};
  const cutting = segments.filter((segment) => (
    !isRapidMotion(segment)
    && !isLiveToolSegment(segment)
    && segment.start && segment.end
  ));
  return {segments: cutting, label: "planar cutting path"};
}

function referenceMaterialEntrySegments(segments = state.parsed.segments) {
  const cutting = segments
    .map((segment, globalBlockIndex) => ({...segment, globalBlockIndex}))
    .filter((segment) => (
      !isRapidMotion(segment)
      && !isLiveToolSegment(segment)
      && segment.start && segment.end
    ));
  return {segments: cutting, label: "all executed planar cutting paths"};
}

function formatReferenceDistance(mm) {
  const places = elements.displayUnits.value === "inch" ? 5 : 4;
  return `${displayValue(mm).toFixed(places)} ${unitName()}`;
}

function referenceToleranceMm() {
  const text = elements.referenceGeometryTolerance.value.trim();
  if (!text) return NaN;
  return Number(text) * unitScale();
}

function referenceCutterForSegment(segment) {
  const model = resolvedCuttingModel(segment.toolKey);
  // Preserve the existing point-path check if the setup is absent; never call
  // that point a finite tool or grant cutting authority through a warning.
  if (!model || model.mode === 'unsupported') return null;
  const issue = turningSpindleIssue(configuredToolAssembly2d(segment.toolKey),
    {direction: segment.spindleDirection, running: segment.spindleRunning});
  if (issue) return {blocked: true, reason: issue.message};
  if (segment.cutterEnvelope?.kind === 'nose-circle') {
    const edges = nominalNoseCircle(segment.cutterEnvelope.radiusMm);
    return edges ? {edges} : {blocked: true, reason: 'The compensated nose radius is unresolved.'};
  }
  const boundary = state.referenceGeometry?.mapped?.materialRegion?.boundary || [];
  const radialReach = boundary.reduce((maximum, edge) => Math.max(maximum,
    Math.abs(edge.start?.x || 0), Math.abs(edge.end?.x || 0),
    Math.abs(edge.center?.x || 0) + (edge.radius || 0)), 0);
  const pathReach = Math.max(Math.abs(segment.start.x * xScale()), Math.abs(segment.end.x * xScale()),
    Math.abs(segment.center?.x || 0) + (segment.radius || 0));
  const edges = nominalCutterEdges(model, {threadFlankHeightMm: radialReach + pathReach + 1});
  return edges ? {edges} : null;
}

function updateReferenceComparison() {
  state.showReferenceWitness = false;
  state.referenceComparison = null;
  if (isMillMode()) return;
  const reference = state.referenceGeometry;
  if (!reference?.ready || !reference.mapped?.primitives?.length) return;
  if (state.programDirty) {
    state.referenceComparison = {pending: true, pendingLabel: 'PLOT REQUIRED',
      pendingMessage: 'The program or controller settings changed; plot again before using any reference result.'};
    return;
  }
  const toleranceMm = referenceToleranceMm();
  if (!Number.isFinite(toleranceMm) || toleranceMm <= 0) {
    state.referenceComparison = {error: "Comparison threshold must be a positive finite value."};
    return;
  }
  const selected = referenceComparisonSegments();
  const parserVerificationBlockers = (state.parsed.warnings || []).filter(blocksCuttingProfileVerification);
  if (!selected.segments.length) {
    state.referenceComparison = {selectionLabel: selected.label, error: "No planar cutting path is available to compare."};
    return;
  }
  try {
    const result = compareProgramProfileToNominal(selected.segments, reference.mapped, {
      programXScale: xScale(),
      toleranceMm,
      numericalBudgetMm: Math.min(DEFAULT_PROFILE_NUMERICAL_BUDGET_MM, toleranceMm / 10),
      programVerificationBlocked: parserVerificationBlockers.length > 0,
      maximumComparisonOperations: MAX_REFERENCE_UI_COMPARISON_OPERATIONS,
    });
    const materialSelection = referenceMaterialEntrySegments();
    let materialEntry = null;
    let materialEntryError = null;
    let materialEntryCalculationIncomplete = null;
    try {
      materialEntry = compareProgramProfileMaterialEntry(materialSelection.segments, reference.mapped, {
        programXScale: xScale(),
        toleranceMm,
        numericalBudgetMm: Math.min(DEFAULT_PROFILE_NUMERICAL_BUDGET_MM, toleranceMm / 10),
        programVerificationBlocked: parserVerificationBlockers.length > 0,
        maximumComparisonOperations: MAX_REFERENCE_UI_COMPARISON_OPERATIONS,
        cutterResolver: referenceCutterForSegment,
      });
      if (materialEntry.calculationIncomplete) {
        materialEntryCalculationIncomplete = "G-Code Studio reached its local material-comparison workload limit. No G-code or coordinate error was identified; the material calculation is incomplete.";
      }
    } catch (error) {
      if (isProfileComparisonWorkloadError(error)) {
        materialEntryCalculationIncomplete = "G-Code Studio reached its local material-comparison workload limit. No G-code or coordinate error was identified; the material calculation is incomplete.";
      } else {
        materialEntryError = error instanceof Error ? error.message : String(error);
      }
    }
    state.referenceComparison = {
      selectionLabel: selected.label,
      result,
      worstWitness: worstReferenceWitness(result.segmentResults),
      materialSelectionLabel: materialSelection.label,
      materialEntry,
      materialEntryError,
      materialEntryCalculationIncomplete,
      parserVerificationBlockerCount: parserVerificationBlockers.length,
      parserVerificationBlockers,
    };
  } catch (error) {
    if (isProfileComparisonWorkloadError(error)) {
      state.referenceComparison = {
        selectionLabel: selected.label,
        calculationIncomplete: "G-Code Studio reached its local deviation-comparison workload limit. No G-code or coordinate error was identified; the reference calculation is incomplete.",
      };
    } else {
      state.referenceComparison = {selectionLabel: selected.label, error: error instanceof Error ? error.message : String(error)};
    }
  }
}

function renderReferenceDiagnostics() {
  const reference = state.referenceGeometry;
  const entries = [];
  if (!reference) {
    entries.push({severity: "info", message: "DXF overlays stay analytic; STEP solids are sectioned locally into analytic B-rep curves."});
  } else {
    entries.push({
      severity: "info",
      message: `${reference.source.byteLength.toLocaleString()} bytes · SHA-256 ${reference.source.sha256.slice(0, 12)}… · held in memory on this device.`,
    });
    if (reference.kind === "dxf" && reference.model.units?.status === "declared") {
      entries.push({severity: "info", message: `DXF $INSUNITS declares ${reference.model.units.name}.`});
    }
    if (reference.kind === "step" && reference.model?.kernel) {
      const kernel = reference.model.kernel;
      entries.push({severity: "info", message: `${kernel.name || "Open CASCADE"} ${kernel.version || ""} · analytic B-rep import and section.`.trim()});
      const sourceUnits = reference.model.sourceUnits;
      const declaredUnitNames = Array.isArray(sourceUnits?.declarations)
        ? [...new Set(sourceUnits.declarations.map((declaration) => declaration?.name).filter(Boolean))]
        : [];
      const unitNames = declaredUnitNames.length
        ? declaredUnitNames.join(", ")
        : sourceUnits?.name || reference.model.units?.source?.name || reference.model.units?.source || null;
      if (unitNames) entries.push({severity: "info", message: `STEP length unit${String(unitNames).includes(",") ? "s" : ""}: ${unitNames}; geometry is normalized internally and setup readouts use ${elements.displayUnits.value === "inch" ? "inches" : "millimeters"}.`});
      if (reference.model.topology) {
        const topology = reference.model.topology;
        entries.push({severity: "info", message: `Imported topology: ${topology.solidCount ?? topology.solids ?? "?"} solid · ${topology.faceCount ?? topology.faces ?? "?"} faces · ${topology.edgeCount ?? topology.edges ?? "?"} edges.`});
      }
      const maxTolerance = Number(
        reference.model.tolerances?.maxToleranceMm
        ?? reference.model.tolerances?.maximumMm
        ?? reference.model.topology?.maxToleranceMm
        ?? reference.model.import?.maxToleranceMm
        ?? reference.model.maxToleranceMm,
      );
      if (Number.isFinite(maxTolerance)) entries.push({severity: "info", message: `Maximum imported B-rep tolerance: ${displayValue(maxTolerance).toExponential(3)} ${unitName()}.`});
    }
    const diagnosticSources = [reference.model?.diagnostics, reference.setupDiagnostics, reference.sectionDto?.diagnostics, reference.mapped?.diagnostics];
    const seenDiagnostics = new Set();
    for (const diagnostic of diagnosticSources.flatMap((source) => source || [])) {
      if (diagnostic.resolved) continue;
      const key = `${diagnostic.code || ""}\0${diagnostic.message || ""}`;
      if (seenDiagnostics.has(key)) continue;
      seenDiagnostics.add(key);
      entries.push(diagnostic);
    }
    if (reference.pending) entries.push({severity: "warning", message: reference.pendingMessage || "The local STEP geometry kernel is working…"});
    if (reference.displayWorkload?.diagnostic) entries.push(reference.displayWorkload.diagnostic);
    if (reference.ready) {
      if (reference.kind === "dxf") {
        entries.push({
          severity: "info",
          message: `DXF X → program ${Number(elements.referenceGeometryZDirection.value) === 1 ? "+Z" : "−Z"}; DXF Y → physical ${Number(elements.referenceGeometryXDirection.value) === 1 ? "+X" : "−X"} radius.`,
        });
      } else {
        entries.push({
          severity: "info",
          message: `STEP ${elements.stepAxialAxis.value.toUpperCase()} → program ${Number(elements.stepAxialDirection.value) === 1 ? "+Z" : "−Z"}; ${elements.stepRadialAxis.value.toUpperCase()} → physical ${Number(elements.stepRadialDirection.value) === 1 ? "+X" : "−X"} radius; ${elements.stepNormalAxis.value.toUpperCase()} section at ${formatReferenceDistance(stepMappingFromControls().planeOffsetMm)}.`,
        });
      }
      const toleranceMm = referenceToleranceMm();
      if (Number.isFinite(toleranceMm) && toleranceMm > 0) {
        let geometryUncertaintyMm = Number(reference.mapped?.geometryUncertaintyMm) || 0;
        for (const primitive of reference.mapped?.primitives || []) {
          geometryUncertaintyMm = Math.max(geometryUncertaintyMm, Number(primitive.geometryUncertaintyMm) || 0);
        }
        const tenTimesTighter = geometryUncertaintyMm <= toleranceMm / 10;
        entries.push({
          severity: "info",
          message: tenTimesTighter
            ? `Directed path threshold: ${formatReferenceDistance(toleranceMm)}; retained geometry uncertainty is at least 10× tighter.`
            : `Directed path threshold: ${formatReferenceDistance(toleranceMm)}; retained geometry uncertainty ${displayValue(geometryUncertaintyMm).toExponential(3)} ${unitName()} is included, so a boundary result remains unresolved.`,
        });
      }
      if (state.referenceComparison?.selectionLabel) {
        entries.push({severity: "info", message: `Deviation source: ${state.referenceComparison.selectionLabel}; rapids and live-tool motion are excluded.`});
      }
      const materialEntry = state.referenceComparison?.materialEntry;
      if (state.referenceComparison?.materialEntryError) {
        entries.push({severity: "error", message: state.referenceComparison.materialEntryError});
      } else if (state.referenceComparison?.materialEntryCalculationIncomplete) {
        entries.push({severity: "warning", message: state.referenceComparison.materialEntryCalculationIncomplete});
      } else if (materialEntry?.aggregate?.classification === "not-qualified") {
        entries.push({severity: "warning", message: materialEntry.reason});
      } else if (materialEntry?.available) {
        const fragmentLimitExceeded = materialEntry.segmentResults?.some((result) => result.fragmentLimitExceeded);
        const provenFragmentCount = (materialEntry.segmentResults || []).reduce(
          (count, result) => count + (result.violationFragments?.length || 0),
          0,
        );
        entries.push({
          severity: materialEntry.aggregate.classification === "penetration" ? "error" : "info",
          message: `Signed retained-profile entry checks ${state.referenceComparison.materialSelectionLabel}.`
            + `${provenFragmentCount > 0 && !fragmentLimitExceeded ? " Proven violating fragments are drawn red." : ""}`
            + (materialEntry.cutterAware
              ? ' Confirmed nominal active cutting edges are swept continuously; any remaining point-only/unresolved portions are not full cutter coverage. Holder/full-insert collision is not included.'
              : ' Program reference-point path only; no confirmed finite cutting edge is available for these moves.'),
        });
        if (fragmentLimitExceeded) {
          entries.push({
            severity: "warning",
            message: `The red overlay exceeded its ${MAX_PROFILE_PENETRATION_FRAGMENTS.toLocaleString()}-fragment display limit and is incomplete; the proven material-entry warning remains valid.`,
          });
        }
      }
      for (const diagnostic of materialEntryDiagnostics(state.referenceComparison)) {
        if (diagnostic.message === state.referenceComparison?.materialEntryError) continue;
        entries.push({severity: "error", message: `Material check - ${formatMaterialDiagnostic(diagnostic)}`});
      }
      if (state.referenceComparison?.parserVerificationBlockerCount) {
        entries.push({
          severity: "error",
          message: `${state.referenceComparison.parserVerificationBlockerCount} unresolved parser diagnostic${state.referenceComparison.parserVerificationBlockerCount === 1 ? "" : "s"} prevent a complete path result.`,
        });
      }
      if (state.referenceComparison?.pending) {
        entries.push({severity: "warning", message: state.referenceComparison.pendingMessage});
      }
      if (reference.kind === "dxf") entries.push({severity: "warning", message: "Only the explicitly selected analytic contour can define DXF nominal material, and every edge must share one validated visible, unfrozen, plotted layer. Other imported curves remain overlay-only deviation references."});
      entries.push({severity: "warning", message: `Program-to-closest-${reference.kind === "step" ? "selected STEP contour" : "DXF"} deviation does not prove that every reference curve is machined.`});
    }
    if (state.referenceComparison?.calculationIncomplete) {
      entries.push({severity: "warning", message: state.referenceComparison.calculationIncomplete});
    }
    if (state.referenceComparison?.error) entries.push({severity: "error", message: state.referenceComparison.error});
  }
  elements.referenceGeometryDiagnostics.replaceChildren(...entries.map((entry) => {
    const item = document.createElement("li");
    item.textContent = entry.message;
    if (entry.severity === "warning") item.className = "warning";
    if (entry.severity === "error") item.className = "error";
    return item;
  }));
}

function renderReferenceGeometryUi() {
  const reference = state.referenceGeometry;
  solidSetupDialog.update(reference);
  const hasFile = Boolean(reference);
  const ready = Boolean(reference?.ready);
  const isStep = reference?.kind === "step";
  elements.loadDxfReferenceDemo.hidden = hasFile;
  elements.loadStepReferenceDemo.hidden = hasFile;
  elements.referenceDxfControls.hidden = isStep;
  elements.referenceStepControls.hidden = !isStep;
  syncDxfMaterialControls(reference);
  elements.buildStepSection.disabled = !isStep || reference.pending || reference.model?.authorized !== true;
  elements.removeGeometry.disabled = !hasFile;
  elements.referenceGeometryToggle.disabled = !ready || state.viewMode !== "2d";
  const witness = state.referenceComparison?.worstWitness;
  const canInspectDeviation = Boolean(ready && witness && witness.deviation.lowerBoundMm > 1e-10);
  if (!canInspectDeviation) state.showReferenceWitness = false;
  elements.inspectReferenceDeviation.hidden = !canInspectDeviation;
  elements.inspectReferenceDeviation.disabled = !canInspectDeviation
    || state.viewMode !== "2d"
    || !elements.referenceGeometryToggle.checked;
  elements.inspectReferenceDeviation.setAttribute("aria-pressed", String(state.showReferenceWitness));
  elements.inspectReferenceDeviation.textContent = state.showReferenceWitness ? "Hide deviation" : "Inspect deviation";
  elements.referenceGeometrySetup.classList.toggle("blocked", Boolean(hasFile && !ready));
  if (!hasFile) {
    elements.referenceGeometrySummary.textContent = "NONE";
    elements.referenceGeometryFile.textContent = "Import an ASCII DXF or a STEP solid to create an analytic 2D reference.";
    setReferenceResult(elements.referenceGeometryImportStatus, "NO FILE");
    setReferenceResult(elements.referenceGeometryAlignmentStatus, "—");
    setReferenceResult(elements.referenceGeometryDeviation, "—");
    renderProfilePenetrationUi();
    renderReferenceDiagnostics();
    return;
  }

  const hash = reference.source.sha256.slice(0, 12);
  const curveCount = reference.mapped?.primitives?.length ?? reference.model?.primitives?.length ?? 0;
  elements.referenceGeometryFile.textContent = `${reference.source.name} · ${isStep ? "STEP solid" : `${curveCount} analytic curve${curveCount === 1 ? "" : "s"}`} · SHA-256 ${hash}…`;
  if (reference.pending) {
    elements.referenceGeometrySummary.textContent = reference.pendingOperation === "section" ? "SECTIONING" : "IMPORTING";
    setReferenceResult(elements.referenceGeometryImportStatus, "LOCAL KERNEL", "review");
  } else if (reference.kind === "dxf" && referenceHasNonUnitParseError(reference.model)) {
    elements.referenceGeometrySummary.textContent = "BLOCKED";
    setReferenceResult(elements.referenceGeometryImportStatus, "BLOCKED", "blocked");
  } else if (reference.kind === "dxf" && !elements.referenceGeometryUnits.value) {
    elements.referenceGeometrySummary.textContent = "NEEDS SETUP";
    setReferenceResult(elements.referenceGeometryImportStatus, "SELECT UNITS", "review");
  } else if (isStep && reference.model?.authorized === false) {
    elements.referenceGeometrySummary.textContent = "BLOCKED";
    setReferenceResult(elements.referenceGeometryImportStatus, "IMPORT BLOCKED", "blocked");
  } else if (isStep && !reference.sectionDto) {
    elements.referenceGeometrySummary.textContent = "NEEDS SECTION";
    setReferenceResult(elements.referenceGeometryImportStatus, "SOLID READY", "review");
  } else if (isStep && reference.sectionDto?.authorized === false) {
    elements.referenceGeometrySummary.textContent = "BLOCKED";
    setReferenceResult(elements.referenceGeometryImportStatus, "SECTION BLOCKED", "blocked");
  } else if (isStep && !elements.stepContour.value) {
    elements.referenceGeometrySummary.textContent = "SELECT CONTOUR";
    setReferenceResult(elements.referenceGeometryImportStatus, "SECTION READY", "review");
  } else if (!ready) {
    elements.referenceGeometrySummary.textContent = "BLOCKED";
    setReferenceResult(elements.referenceGeometryImportStatus, "BLOCKED", "blocked");
  } else {
    elements.referenceGeometrySummary.textContent = "OVERLAY READY";
    setReferenceResult(elements.referenceGeometryImportStatus, "ANALYTIC GEOMETRY", "ready");
  }

  const comparison = state.referenceComparison;
  const aggregate = comparison?.result?.aggregate;
  if (!ready) {
    setReferenceResult(elements.referenceGeometryAlignmentStatus, "—");
    setReferenceResult(elements.referenceGeometryDeviation, "—");
  } else if (comparison?.pending) {
    setReferenceResult(elements.referenceGeometryAlignmentStatus, comparison.pendingLabel, "review");
    setReferenceResult(elements.referenceGeometryDeviation, "—");
  } else if (!aggregate || comparison?.error) {
    setReferenceResult(elements.referenceGeometryAlignmentStatus,
      comparison?.calculationIncomplete ? "CALCULATION INCOMPLETE" : "BLOCKED",
      comparison?.calculationIncomplete ? "review" : "blocked");
    setReferenceResult(elements.referenceGeometryDeviation, "—");
  } else {
    const labels = {
      "within-tolerance": ["WITHIN THRESHOLD", "ready"],
      "outside-tolerance": ["OUTSIDE THRESHOLD", "blocked"],
      "tolerance-boundary": ["THRESHOLD BOUNDARY", "review"],
      unresolved: ["UNRESOLVED", "blocked"],
      "no-comparable-segments": ["NO PROFILE PATH", "blocked"],
    };
    const [label, tone] = labels[aggregate.classification] || ["REVIEW", "review"];
    setReferenceResult(elements.referenceGeometryAlignmentStatus, label, tone);
    if (!aggregate.maximumDeviation) {
      setReferenceResult(elements.referenceGeometryDeviation, "—");
    } else {
      const {lowerBoundMm, upperBoundMm} = aggregate.maximumDeviation;
      const deviation = upperBoundMm - lowerBoundMm <= 1e-10
        ? formatReferenceDistance(upperBoundMm)
        : `${formatReferenceDistance(lowerBoundMm)}–${formatReferenceDistance(upperBoundMm)}`;
      setReferenceResult(elements.referenceGeometryDeviation, deviation, tone);
    }
  }
  renderProfilePenetrationUi({ready, comparison});
  renderReferenceDiagnostics();
}

function finalizeReferenceMapping(reference, mapped, {fit = false} = {}) {
  reference.mapped = mapped;
  reference.displayWorkload = mapped?.authorized
    ? referenceDisplayWorkload(mapped.primitives)
    : null;
  reference.ready = Boolean(mapped?.authorized
    && mapped.primitives.length > 0
    && reference.displayWorkload?.allowed);
  reference.entities = reference.ready ? referenceInspectorEntities(mapped, reference.source.name) : [];
  updateReferenceComparison();
  renderReferenceGeometryUi();
  if (fit) fitView(); else draw();
}

function stepMappingFromControls() {
  const selectedIndex = Number.parseInt(elements.stepContour.value, 10);
  const selectedContour = Number.isSafeInteger(selectedIndex)
    ? sectionContours(state.referenceGeometry?.sectionDto)[selectedIndex]
    : null;
  const requiredMillimeters = (control) => {
    const text = control.value.trim();
    if (!text) return NaN;
    const retained = Number(control.dataset.canonicalMm);
    if (text === control.dataset.canonicalDisplayValue && Number.isFinite(retained)) return retained;
    return Number(text) * unitScale();
  };
  return {
    axialAxis: elements.stepAxialAxis.value,
    radialAxis: elements.stepRadialAxis.value,
    normalAxis: elements.stepNormalAxis.value,
    planeOffsetMm: requiredMillimeters(elements.stepPlaneOffset),
    axialOriginMm: requiredMillimeters(elements.stepAxialOrigin),
    radialOriginMm: requiredMillimeters(elements.stepRadialOrigin),
    axialDirection: Number(elements.stepAxialDirection.value),
    radialDirection: Number(elements.stepRadialDirection.value),
    selectedContourId: selectedContour?.id ?? "",
    profileSide: "positive",
  };
}

function mapCurrentStepSection({fit = false} = {}) {
  const reference = state.referenceGeometry;
  if (!reference || reference.kind !== "step" || !reference.sectionDto || !elements.stepContour.value) {
    if (reference?.kind === "step") {
      reference.mapped = null;
      reference.entities = [];
      reference.displayWorkload = null;
      reference.ready = false;
    }
    state.referenceComparison = null;
    renderReferenceGeometryUi();
    if (fit) fitView(); else draw();
    return;
  }
  let mapped;
  const mapping = stepMappingFromControls();
  try {
    mapped = mapStepSectionToLatheGeometry(reference.sectionDto, mapping);
    if (mapped.authorized) retainStepCoordinateMapping(mapping);
  } catch (error) {
    mapped = {
      format: "step-section", coordinateSystem: "lathe-xz", primitives: [], geometry: [], bounds: null,
      diagnostics: [{severity: "error", code: "step-mapping-failed", message: error instanceof Error ? error.message : String(error)}],
      authorized: false,
    };
  }
  finalizeReferenceMapping(reference, mapped, {fit});
}

function refreshReferenceGeometry({fit = false} = {}) {
  const reference = state.referenceGeometry;
  if (!reference) {
    state.referenceComparison = null;
    renderReferenceGeometryUi();
    if (fit) fitView(); else draw();
    return;
  }
  if (reference.kind === "step") {
    mapCurrentStepSection({fit});
    return;
  }
  const units = elements.referenceGeometryUnits.value;
  const originX = elements.referenceGeometryOriginX.value.trim();
  const originY = elements.referenceGeometryOriginY.value.trim();
  if (!units || !originX || !originY) {
    reference.mapped = null;
    reference.entities = [];
    reference.displayWorkload = null;
    reference.ready = false;
    state.referenceComparison = null;
    renderReferenceGeometryUi();
    if (fit) fitView(); else draw();
    return;
  }
  const mapped = toLatheGeometry(reference.model, {
    sourceUnits: reference.unitsAuthority === "dxf-header" ? null : units,
    targetUnits: "millimeter",
    overrideDeclaredUnits: reference.unitsAuthority === "user-confirmed",
    origin: {x: Number(originX), y: Number(originY)},
    zDirection: Number(elements.referenceGeometryZDirection.value),
    radialDirection: Number(elements.referenceGeometryXDirection.value),
    materialSelection: dxfMaterialSelectionFromControls(),
  });
  finalizeReferenceMapping(reference, mapped, {fit});
}

function purgeReferencePayload(reference) {
  if (!reference) return;
  reference.worker?.terminate?.("STEP reference replaced or removed from memory.");
  if (reference.source?.originalBytes instanceof Uint8Array) reference.source.originalBytes.fill(0);
  if (reference.source) {
    reference.source.originalBytes = null;
    reference.source.originalText = null;
  }
  reference.worker = null;
  reference.sectionDto = null;
  reference.preview = null;
  reference.guidedSetup = null;
  reference.mapped = null;
  reference.entities = [];
}

function beginReferenceReplacement(intentRevision = null, {preserveBundledStepReference = false} = {}) {
  if (intentRevision !== null && state.referenceIntentRevision !== intentRevision) return false;
  if (intentRevision === null) state.referenceIntentRevision += 1;
  solidSetupDialog.clear();
  state.referenceGeneration += 1;
  purgeReferencePayload(state.referenceGeometry);
  state.referenceGeometry = null;
  state.referenceComparison = null;
  state.showReferenceWitness = false;
  if (!preserveBundledStepReference) state.bundledStepReference = false;
  schedulePersist();
  return true;
}

function discardSupersededReferenceOperation(reference, generation) {
  if (state.referenceGeneration !== generation || state.referenceGeometry !== reference) return false;
  // A newer import already owns referenceIntentRevision. Dispose only this old
  // payload; never advance or overwrite the newer operation's intent.
  solidSetupDialog.clear();
  state.referenceGeneration += 1;
  purgeReferencePayload(reference);
  state.referenceGeometry = null;
  state.referenceComparison = null;
  state.showReferenceWitness = false;
  state.bundledStepReference = false;
  schedulePersist();
  renderReferenceGeometryUi();
  draw();
  return true;
}

function resetStepControls() {
  elements.stepAxialAxis.value = "";
  elements.stepRadialAxis.value = "";
  elements.stepNormalAxis.value = "";
  elements.stepPlaneOffset.value = "0";
  elements.stepAxialOrigin.value = "0";
  elements.stepRadialOrigin.value = "0";
  for (const control of [elements.stepPlaneOffset, elements.stepAxialOrigin, elements.stepRadialOrigin]) {
    delete control.dataset.canonicalMm;
    delete control.dataset.canonicalDisplayValue;
  }
  elements.stepAxialDirection.value = "1";
  elements.stepRadialDirection.value = "1";
  elements.stepContour.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Build section first";
  elements.stepContour.append(placeholder);
}

function sectionContours(sectionDto) {
  const contours = sectionDto?.contours ?? sectionDto?.section?.contours;
  return Array.isArray(contours) ? contours : [];
}

function populateStepContours(sectionDto) {
  const contours = sectionContours(sectionDto);
  elements.stepContour.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = contours.length ? "Select explicitly" : "No closed contours";
  elements.stepContour.append(placeholder);
  contours.forEach((contour, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    const edgeCount = Array.isArray(contour.edges) ? contour.edges.length : Number(contour.edgeCount) || 0;
    option.textContent = `Contour ${index + 1} · ${edgeCount} analytic edge${edgeCount === 1 ? "" : "s"}`;
    elements.stepContour.append(option);
  });
  elements.stepContour.value = "";
}

function acceptDxfSource({name, content, byteLength, sha256, encoding, originalBytes = null}, intentRevision = null) {
  if (intentRevision !== null && state.referenceIntentRevision !== intentRevision) {
    originalBytes?.fill?.(0);
    return false;
  }
  const model = parseDxf(content, {sourceName: name, sourceHash: sha256});
  if (!beginReferenceReplacement(intentRevision)) {
    originalBytes?.fill?.(0);
    return false;
  }
  // Do not let the hidden browser input retain a second File/byte authority;
  // the explicit in-memory source below is the only retained DXF payload.
  elements.geometryFileInput.value = "";
  const detectedUnits = detectedReferenceUnits(model);
  elements.referenceGeometryUnits.value = detectedUnits;
  elements.referenceGeometryOriginX.value = "0";
  elements.referenceGeometryOriginY.value = "0";
  elements.referenceGeometryZDirection.value = "1";
  elements.referenceGeometryXDirection.value = "1";
  elements.referenceGeometryToggle.checked = true;
  resetDxfMaterialControls("DXF mapped. Closed-contour choices will appear when analytic validation completes.");
  state.referenceGeometry = {
    kind: "dxf",
    source: {name, byteLength, sha256, encoding, originalBytes, originalText: content},
    model,
    unitsAuthority: detectedUnits ? "dxf-header" : null,
    mapped: null,
    entities: [],
    displayWorkload: null,
    ready: false,
  };
  state.geometryHover = null;
  state.geometrySelection = null;
  state.componentGeometry = [];
  resetGeometryInspectorDom();
  clearPinnedDimensions({disableMode: true});
  elements.referenceGeometrySetup.open = true;
  refreshReferenceGeometry({fit: true});
  return true;
}

async function acceptStepSource(
  {name, byteLength, sha256, originalBytes},
  intentRevision = null,
  {openPlacement = true, preserveBundledStepReference = false, expectedProgramRevision = null} = {},
) {
  if (!(originalBytes instanceof Uint8Array) || originalBytes.byteLength !== byteLength) {
    throw new TypeError("STEP import requires the exact source bytes and matching byte length.");
  }
  if (intentRevision !== null && state.referenceIntentRevision !== intentRevision) {
    originalBytes.fill(0);
    return false;
  }
  if (isMillMode()) {
    originalBytes.fill(0);
    return false;
  }
  const worker = new StepKernelClient();
  if (!beginReferenceReplacement(intentRevision, {preserveBundledStepReference})) {
    worker.terminate("A newer reference import superseded this STEP source.");
    originalBytes.fill(0);
    return false;
  }
  const generation = state.referenceGeneration;
  resetStepControls();
  elements.stepFileInput.value = "";
  elements.referenceGeometryToggle.checked = true;
  const reference = {
    kind: "step",
    source: {name, byteLength, sha256, encoding: "binary", originalBytes},
    model: {schemaVersion: 1, format: "step-solid", source: {name, byteLength, sha256}, diagnostics: [], authorized: null},
    worker,
    pending: true,
    pendingOperation: "load",
    pendingMessage: "Loading the pinned local Open CASCADE kernel and translating the STEP B-rep…",
    sectionRevision: 0,
    sectionDto: null,
    setupDiagnostics: [],
    mapped: null,
    entities: [],
    displayWorkload: null,
    ready: false,
  };
  state.referenceGeometry = reference;
  state.geometryHover = null;
  state.geometrySelection = null;
  state.componentGeometry = [];
  resetGeometryInspectorDom();
  clearPinnedDimensions({disableMode: true});
  elements.referenceGeometrySetup.open = true;
  renderReferenceGeometryUi();
  if (openPlacement) solidSetupDialog.open(reference);
  draw();
  elements.status.textContent = `Importing ${name} locally; the STEP kernel is loaded only on first use…`;
  try {
    const result = await worker.load({source: {name, byteLength, sha256}, bytes: originalBytes});
    if (state.referenceGeneration !== generation || state.referenceGeometry !== reference) return;
    if (intentRevision !== null && state.referenceIntentRevision !== intentRevision) {
      discardSupersededReferenceOperation(reference, generation);
      return false;
    }
    if (preserveBundledStepReference && (
      state.bundledStepReference !== true
      || state.programRevision !== expectedProgramRevision
      || isMillMode()
      || elements.xMode.value !== "diameter"
    )) {
      const programChanged = state.programRevision !== expectedProgramRevision;
      beginReferenceReplacement(intentRevision);
      renderReferenceGeometryUi();
      draw();
      elements.status.textContent = programChanged
        ? "Program changed — plot to refresh"
        : "G71 + STEP demo canceled — Lathe and Diameter X programming are required for its pinned comparison.";
      return false;
    }
    if (result?.schemaVersion !== 1 || result?.format !== "step-solid" || !result.source
      || result.source.name !== name || result.source.byteLength !== byteLength || result.source.sha256 !== sha256) {
      throw new Error("The STEP worker result did not match the retained source-byte provenance.");
    }
    reference.model = result;
    reference.pending = false;
    reference.pendingOperation = null;
    reference.pendingMessage = null;
    if (result?.authorized !== true) {
      worker.terminate("Unauthorized STEP import was purged from the geometry worker.");
      reference.worker = null;
      elements.status.textContent = `${name} was read, but its STEP topology or precision evidence is blocked.`;
    } else {
      elements.status.textContent = openPlacement
        ? `Imported ${name} locally. Select the spindle axis and the face or shoulder used as program Z0.`
        : `Imported ${name} locally. Building its pinned demonstration profile…`;
    }
  } catch (error) {
    if (state.referenceGeneration !== generation || state.referenceGeometry !== reference) return;
    worker.terminate("Failed STEP import was purged from the geometry worker.");
    reference.worker = null;
    reference.pending = false;
    reference.pendingOperation = null;
    reference.pendingMessage = null;
    reference.model = {
      schemaVersion: 1, format: "step-solid", source: {name, byteLength, sha256}, authorized: false,
      diagnostics: [{severity: "error", code: "step-import-failed", message: error instanceof Error ? error.message : String(error)}],
    };
    elements.status.textContent = error instanceof Error ? error.message : "Could not import that STEP solid.";
  }
  renderReferenceGeometryUi();
  draw();
  return true;
}

async function applyBundledStepSampleReference(reference, {
  expectedIntentRevision,
  expectedProgramRevision,
} = {}) {
  if (state.referenceGeometry !== reference || reference?.kind !== "step"
    || reference.worker?.closed || reference.model?.authorized !== true || isMillMode()
    || state.referenceIntentRevision !== expectedIntentRevision
    || state.programRevision !== expectedProgramRevision) {
    throw new Error("The bundled STEP solid was not available for its pinned demonstration setup.");
  }
  const generation = state.referenceGeneration;
  reference.pending = true;
  reference.pendingOperation = "section";
  reference.pendingMessage = "Building the pinned exact centerline section for the bundled demonstration…";
  renderReferenceGeometryUi();
  draw();
  try {
    const sectionDto = await reference.worker.section({normalAxis: "y", planeOffsetMm: 0});
    if (state.referenceGeneration !== generation || state.referenceGeometry !== reference) return false;
    if (state.referenceIntentRevision !== expectedIntentRevision) {
      discardSupersededReferenceOperation(reference, generation);
      return false;
    }
    const programChanged = state.programRevision !== expectedProgramRevision;
    if (programChanged || state.bundledStepReference !== true
      || isMillMode() || elements.xMode.value !== "diameter") {
      // Program/setup semantics changed while the section worker was busy. Purge
      // the stale demo payload before it can mutate or render a comparison.
      beginReferenceReplacement(expectedIntentRevision);
      renderReferenceGeometryUi();
      draw();
      elements.status.textContent = programChanged
        ? "Program changed — plot to refresh"
        : "G71 + STEP demo canceled — Lathe and Diameter X programming are required for its pinned comparison.";
      return false;
    }
    if (sectionDto?.schemaVersion !== 1 || sectionDto?.format !== "step-section" || sectionDto.authorized !== true
      || sectionDto.source?.name !== reference.source.name
      || sectionDto.source?.byteLength !== reference.source.byteLength
      || sectionDto.source?.sha256 !== reference.source.sha256) {
      throw new Error("The bundled STEP section did not reproduce its pinned source provenance.");
    }
    const contours = sectionContours(sectionDto);
    if (contours.length !== 1 || !contours[0]?.id) {
      throw new Error("The bundled STEP demonstration no longer produces its single expected closed contour.");
    }
    applyGuidedStepSection({
      reference,
      sectionDto,
      mapping: {
        axialAxis: "z",
        radialAxis: "x",
        normalAxis: "y",
        planeOffsetMm: 0,
        axialOriginMm: 0,
        radialOriginMm: 0,
        axialDirection: 1,
        radialDirection: 1,
        selectedContourId: contours[0].id,
        profileSide: "positive",
      },
      provenance: {
        sourceHash: reference.source.sha256,
        spindleSource: "pinned-bundled-demonstration",
        spindleFaceId: null,
        frontFaceId: null,
        planeNormalAxis: "y",
      },
    });
    solidSetupDialog.close({restoreFocus: false});
    return true;
  } catch (error) {
    if (state.referenceGeneration === generation && state.referenceGeometry === reference) {
      reference.pending = false;
      reference.pendingOperation = null;
      reference.pendingMessage = null;
      reference.ready = false;
      reference.setupDiagnostics = [{
        severity: "error",
        code: "bundled-step-demo-section-failed",
        message: error instanceof Error ? error.message : String(error),
      }];
      renderReferenceGeometryUi();
      draw();
    }
    throw error;
  }
}

async function recoverStepAnalyticWorker(reference) {
  const generation = state.referenceGeneration;
  const source = reference?.source;
  const bytes = source?.originalBytes;
  if (state.referenceGeometry !== reference || !(bytes instanceof Uint8Array)
    || bytes.byteLength !== source.byteLength || isMillMode()) return false;
  let replacement;
  try {
    replacement = new StepKernelClient();
    const result = await replacement.load({
      source: {name: source.name, byteLength: source.byteLength, sha256: source.sha256},
      bytes,
    });
    if (state.referenceGeneration !== generation || state.referenceGeometry !== reference) {
      replacement.terminate("Stale STEP worker recovery was discarded.");
      return false;
    }
    if (result?.schemaVersion !== 1 || result?.format !== "step-solid" || result.authorized !== true
      || result.source?.name !== source.name || result.source?.byteLength !== source.byteLength
      || result.source?.sha256 !== source.sha256) {
      throw new Error("Recovered STEP worker did not reproduce the authorized source.");
    }
    reference.worker = replacement;
    reference.model = result;
    reference.pending = false;
    reference.pendingOperation = null;
    reference.pendingMessage = null;
    return true;
  } catch {
    replacement?.terminate("STEP worker recovery failed.");
    return false;
  }
}

function applyGuidedStepSection({reference, sectionDto, mapping, provenance}) {
  if (state.referenceGeometry !== reference || reference.worker?.closed || isMillMode()) {
    throw new Error("This solid is no longer the active lathe reference. Reopen its setup before applying.");
  }
  const mapped = mapStepSectionToLatheGeometry(sectionDto, mapping);
  if (!mapped.authorized) throw new Error("The selected section could not be authorized for path comparison.");
  if (!referenceDisplayWorkload(mapped.primitives).allowed) {
    throw new Error("This section exceeds the backplot's display budget. Select a simpler supported contour before applying.");
  }
  reference.sectionRevision = (reference.sectionRevision ?? 0) + 1;
  reference.sectionDto = sectionDto;
  reference.guidedSetup = {...provenance, mapping: {...mapping}};
  reference.setupDiagnostics = [];
  reference.pending = false;
  reference.pendingOperation = null;
  reference.pendingMessage = null;
  for (const [control, key] of [
    [elements.stepAxialAxis, "axialAxis"], [elements.stepRadialAxis, "radialAxis"],
    [elements.stepNormalAxis, "normalAxis"],
    [elements.stepAxialDirection, "axialDirection"], [elements.stepRadialDirection, "radialDirection"],
  ]) control.value = String(mapping[key]);
  retainStepCoordinateMapping(mapping);
  populateStepContours(sectionDto);
  elements.stepContour.value = String(sectionContours(sectionDto).findIndex((contour) => contour.id === mapping.selectedContourId));
  setGraphicsDimension("2d");
  elements.referenceGeometryToggle.checked = true;
  finalizeReferenceMapping(reference, mapped, {fit: true});
  elements.status.textContent = "Exact STEP section applied. Yellow is the reference; any nonzero gap can be inspected from the reference panel.";
}

async function buildStepSection() {
  const reference = state.referenceGeometry;
  if (!reference || reference.kind !== "step" || reference.pending) return;
  reference.setupDiagnostics = [];
  const mapping = stepMappingFromControls();
  const axes = [mapping.axialAxis, mapping.radialAxis, mapping.normalAxis];
  if (new Set(axes).size !== 3 || axes.some((axis) => !["x", "y", "z"].includes(axis))) {
    reference.setupDiagnostics.push({severity: "error", code: "step-axes-required", message: "Select three distinct model axes for axial, radial, and section-normal directions."});
  }
  if (![mapping.planeOffsetMm, mapping.axialOriginMm, mapping.radialOriginMm].every(Number.isFinite)) {
    reference.setupDiagnostics.push({severity: "error", code: "step-transform-invalid", message: `STEP section coordinate and origins must be finite ${elements.displayUnits.value === "inch" ? "inch" : "millimeter"} values.`});
  }
  if (!reference.worker || reference.model?.authorized !== true) {
    reference.setupDiagnostics.push({severity: "error", code: "step-model-unavailable", message: "A validated single STEP solid is required before building a section."});
  }
  if (reference.setupDiagnostics.length) {
    reference.sectionDto = null;
    reference.mapped = null;
    reference.entities = [];
    reference.ready = false;
    state.referenceComparison = null;
    renderReferenceGeometryUi();
    draw();
    return;
  }
  retainStepCoordinateMapping(mapping);

  const generation = state.referenceGeneration;
  const sectionRevision = (reference.sectionRevision ?? 0) + 1;
  reference.sectionRevision = sectionRevision;
  reference.pending = true;
  reference.pendingOperation = "section";
  reference.pendingMessage = `Computing the exact ${mapping.normalAxis.toUpperCase()}=${formatReferenceDistance(mapping.planeOffsetMm)} B-rep section locally…`;
  reference.sectionDto = null;
  reference.mapped = null;
  reference.entities = [];
  reference.displayWorkload = null;
  reference.ready = false;
  state.referenceComparison = null;
  populateStepContours(null);
  renderReferenceGeometryUi();
  draw();
  try {
    const result = await reference.worker.section({normalAxis: mapping.normalAxis, planeOffsetMm: mapping.planeOffsetMm});
    if (state.referenceGeneration !== generation || state.referenceGeometry !== reference) return;
    if (reference.sectionRevision !== sectionRevision) {
      if (!reference.pending || reference.pendingOperation !== "section") return;
      reference.pending = false;
      reference.pendingOperation = null;
      reference.pendingMessage = null;
      reference.setupDiagnostics = [{
        severity: "warning",
        code: "step-section-definition-changed",
        message: "The STEP axes or section plane changed while the kernel was working; build the section again.",
      }];
      elements.status.textContent = "STEP section setup changed; build the analytic section again.";
      renderReferenceGeometryUi();
      draw();
      return;
    }
    if (result?.schemaVersion !== 1 || result?.format !== "step-section" || !result.source
      || result.source.name !== reference.source.name
      || result.source.byteLength !== reference.source.byteLength
      || result.source.sha256 !== reference.source.sha256) {
      throw new Error("The STEP section result did not match the retained source-byte provenance.");
    }
    reference.sectionDto = result;
    reference.pending = false;
    reference.pendingOperation = null;
    reference.pendingMessage = null;
    populateStepContours(result);
    if (result?.authorized === true && sectionContours(result).length) {
      elements.status.textContent = `Analytic section built from ${reference.source.name}. Select the intended closed contour before comparison.`;
    } else {
      elements.status.textContent = "The selected STEP section is blocked; review its topology and precision diagnostics.";
    }
  } catch (error) {
    if (state.referenceGeneration !== generation || state.referenceGeometry !== reference) return;
    if (reference.sectionRevision !== sectionRevision) {
      if (!reference.pending || reference.pendingOperation !== "section") return;
      reference.pending = false;
      reference.pendingOperation = null;
      reference.pendingMessage = null;
      reference.setupDiagnostics = [{
        severity: "warning",
        code: "step-section-definition-changed",
        message: "The STEP axes or section plane changed while the kernel was working; build the section again.",
      }];
      renderReferenceGeometryUi();
      draw();
      return;
    }
    reference.pending = false;
    reference.pendingOperation = null;
    reference.pendingMessage = null;
    reference.sectionDto = {
      schemaVersion: 1, format: "step-section", authorized: false, section: {contours: []},
      diagnostics: [{severity: "error", code: "step-section-failed", message: error instanceof Error ? error.message : String(error)}],
    };
    populateStepContours(reference.sectionDto);
    elements.status.textContent = error instanceof Error ? error.message : "Could not section that STEP solid.";
  }
  renderReferenceGeometryUi();
  draw();
}

async function loadBrowserDxf(file) {
  if (!file) return;
  const intentRevision = ++state.referenceIntentRevision;
  if (isMillMode()) {
    elements.status.textContent = "DXF reference comparison is lathe-only in the current bounded mill path viewer.";
    return;
  }
  if (file.size > MAX_DXF_BYTES) {
    elements.status.textContent = "That DXF is larger than G-Code Studio's 25 MB browser limit.";
    elements.geometryFileInput.value = "";
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const sha256 = await sha256Hex(buffer);
    const decoded = decodeDxfBytes(bytes);
    if (state.referenceIntentRevision !== intentRevision || isMillMode()) {
      bytes.fill(0);
      return;
    }
    acceptDxfSource({
      name: file.name, content: decoded.content, byteLength: bytes.byteLength, sha256,
      encoding: decoded.encoding, originalBytes: bytes,
    }, intentRevision);
    elements.status.textContent = `Imported ${file.name} as an in-memory DXF reference`;
  } catch (error) {
    if (state.referenceIntentRevision === intentRevision) {
      elements.status.textContent = error instanceof Error ? error.message : "Could not import that DXF.";
    }
  } finally {
    elements.geometryFileInput.value = "";
  }
}

async function loadBrowserStep(file) {
  if (!file) return;
  const intentRevision = ++state.referenceIntentRevision;
  if (isMillMode()) {
    elements.status.textContent = "STEP reference comparison is lathe-only in the current bounded mill path viewer.";
    return;
  }
  if (file.size > MAX_STEP_BYTES) {
    elements.status.textContent = "That STEP file is larger than G-Code Studio's 25 MB browser limit.";
    elements.stepFileInput.value = "";
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    const originalBytes = new Uint8Array(buffer);
    const sha256 = await sha256Hex(buffer);
    if (state.referenceIntentRevision !== intentRevision || isMillMode()) {
      originalBytes.fill(0);
      return;
    }
    await acceptStepSource({name: file.name, byteLength: originalBytes.byteLength, sha256, originalBytes}, intentRevision);
  } catch (error) {
    if (state.referenceIntentRevision === intentRevision) {
      elements.status.textContent = error instanceof Error ? error.message : "Could not import that STEP solid.";
    }
  } finally {
    elements.stepFileInput.value = "";
  }
}

async function openReferenceGeometry() {
  if (isMillMode()) {
    elements.status.textContent = "Switch to Lathe to import a DXF reference; mill mode currently displays command centerlines only.";
    return;
  }
  if (window.pywebview?.api?.open_dxf) {
    const observedIntentRevision = state.referenceIntentRevision;
    const selected = await window.pywebview.api.open_dxf();
    if (state.referenceIntentRevision !== observedIntentRevision) return;
    if (selected?.error) {
      elements.status.textContent = selected.error;
      return;
    }
    if (typeof selected?.originalBytesBase64 === "string") {
      const intentRevision = ++state.referenceIntentRevision;
      try {
        const originalBytes = bytesFromBase64(selected.originalBytesBase64);
        const bridgeHash = await sha256Hex(originalBytes.buffer);
        if (originalBytes.byteLength !== selected.byteLength || bridgeHash !== selected.sha256) {
          throw new Error("The desktop DXF byte provenance did not match its declared size and SHA-256.");
        }
        const decoded = decodeDxfBytes(originalBytes);
        if (state.referenceIntentRevision !== intentRevision) {
          originalBytes.fill(0);
          return;
        }
        acceptDxfSource({
          name: selected.name, content: decoded.content, byteLength: selected.byteLength,
          sha256: selected.sha256, encoding: decoded.encoding,
          originalBytes,
        }, intentRevision);
        elements.status.textContent = `Imported ${selected.name} as an in-memory DXF reference`;
      } catch (error) {
        if (state.referenceIntentRevision === intentRevision) {
          elements.status.textContent = error instanceof Error ? error.message : "Could not import that DXF.";
        }
      }
    }
    return;
  }
  elements.geometryFileInput.click();
}

async function openStepGeometry() {
  if (isMillMode()) {
    elements.status.textContent = "Switch to Lathe to import a STEP reference; mill mode currently displays command centerlines only.";
    return;
  }
  if (window.pywebview?.api?.open_step) {
    const observedIntentRevision = state.referenceIntentRevision;
    const selected = await window.pywebview.api.open_step();
    if (state.referenceIntentRevision !== observedIntentRevision) return;
    if (selected?.error) {
      elements.status.textContent = selected.error;
      return;
    }
    if (typeof selected?.originalBytesBase64 === "string") {
      const intentRevision = ++state.referenceIntentRevision;
      try {
        const originalBytes = bytesFromBase64(selected.originalBytesBase64);
        const bridgeHash = await sha256Hex(originalBytes.buffer);
        if (originalBytes.byteLength !== selected.byteLength || bridgeHash !== selected.sha256) {
          throw new Error("The desktop STEP byte provenance did not match its declared size and SHA-256.");
        }
        if (state.referenceIntentRevision !== intentRevision) {
          originalBytes.fill(0);
          return;
        }
        await acceptStepSource({
          name: selected.name, byteLength: selected.byteLength, sha256: selected.sha256, originalBytes,
        }, intentRevision);
      } catch (error) {
        if (state.referenceIntentRevision === intentRevision) {
          elements.status.textContent = error instanceof Error ? error.message : "Could not import that STEP solid.";
        }
      }
    }
    return;
  }
  elements.stepFileInput.click();
}

function removeReferenceGeometry() {
  const removedKind = state.referenceGeometry?.kind;
  beginReferenceReplacement();
  state.geometryHover = null;
  state.geometrySelection = null;
  state.componentGeometry = [];
  clearPinnedDimensions({disableMode: true});
  elements.geometryFileInput.value = "";
  elements.stepFileInput.value = "";
  elements.referenceGeometryUnits.value = "";
  resetStepControls();
  resetGeometryInspectorDom();
  renderReferenceGeometryUi();
  elements.status.textContent = `${removedKind === "step" ? "STEP" : "DXF"} reference removed from memory`;
  fitView();
  persistSession();
}

async function saveProgram() {
  const suggestedName = currentProgramFileName();
  if (window.pywebview?.api?.save_gcode) {
    const programRevision = state.programRevision;
    const content = elements.input.value;
    const saved = await window.pywebview.api.save_gcode(suggestedName, content);
    if (state.programRevision !== programRevision || elements.input.value !== content) return;
    if (saved?.error) { elements.status.textContent = saved.error; return; }
    if (saved?.name) {
      const normalizedName = (value) => String(value ?? "").trim().replaceAll("\\", "/").split("/").at(-1)?.toUpperCase() || "";
      const renamed = normalizedName(saved.name) !== normalizedName(suggestedName);
      state.programIdentity = createProgramIdentity(elements.input.value, {fileName: saved.name});
      renderProgramIdentity();
      if (renamed) {
        clearToolAssignmentContext();
        state.bundledSample = false;
        state.bundledStepReference = false;
        markProgramChanged();
        renderProgramToolAssignments();
      }
      elements.status.textContent = renamed
        ? `Saved ${saved.name} · plot to review tools for the renamed program`
        : `Saved ${saved.name}`;
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

function clearComparison() {
  resetComparisonDisplay();
  state.comparisonOriginalRevision += 1;
  state.comparisonOriginal = null;
  state.comparison = null;
  state.comparisonGeometry = null;
  elements.originalFileInput.value = "";
  $("originalCompareName").textContent = "No original selected";
  $("originalCompareMeta").textContent = "Open the approved program or snapshot the current editor before changing it.";
  $("comparisonBlockers").replaceChildren();
  $("comparisonBlockers").hidden = true;
  for (const id of ["compareVerdict", "compareVerdictDetail", "graphicsVerdict", "originalGeometryCount", "revisedGeometryCount", "graphicsInfoDifferenceCount"]) $(id).textContent = "";
  for (const id of ["compareChangedCount", "compareAddedCount", "compareRemovedCount", "compareUnchangedCount"]) $(id).textContent = "0";
  for (const id of ["compareCoordinateWords", "compareCommandWords", "compareProcessWords", "compareReferenceWords"]) $(id).textContent = "";
  $("compareVerdictBadge").textContent = "";
  $("compareVerdictBadge").className = "compare-verdict-badge";
  for (const canvas of [elements.originalCompareCanvas, elements.revisedCompareCanvas, elements.overlayCompareCanvas]) {
    const context = canvas.getContext("2d");
    context.save();
    context.resetTransform();
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.restore();
  }
  renderComparisonRows();
  renderComparison();
}

function setComparisonOriginal(name, content, {snapshot = false} = {}) {
  resetComparisonDisplay();
  state.comparisonOriginalRevision += 1;
  state.comparisonOriginal = {name: name || "original-program.nc", content: String(content ?? "")};
  if (snapshot) {
    state.comparisonOriginal.sourceFileName = currentProgramFileName();
    state.comparisonOriginal.confirmedToolOffsetPairings = toolOffsetPairingsForSource(content);
    state.comparisonOriginal.toolOffsetConfirmationScope = toolOffsetScopeFor(content, currentProgramFileName());
  }
  $("originalCompareName").textContent = state.comparisonOriginal.name;
  $("originalCompareMeta").textContent = `${state.comparisonOriginal.content.replace(/\r/g, "").split("\n").length} lines · held in memory on this device`;
  renderComparison();
}

async function chooseComparisonOriginal() {
  if (window.pywebview?.api?.open_gcode) {
    const revision = ++state.comparisonOriginalRevision;
    try {
      const selected = await window.pywebview.api.open_gcode();
      if (revision !== state.comparisonOriginalRevision) return;
      if (selected?.error) { elements.status.textContent = selected.error; return; }
      if (typeof selected?.content === "string") setComparisonOriginal(selected.name, selected.content);
    } catch {
      if (revision === state.comparisonOriginalRevision) elements.status.textContent = "Could not read the original program.";
    }
    return;
  }
  state.comparisonPickerRevision = ++state.comparisonOriginalRevision;
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
  const centerZ = (bounds.minZ + bounds.maxZ) / 2 + state.compareCamera.offsetZ;
  const centerX = (bounds.minX + bounds.maxX) / 2 + state.compareCamera.offsetX;
  state.compareViewport = {scale};
  const visible = {minZ: centerZ - width / (2 * scale), maxZ: centerZ + width / (2 * scale),
    minX: centerX - height / (2 * scale), maxX: centerX + height / (2 * scale)};
  const toScreen = (point) => ({
    x: width / 2 + (point.z - centerZ) * scale,
    y: height / 2 - (point.x - centerX) * scale,
  });
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#061012";
  context.fillRect(0, 0, width, height);
  const step = comparisonGridStep(Math.max(visible.maxZ - visible.minZ, visible.maxX - visible.minX));
  context.lineWidth = 1;
  context.strokeStyle = "rgba(38, 64, 69, .58)";
  context.beginPath();
  for (let z = Math.ceil(visible.minZ / step) * step; z <= visible.maxZ; z += step) {
    const screen = toScreen({z, x: 0});
    context.moveTo(Math.round(screen.x) + 0.5, 0);
    context.lineTo(Math.round(screen.x) + 0.5, height);
  }
  for (let x = Math.ceil(visible.minX / step) * step; x <= visible.maxX; x += step) {
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

function strokeComparisonGeometry(surface, items, bounds, scale, side) {
  const toScreen = drawComparisonGrid(surface, bounds, scale);
  if (state.compareLayers.matching) strokeComparisonItems(surface, items.filter((item) => !item.different), toScreen, COMPARISON_COLORS.matching, 1.1);
  if (state.compareLayers[side]) strokeComparisonItems(surface, items.filter((item) => item.different), toScreen, COMPARISON_COLORS[side], 1.4);
}

function strokeComparisonItems(surface, items, toScreen, color, lineWidth) {
  const {context} = surface;
  for (const item of items) {
    const points = (item.segment.points?.length ? item.segment.points : [item.segment.start, item.segment.end]).filter(Boolean).map(geometryDisplayPoint);
    if (points.length < 2) continue;
    const blocked = segmentVerificationBlocked(item.segment);
    context.beginPath();
    points.forEach((point, index) => {
      const screen = toScreen(point);
      if (index) context.lineTo(screen.x, screen.y); else context.moveTo(screen.x, screen.y);
    });
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.setLineDash(blocked ? [2, 2] : (item.segment.type === "rapid" ? [6, 4] : []));
    context.shadowColor = "transparent";
    context.shadowBlur = 0;
    context.stroke();
  }
  context.setLineDash([]);
  context.shadowBlur = 0;
}

function strokeComparisonOverlay(surface, geometry, bounds, scale) {
  const layers = overlayGeometryLayers(geometry);
  const toScreen = drawComparisonGrid(surface, bounds, scale);
  if (state.compareLayers.matching) {
    strokeComparisonItems(surface, layers.common, toScreen, COMPARISON_COLORS.matching, 1.1);
    strokeComparisonItems(surface, layers.blockedCommon, toScreen, COMPARISON_COLORS.matching, 1.1);
  }
  if (state.compareLayers.original) strokeComparisonItems(surface, layers.originalOnly, toScreen, COMPARISON_COLORS.original, 1.4);
  if (state.compareLayers.revised) strokeComparisonItems(surface, layers.revisedOnly, toScreen, COMPARISON_COLORS.revised, 1.4);
}

function renderComparisonGraphics() {
  if (!state.comparisonOriginal || elements.compareGraphicsAudit.hidden) return;
  const machine = currentMachineProfile();
  const options = {xMode: elements.xMode.value, arcChordTolerance: graphicsQuality().arcChordTolerance, ...machinePlotOptions(machine)};
  const originalPairings = state.comparisonOriginal.toolOffsetConfirmationScope
    === toolOffsetScopeFor(state.comparisonOriginal.content, state.comparisonOriginal.sourceFileName)
    ? state.comparisonOriginal.confirmedToolOffsetPairings : [];
  const originalParsed = parseGcode(state.comparisonOriginal.content, {...options,
    confirmedToolOffsetPairings: originalPairings});
  const revisedParsed = parseGcode(elements.input.value, {...options,
    confirmedToolOffsetPairings: toolOffsetPairingsForSource(elements.input.value)});
  const geometry = compareSegmentGeometry(originalParsed.segments, revisedParsed.segments, {
    originalCAxisMotions: originalParsed.cAxisMotions,
    revisedCAxisMotions: revisedParsed.cAxisMotions,
    originalUnresolvedOperations: originalParsed.liveToolAttempts,
    revisedUnresolvedOperations: revisedParsed.liveToolAttempts,
    originalParserWarnings: originalParsed.warnings,
    revisedParserWarnings: revisedParsed.warnings,
  });
  state.comparisonGeometry = geometry;
  const blockers = $("comparisonBlockers");
  blockers.replaceChildren();
  for (const [side, parsed] of [["Original", originalParsed], ["Revised", revisedParsed]]) {
    const issue = firstComparisonBlocker(parsed);
    if (!issue) continue;
    const item = document.createElement("li");
    item.textContent = `${side} · ${issue.line === null ? "whole program" : `line ${issue.line}`} · ${issue.reason}`;
    blockers.append(item);
  }
  blockers.hidden = !blockers.children.length;
  const originalLabel = `${geometry.originalOnly} original-only move${geometry.originalOnly === 1 ? "" : "s"}`;
  const revisedLabel = `${geometry.revisedOnly} new or altered move${geometry.revisedOnly === 1 ? "" : "s"}`;
  $("originalGeometryCount").textContent = originalLabel;
  $("revisedGeometryCount").textContent = revisedLabel;
  $("graphicsInfoDifferenceCount").textContent = `${geometry.revisedOnly} difference${geometry.revisedOnly === 1 ? "" : "s"}`;
  const noMotion = !geometry.original.length && !geometry.revised.length;
  $("graphicsVerdict").textContent = geometry.verificationUnresolved
    ? "PATH ONLY · comparison unresolved by blocked program behavior"
    : (noMotion
      ? "No comparable motion was parsed"
      : (geometry.originalOnly || geometry.revisedOnly ? `${geometry.revisedOnly} revised toolpath difference${geometry.revisedOnly === 1 ? "" : "s"}` : "Toolpaths match geometrically"));

  drawComparisonGraphics();
}

// View controls redraw the retained comparison; they never reparse or filter its results.
function drawComparisonGraphics() {
  const geometry = state.comparisonGeometry;
  if (!geometry || !state.comparisonOriginal || elements.compareGraphicsAudit.hidden) return;
  elements.compareZoomLevel.textContent = `${Math.round(state.compareCamera.zoom * 100)}%`;
  elements.compareZoomIn.disabled = state.compareCamera.zoom >= 128;
  elements.compareZoomOut.disabled = state.compareCamera.zoom <= 0.1;
  const fitMode = elements.fitGeometryPart.checked ? "part" : (elements.fitGeometryDifferences.checked ? "changed" : "all");
  const bounds = comparisonGeometryBounds(geometry, fitMode);
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, 0.001);
  const spanX = Math.max(bounds.maxX - bounds.minX, 0.001);
  if (state.compareGraphicsLayout === "overlay") {
    const overlaySurface = prepareComparisonCanvas(elements.overlayCompareCanvas);
    const scale = Math.min((overlaySurface.width - 28) / spanZ, (overlaySurface.height - 28) / spanX) * state.compareCamera.zoom;
    strokeComparisonOverlay(overlaySurface, geometry, bounds, scale);
    return;
  }
  const originalSurface = prepareComparisonCanvas(elements.originalCompareCanvas);
  const revisedSurface = prepareComparisonCanvas(elements.revisedCompareCanvas);
  const scale = Math.min(
    (Math.min(originalSurface.width, revisedSurface.width) - 28) / spanZ,
    (Math.min(originalSurface.height, revisedSurface.height) - 28) / spanX,
  ) * state.compareCamera.zoom;
  strokeComparisonGeometry(originalSurface, geometry.original, bounds, scale, "original");
  strokeComparisonGeometry(revisedSurface, geometry.revised, bounds, scale, "revised");
}

function resetComparisonDisplay() {
  stopComparisonDrag();
  state.compareLayers = {original: true, revised: true, matching: true};
  for (const control of [elements.compareOriginalToggle, elements.compareRevisedToggle, elements.compareMatchingToggle]) control.setAttribute("aria-pressed", "true");
  state.compareCamera = {zoom: 1, offsetZ: 0, offsetX: 0};
  state.compareViewport = null;
}

function fitComparisonGraphics() {
  stopComparisonDrag();
  state.compareCamera = {zoom: 1, offsetZ: 0, offsetX: 0};
  drawComparisonGraphics();
}

function stopComparisonDrag() {
  const drag = state.compareDrag;
  state.compareDrag = null;
  if (!drag) return;
  drag.canvas.classList.remove("is-panning");
  if (drag.canvas.hasPointerCapture(drag.pointerId)) drag.canvas.releasePointerCapture(drag.pointerId);
}

function zoomComparisonGraphics(factor, canvas = null, event = null) {
  if (!state.compareViewport) return;
  stopComparisonDrag();
  const camera = state.compareCamera;
  const zoom = Math.max(0.1, Math.min(128, camera.zoom * factor));
  if (canvas && event) {
    const rect = canvas.getBoundingClientRect();
    const adjustment = (1 - camera.zoom / zoom) / state.compareViewport.scale;
    camera.offsetZ += (event.clientX - rect.left - rect.width / 2) * adjustment;
    camera.offsetX += (rect.height / 2 - event.clientY + rect.top) * adjustment;
  }
  camera.zoom = zoom;
  drawComparisonGraphics();
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
  if (state.compareView === "graphics") requestAnimationFrame(drawComparisonGraphics);
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
  requestAnimationFrame(drawComparisonGraphics);
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
  if (isMillMode()) {
    elements.status.textContent = "Program comparison is not yet qualified for native XYZ mill geometry.";
    return;
  }
  renderComparison();
  elements.compareDialog.showModal();
}

function isMillMode() { return elements.machineMode?.value === "mill"; }
function applyMachineModeUi({refreshView = true} = {}) {
  const mill = isMillMode();
  document.body.dataset.machineMode = mill ? "mill" : "lathe";
  elements.latheMachineSelectRow.hidden = mill;
  elements.millSetupIdentity.hidden = !mill;
  elements.latheOrientationControl.hidden = mill;
  elements.latheXModeControl.hidden = mill;
  elements.latheSetupControls.hidden = mill;
  elements.millSetupBoundary.hidden = !mill;
  elements.importGeometry.hidden = mill;
  elements.importStep.hidden = mill;
  elements.compare.hidden = mill;
  elements.viewFace.hidden = mill;
  elements.toolOverlay.hidden = mill;
  elements.toolVerificationBadge.hidden = mill;
  elements.dimensionButton.hidden = mill;
  elements.clearDimensionsButton.hidden = mill;
  elements.latheReadout.hidden = mill;
  elements.millReadout.hidden = !mill;
  elements.millViewStatus.hidden = !mill;
  elements.optionalStopControl.hidden = mill;
  elements.view2d.textContent = mill ? "Top" : "2D";
  elements.view2d.title = mill ? "Show the native X/Y command-centerline projection" : "Show the X/Z lathe backplot";
  for (const item of document.querySelectorAll("[data-lathe-legend]")) item.hidden = mill;
  $("operationModeLabel").textContent = mill ? "MILL TOOLPATH" : "LIVE TOOL";
  $("stockStatusLabel").textContent = mill ? "STOCK MODEL" : "STOCK SIMULATION";
  $("clearanceStatusLabel").textContent = mill ? "COLLISION" : "CLEARANCE";
  elements.workspaceSafetyNote.textContent = mill
    ? "Command-centerline preview only — cutter size, compensation, work-offset transforms, stock, fixtures, machine travel, and collision are not modeled. Prove out with the control's approved process."
    : "Preview only — the keep-out is a tool-point envelope, not full machine collision verification. Prove out with the control's approved process.";
  if (mill && state.viewMode === "face") state.viewMode = "2d";
  if (mill) {
    state.geometrySelection = null;
    state.geometryHover = null;
    state.dimensionMode = false;
    resetGeometryInspectorDom();
  }
  updateProgramUnitsHint();
  if (refreshView) setGraphicsDimension(state.viewMode);
}
function xScale() { return elements.xMode.value === "diameter" ? 0.5 : 1; }
function orientationSign() { return elements.orientation.value === "left" ? 1 : -1; }
function unitScale() { return scaleForUnits(elements.displayUnits.value); }
function unitName() { return elements.displayUnits.value === "inch" ? "in" : "mm"; }
function displayValue(mm) { return mm / unitScale(); }
function preciseDisplayInput(mm) {
  const value = displayValue(mm);
  return Number.isFinite(value) ? String(Number(value.toPrecision(17))) : "";
}
function retainStepCoordinate(control, mm) {
  const displayed = preciseDisplayInput(mm);
  control.value = displayed;
  control.dataset.canonicalMm = String(mm);
  control.dataset.canonicalDisplayValue = displayed;
}
function retainStepCoordinateMapping(mapping) {
  for (const [control, key] of [
    [elements.stepPlaneOffset, "planeOffsetMm"], [elements.stepAxialOrigin, "axialOriginMm"], [elements.stepRadialOrigin, "radialOriginMm"],
  ]) retainStepCoordinate(control, mapping[key]);
}
function millDisplayDecimals() { return elements.displayUnits.value === "inch" ? 5 : 4; }
function setupValue(input) {
  if (appliedStockSetup && stockSetupKeys[input.id]) return appliedStockSetup[stockSetupKeys[input.id]];
  return (Number(input.value) || 0) * unitScale();
}
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
function isRapidMotion(segment) {
  return segment?.type === "rapid" || segment?.type === "live-rapid";
}
function liveToolSegments(segments = state.parsed.segments) {
  return (segments || []).filter((segment) => isLiveToolSegment(segment));
}
function liveToolOperations(parsed = state.parsed) {
  const attempts = Array.isArray(parsed?.liveToolAttempts) ? parsed.liveToolAttempts : [];
  if (attempts.length) return attempts;
  return liveToolSegments(parsed?.segments).map((segment) => ({
    line: segment.executionLine || segment.line || null,
    rapid: isRapidMotion(segment),
    displayed: true,
    blocked: Boolean(segment.verificationBlocked || segment.liveToolBlocked),
  }));
}
function liveToolOperationSummary(parsed = state.parsed) {
  const operations = liveToolOperations(parsed);
  return {
    operations,
    displayed: operations.filter((operation) => operation.displayed === true),
    blocked: operations.filter((operation) => operation.blocked === true),
    notDisplayed: operations.filter((operation) => operation.displayed !== true),
  };
}
function hasLiveToolCut(segments = state.parsed.segments) {
  if (segments === state.parsed.segments) {
    return liveToolOperations().some((operation) => operation.rapid !== true)
      || (state.parsed.cAxisMotions || []).some((motion) => motion?.type !== "rapid-index");
  }
  return liveToolSegments(segments).some((segment) => !isRapidMotion(segment));
}
function updateLiveToolStatus(profile = currentMachineProfile()) {
  const {operations, displayed, blocked, notDisplayed} = liveToolOperationSummary();
  const status = elements.liveToolStatus;
  status.className = "muted-value";
  if (operations.length) {
    const parts = [`${displayed.length} PATH${displayed.length === 1 ? "" : "S"}`];
    if (blocked.length) parts.push(`${blocked.length} BLOCKED`);
    if (notDisplayed.length) parts.push(`${notDisplayed.length} NOT DRAWN`);
    status.textContent = parts.join(" · ");
    status.className = blocked.length ? "danger-value" : (notDisplayed.length ? "warning-value" : "live-value");
    status.title = `${displayed.length} programmed live-tool centerline path${displayed.length === 1 ? " is" : "s are"} drawable. ${blocked.length} operation${blocked.length === 1 ? " is" : "s are"} blocked; ${notDisplayed.length} operation${notDisplayed.length === 1 ? " has" : "s have"} no drawable segment. Supported axial-bore stock removal is reported separately; full driven-tool collision sweeps remain path-only.`;
    return;
  }
  if (profile?.liveToolCapability === "not-equipped") {
    status.textContent = "NOT EQUIPPED";
    status.title = "The selected machine profile says live tooling is not equipped.";
  } else if (profile?.liveToolCapability === "equipped" && profile?.liveToolDialect !== "unconfigured") {
    status.textContent = "0 PATHS";
    status.className = "live-value";
    status.title = "The selected machine profile has a configured live-tool dialect; this program has no live-tool paths.";
  } else {
    status.textContent = "UNKNOWN";
    status.title = "Live-tool capability or controller dialect is not configured for the selected machine profile.";
  }
}
function isToolSetupStockWarning(warning) {
  return typeof warning?.code === "string"
    && (warning.code.startsWith("tool-") || warning.code === "nominal-thread-tool-required");
}

function updateStockRemovedStatus(stock, fallback = null) {
  const output = $("stockRemoved");
  output.className = "";
  if (!fallback && state.programDirty) fallback = "PLOT REQUIRED";
  if (fallback) {
    output.textContent = fallback;
    const fallbackDetails = {
      OFF: ["Stock removal simulation is off.", ""],
      "PLOT REQUIRED": ["The program changed. Plot it before using any stock result.", "warning-value"],
      "SET STOCK": ["Enter a positive stock diameter and overall length.", "danger-value"],
      BLOCKED: ["Stock removal simulation is blocked.", "danger-value"],
    };
    const [title, className] = fallbackDetails[fallback] || ["Stock removal simulation is blocked.", "danger-value"];
    output.title = title;
    output.className = className;
    return;
  }
  const removed = `${stock.removedPercent.toFixed(1)}%`;
  const liveSummary = summarizeAxialFlatBoreStock(stock.liveStock);
  const turningBlockedCuts = Math.max(0, Number(stock.turningBlockedCuts) || 0);
  const turningModeledCuts = Math.max(0, Number(stock.turningModeledCuts) || 0);
  const programBlockers = (state.parsed.warnings || []).filter((warning) => warning?.verificationBlocked === true);
  if (turningBlockedCuts || programBlockers.length) {
    const warning = (stock.toolWarnings || []).find((entry) => entry?.code !== "live-tool-stock-removal-unsupported")
      || programBlockers[0]
      || null;
    const labels = {
      "tool-unassigned": `ASSIGN ${warning?.toolKey || "TOOL"}`,
      "tool-removal-unconfirmed": `CONFIRM ${warning?.toolKey || "TOOL"}`,
      "tool-removal-unsupported": `${warning?.toolKey || "TOOL"} NOT MODELED`,
      "tool-datum-unresolved": `SET ${warning?.toolKey || "TOOL"} DATUM`,
      "tool-direction-blocked": `CHECK ${warning?.toolKey || "TOOL"} DIRECTION`,
      "tool-arc-sweep-unsupported": "ARC SWEEP NOT MODELED",
      "verification-blocked-stock-removal": "PROGRAM BLOCKED",
    };
    const reason = !turningBlockedCuts && programBlockers.length
      ? "PROGRAM BLOCKED"
      : labels[warning?.code] || "REVIEW SETUP";
    const modeledLiveCut = liveSummary.status === LIVE_STOCK_STATUS.MODELED;
    if (turningModeledCuts || modeledLiveCut) {
      const livePercent = modeledLiveCut
        ? ` · ${Math.max(0, Number(stock.liveRemovedPercent) || 0).toFixed(2)}% LIVE BORE`
        : "";
      output.textContent = `${removed} TURN${livePercent} · PARTIAL`;
      output.className = "warning-value";
    } else {
      output.textContent = `BLOCKED · ${reason}`;
      output.className = !programBlockers.length && isToolSetupStockWarning(warning)
        ? "warning-value"
        : "danger-value";
    }
    const blockedDetail = turningBlockedCuts
      ? `${turningBlockedCuts} turning cut${turningBlockedCuts === 1 ? " was" : "s were"} blocked.`
      : `${programBlockers.length} program verification issue${programBlockers.length === 1 ? " blocks" : "s block"} a complete stock result.`;
    output.title = `${turningModeledCuts} turning cut${turningModeledCuts === 1 ? " was" : "s were"} modeled; ${blockedDetail}${warning?.message ? ` ${warning.message}` : ""}`;
    return;
  }
  if (liveSummary.status === LIVE_STOCK_STATUS.MODELED) {
    const livePercent = `${Math.max(0, Number(stock.liveRemovedPercent) || 0).toFixed(2)}%`;
    output.textContent = `${removed} TURN · ${livePercent} LIVE BORE`;
    output.className = "live-value";
    output.title = `${liveSummary.label}. Turning and live-bore percentages are reported separately against the original cylindrical stock; no cutter-holder collision claim is included.`;
    return;
  }
  if (hasLiveToolCut() || liveSummary.status === LIVE_STOCK_STATUS.PATH_ONLY) {
    output.textContent = `${removed} · PATH ONLY`;
    output.className = "warning-value";
    output.title = liveSummary.axialBoreCount
      ? `${liveSummary.label}. Supported bores are displayed, but at least one live cut remains outside the bounded analytic model.`
      : "The percentage includes supported axisymmetric turning removal only. Live-tool centerlines are displayed, but this live operation is outside the bounded axial-bore model.";
    return;
  }
  output.textContent = stock.nominalModeledCuts > 0 || stock.compensatedModeledCuts > 0 ? `${removed} · NOMINAL` : removed;
  output.title = "Estimated axisymmetric stock removed by supported, confirmed turning tools. Nominal cutter models do not establish physical accuracy or holder clearance. Thread sections are not a helical thread-form verification.";
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
  if (state.viewMode === "face") {
    draw();
    return;
  }
  if (isMillMode()) {
    draw();
    return;
  }
  const rect = elements.wrap.getBoundingClientRect();
  // Dimension inspection frames the setup, not distant tool-change/rapid moves.
  const inspectingStock = $("stockDimensionsToggle").checked && appliedStockSetup;
  let bounds = inspectingStock ? {
    minZ: Math.min(appliedStockSetup.startZ, appliedStockSetup.faceZ - collisionOptions().chuckDepth, 0),
    maxZ: Math.max(appliedStockSetup.frontZ, 0),
    minX: -Math.max(appliedStockSetup.diameter, collisionOptions().jawDiameter) / 2,
    maxX: Math.max(appliedStockSetup.diameter, collisionOptions().jawDiameter) / 2,
  } : boundsIncludingStock();
  const homeEstimate = inspectingStock ? null : displayHomeEstimate(currentMachineProfile());
  if (homeEstimate) {
    bounds = mergeBounds(bounds, {minX: homeEstimate.x, maxX: homeEstimate.x,
      minZ: homeEstimate.z, maxZ: homeEstimate.z});
  }
  if (!bounds || !rect.width || !rect.height) return;
  const zSpan = Math.max(10, bounds.maxZ - bounds.minZ);
  const xSpan = Math.max(10, bounds.maxX - bounds.minX);
  const dimensionPadding = $("stockDimensionsToggle").checked ? 180 : 80;
  state.camera.scale = Math.max(homeEstimate ? 0.0001 : 1, Math.min((rect.width - dimensionPadding) / zSpan, (rect.height - dimensionPadding) / xSpan));
  const displayCenterZ = (bounds.minZ + bounds.maxZ) / 2 * orientationSign();
  const centerX = (bounds.minX + bounds.maxX) / 2;
  state.camera.offsetX = rect.width / 2 - displayCenterZ * state.camera.scale;
  state.camera.offsetY = rect.height / 2 + centerX * state.camera.scale;
  state.camera.fitted = true;
  draw();
}

function mergeBounds(first, second) {
  if (!first) return second ? {...second} : null;
  if (!second) return {...first};
  return {
    minX: Math.min(first.minX, second.minX),
    maxX: Math.max(first.maxX, second.maxX),
    minZ: Math.min(first.minZ, second.minZ),
    maxZ: Math.max(first.maxZ, second.maxZ),
  };
}

function boundsIncludingStock() {
  if (isMillMode()) return millProgramBounds(state.parsed.segments);
  let bounds = programBounds(state.parsed.segments, xScale());
  if (state.referenceGeometry?.ready && elements.referenceGeometryToggle.checked) {
    bounds = mergeBounds(bounds, state.referenceGeometry.mapped.bounds);
  }
  if (elements.collisionToggle.checked) {
    const keepout = collisionOptions();
    const jawRadius = keepout.jawDiameter / 2 + keepout.clearance;
    const chuckBounds = {minX: -jawRadius, maxX: jawRadius, minZ: keepout.chuckFaceZ - keepout.chuckDepth - keepout.clearance, maxZ: keepout.chuckFaceZ + keepout.clearance};
    bounds = mergeBounds(bounds, chuckBounds);
  }
  if (!elements.stockToggle.checked) return bounds;
  const radius = Math.max(0, setupValue(elements.stockDiameter)) / 2;
  const length = Math.max(0, setupValue(elements.stockLength));
  const axial = configuredStockBounds(length);
  const stock = {minX: -radius, maxX: radius, minZ: axial.startZ, maxZ: axial.endZ};
  return mergeBounds(bounds, stock);
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

function stockWithLiveBores(stock, visibleCount, visibleSourceLine = state.programLine) {
  if (!stock) return stock;
  const liveStock = buildAxialFlatBoreStock(state.parsed.segments, {
    stock,
    visibleCount,
    cutterResolver: resolvedCuttingModel,
    unresolvedOperations: state.parsed.liveToolAttempts || [],
    visibleSourceLine,
  });
  const initialVolume = Math.PI * stock.radius * stock.radius * stock.length;
  return {
    ...stock,
    axialBores: liveStock.axialBores,
    liveStock,
    liveRemovedPercent: initialVolume > 0 ? liveStock.removedVolume / initialVolume * 100 : 0,
  };
}

function stockProfileFor(
  stockDiameter,
  stockLength,
  visibleCount = state.visibleBlocks,
  visibleSourceLine = state.programLine,
) {
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
    pilotBoreDiameter: setupValue($("stockPilotBore")),
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
      pilotBoreDiameter: key.pilotBoreDiameter,
      xScale: key.xScale,
      visibleCount: 0,
      columns: key.verificationColumns,
      toolResolver: resolvedCuttingModel,
    });
    state.stockProfileCache = {key, frames: new Map([[0, base]])};
  }

  const target = Math.max(0, Math.min(state.parsed.segments.length, visibleCount));
  const frames = state.stockProfileCache.frames;
  if (frames.has(target)) return stockWithLiveBores(frames.get(target), target, visibleSourceLine);
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
  return stockWithLiveBores(stock, target, visibleSourceLine);
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
  if (state.referenceGeometry?.ready && elements.referenceGeometryToggle.checked) {
    entities.push(...state.referenceGeometry.entities);
  }
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

function drawAxialBoreSections2d(stock) {
  for (const bore of stock?.axialBores || []) {
    const offset = Math.abs(Number(bore.centerY) || 0);
    const radius = Number(bore.radius) || 0;
    if (!(radius > 0) || offset >= radius) continue;
    const halfSection = Math.sqrt(Math.max(0, radius * radius - offset * offset));
    const section = screenRect(
      bore.bottomZ,
      bore.frontZ,
      bore.centerX - halfSection,
      bore.centerX + halfSection,
    );
    ctx.fillStyle = "rgba(2, 11, 14, .98)";
    ctx.fillRect(section.x, section.y, section.width, section.height);
    const upperFront = worldToScreen({z: bore.frontZ, x: (bore.centerX + halfSection) / xScale()});
    const upperBottom = worldToScreen({z: bore.bottomZ, x: (bore.centerX + halfSection) / xScale()});
    const lowerFront = worldToScreen({z: bore.frontZ, x: (bore.centerX - halfSection) / xScale()});
    const lowerBottom = worldToScreen({z: bore.bottomZ, x: (bore.centerX - halfSection) / xScale()});
    ctx.beginPath();
    ctx.moveTo(upperFront.x, upperFront.y);
    ctx.lineTo(upperBottom.x, upperBottom.y);
    ctx.lineTo(lowerBottom.x, lowerBottom.y);
    ctx.lineTo(lowerFront.x, lowerFront.y);
    ctx.strokeStyle = "#7ce5dc";
    ctx.lineWidth = 1.15;
    ctx.stroke();
  }
}

function drawStock() {
  if (!elements.stockToggle.checked) {
    updateStockRemovedStatus(null, "OFF");
    return;
  }
  if (state.programDirty) {
    updateStockRemovedStatus(null, "PLOT REQUIRED");
    return;
  }
  const stockDiameter = Math.max(0, setupValue(elements.stockDiameter));
  const length = Math.max(0, setupValue(elements.stockLength));
  const radius = stockDiameter / 2;
  if (!radius || !length) {
    updateStockRemovedStatus(null, "SET STOCK");
    return;
  }
  const stock = stockProfileFor(stockDiameter, length);
  if (!stock) {
    updateStockRemovedStatus(null, "BLOCKED");
    return;
  }
  updateStockRemovedStatus(stock);

  const envelope = screenRect(stock.startZ, stock.endZ, -radius, radius);
  ctx.fillStyle = "rgba(245, 158, 11, 0.025)";
  ctx.fillRect(envelope.x, envelope.y, envelope.width, envelope.height);

  if (hasStockCavities(stock)) {
    try {
      const polygons = stockSectionPolygons(stock);
      ctx.fillStyle = "rgba(56, 189, 248, 0.18)";
      ctx.strokeStyle = "rgba(86, 204, 220, 0.7)";
      ctx.lineWidth = 0.9;
      for (const polygon of polygons) {
        for (const sign of [1, -1]) {
          ctx.beginPath();
          polygon.forEach((point, index) => {
            const screen = geometryToScreen({z: point.z, x: sign * point.radius});
            if (index) ctx.lineTo(screen.x, screen.y); else ctx.moveTo(screen.x, screen.y);
          });
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      }
    } catch (error) {
      $("stockRemoved").textContent = "STOCK DISPLAY BLOCKED";
      $("stockRemoved").className = "danger-value";
      $("stockRemoved").title = error.message;
    }
    ctx.strokeStyle = "rgba(56, 189, 248, 0.34)";
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(envelope.x, envelope.y, envelope.width, envelope.height);
    ctx.setLineDash([]);
    drawAxialBoreSections2d(stock);
    return;
  }

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
  drawAxialBoreSections2d(stock);
}

function drawStockSetupDimensions(width, height) {
  const all = $("stockDimensionsToggle").checked;
  if (!appliedStockSetup || (!all && !stockDimensionFocus)) return;
  const stock = appliedStockSetup;
  const project = (z, radius = 0) => geometryToScreen({z, x: radius});
  const rear = project(stock.startZ), jaw = project(stock.faceZ), front = project(stock.frontZ), zero = project(0);
  const top = project(stock.frontZ, stock.diameter / 2).y;
  const bottom = project(stock.frontZ, -stock.diameter / 2).y;
  const shown = (key) => all || stockDimensionFocus === key;
  const label = (value) => `${displayValue(value).toFixed(unitName() === "in" ? 5 : 4)} ${unitName()}`;
  ctx.save();
  ctx.strokeStyle = "#91ded0"; ctx.fillStyle = "#b6f2e7";
  ctx.lineWidth = 1; ctx.setLineDash([]);
  ctx.font = '11px "Cascadia Code", Consolas, monospace';
  const line = (a, b) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
  const text = (value, x, y) => {
    const w = ctx.measureText(value).width;
    x = Math.max(w / 2 + 6, Math.min(width - w / 2 - 6, x));
    y = Math.max(16, Math.min(height - 12, y));
    ctx.fillStyle = "#071719"; ctx.fillRect(x - w / 2 - 4, y - 11, w + 8, 16);
    ctx.fillStyle = "#b6f2e7"; ctx.textAlign = "center"; ctx.fillText(value, x, y);
  };
  const arrow = (a, b) => {
    line(a, b);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 2) return;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    for (const [point, direction] of [[a, angle], [b, angle + Math.PI]]) {
      for (const side of [-0.45, 0.45]) line(point, {x: point.x + 6 * Math.cos(direction + side), y: point.y + 6 * Math.sin(direction + side)});
    }
  };
  const axial = (a, b, y, value, labelOffset = 0) => {
    line({x: a.x, y: bottom + 3}, {x: a.x, y: y + 5});
    line({x: b.x, y: bottom + 3}, {x: b.x, y: y + 5});
    arrow({x: a.x, y}, {x: b.x, y});
    text(value, (a.x + b.x) / 2, y - 6 + labelOffset);
  };
  // Original blank outline, not the machined profile; drawing pixels have no
  // dimensional authority. Every annotation comes from the applied mm setup.
  ctx.globalAlpha = 0.7;
  ctx.setLineDash([3, 4]);
  ctx.strokeRect(Math.min(rear.x, front.x), top, Math.abs(front.x - rear.x), bottom - top);
  line({x: jaw.x, y: top - 8}, {x: jaw.x, y: bottom + 8});
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  const row = Math.min(bottom + 26, height - 70);
  if (shown("gripLength")) axial(rear, jaw, row, `Grip ${label(stock.gripLength)}`);
  if (shown("stickoutLength")) axial(jaw, front, row + (all ? 22 : 0), `Stick-out ${label(stock.stickoutLength)}`);
  if (all) axial(rear, front, row + 48, `Overall ${label(stock.length)}`);
  if (shown("diameter")) {
    const x = Math.max(18, Math.min(width - 18, front.x + orientationSign() * 28));
    line({x: front.x, y: top}, {x, y: top}); line({x: front.x, y: bottom}, {x, y: bottom});
    arrow({x, y: top}, {x, y: bottom}); text(`Bar Ø ${label(stock.diameter)}`, x, (top + bottom) / 2);
  }
  if (shown("frontZ")) {
    const y = Math.max(32, top - 32);
    line({x: front.x, y: top}, {x: front.x, y});
    ctx.setLineDash([3, 4]); line({x: zero.x, y: top}, {x: zero.x, y}); ctx.setLineDash([]);
    arrow({x: zero.x, y}, {x: front.x, y});
    text(`Front Z ${stock.frontZ > 0 ? "+" : ""}${label(stock.frontZ)} · from Z0`, (zero.x + front.x) / 2, y - 8);
  }
  ctx.restore();
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
    mountingOrientation: assignment.mountingOrientation || null,
    requiredSpindleDirection: assignment.requiredSpindleDirection || null,
    cuttingModel: {
      ...definition.cuttingModel,
      tipDatum: assignment.tipDatum || definition.cuttingModel?.tipDatum || null,
      axialDirection: assignment.axialDirection || definition.cuttingModel?.axialDirection || null,
      nominalAccepted: assignment.nominalAccepted === true,
      nominalModelRef: assignment.nominalModelRef || null,
      wallSide: assignment.wallSide || null,
    },
  };
}

function toolAssignmentReadiness(toolKey) {
  const assignment = state.toolAssignments[toolKey];
  if (!toolAssignmentAssemblyRef(assignment)) return {status: "unassigned", ready: false, errors: ["No tool selected."]};
  const configured = configuredToolAssembly2d(toolKey);
  if (!configured) return {status: "blocked", ready: false, errors: ["The selected tool definition is unavailable."]};
  if (configured.displayOnly === true) {
    const display = buildToolAssemblyDisplay2d(configured, {z: 0, x: 0});
    return {status: "display-only", ready: false, configured,
      errors: display.valid ? [configured.cuttingModel.blockedReason] : display.errors};
  }
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

function applyProgramNoseCompensation() {
  if (isMillMode() || !state.parsed.commandedSegments) return;
  const result = compensateLathePath(state.parsed.commandedSegments, {xScale: xScale(),
    setupResolver: segment => ({...state.toolAssignments[segment.toolKey],
      cuttingModel: resolvedCuttingModel(segment.toolKey)})});
  state.parsed.segments = result.segments;
  state.parsed.noseCompensation = result;
  state.parsed.warnings = state.parsed.commandedWarnings.filter(warning => warning.code !== 'tool-nose-compensation-pending'
    || result.segments.some(segment => segment.compensationPending && (segment.line === warning.line || segment.executionLine === warning.line)));
  state.parsed.warnings.push(...result.issues.map(issue => ({...issue, danger: true, verificationBlocked: true})));
  if (result.modeledCount) state.parsed.warnings.push({line: null, info: true,
    message: 'G41/G42 shows the resolved nominal NOSE-CENTER path. Stock and part-entry checks sweep its actual nose circle; drawing deviation uses the original commanded contour. Full insert/holder and physical machine accuracy remain unqualified.'});
}

// Cache the whole plotted program, not just the currently displayed spindle state.
// In particular, a final M5 must not erase an earlier cutting rotation mismatch.
let toolRotationReportCache = null;
function toolRotationReport() {
  if (isMillMode() || state.programDirty) return {segments: new Set(), first: null, warnings: []};
  if (toolRotationReportCache?.parsed === state.parsed
    && toolRotationReportCache.revision === state.toolAssignmentRevision) return toolRotationReportCache;
  const report = {parsed: state.parsed, revision: state.toolAssignmentRevision, segments: new Set(), first: null, warnings: []};
    const models = new Map();
  const warningKeys = new Set();
  (state.parsed.segments || []).forEach((segment, blockIndex) => {
    if (isRapidMotion(segment) || isLiveToolSegment(segment) || !segment.toolKey) return;
    if (!models.has(segment.toolKey)) models.set(segment.toolKey, configuredToolAssembly2d(segment.toolKey));
    const model = models.get(segment.toolKey);
    if (!model?.mountingRequired) return;
    const nominalReadiness = model.cuttingModel?.mode === "nominal-lathe" ? toolAssignmentReadiness(segment.toolKey) : null;
    const issue = model.displayOnly === true
      ? {code: "tool-stock-model-unavailable", message: model.cuttingModel.blockedReason,
        title: model.geometryKind === "diamond-boring" ? "DISPLAY ONLY — NO ID STOCK REMOVAL" : "DISPLAY ONLY — STOCK REMOVAL UNAVAILABLE"}
      : !["standard", "flipped"].includes(model.mountingOrientation)
      ? {code: "tool-mounting-unset", message: "Choose the installed mounting orientation and reconfirm this tool setup."}
      : nominalReadiness && !nominalReadiness.ready
      ? {code: "tool-nominal-setup-required", message: nominalReadiness.errors[0]}
      : turningSpindleIssue(model, {direction: segment.spindleDirection, running: segment.spindleRunning});
    if (!issue) return;
    report.segments.add(segment);
    const entry = {...issue, toolKey: segment.toolKey, line: segment.executionLine || segment.line, sourceLine: segment.line, blockIndex};
    report.first ||= entry;
    const warningKey = `${segment.toolKey}:${issue.code}`;
    if (!warningKeys.has(warningKey)) {
      warningKeys.add(warningKey);
      report.warnings.push({line: entry.line, message: `${entry.toolKey}: ${issue.message} Stock removal is blocked on affected cutting moves.`});
    }
  });
  toolRotationReportCache = report;
  return report;
}

function updateToolRotationAlert() {
  const report = toolRotationReport();
  const first = report.first || (!state.programDirty && state.stockCuttingWarning);
  elements.toolRotationAlert.hidden = !first || state.solidSetupActive === true;
  if (!first) return;
  elements.toolRotationAlertTitle.textContent = first.code === "tool-stock-model-unavailable"
    ? first.title
    : first.code === "tool-spindle-mismatch"
    ? "TOOL ROTATION MISMATCH"
    : ["tool-mounting-unset", "tool-spindle-required", "tool-nominal-setup-required"].includes(first.code)
      ? "TOOL SETUP REQUIRED" : first === state.stockCuttingWarning ? "STOCK CUTTING BLOCKED" : "CUTTING SPINDLE NOT READY";
  const count = report.first ? report.segments.size : first.blockedCuts;
  elements.toolRotationAlertMessage.textContent = `${first.toolKey || "Stock"} · line ${first.line || "—"}: ${first.message} Stock removal blocked on ${count} cutting block${count === 1 ? "" : "s"}.`;
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
  const firstUnassignedMotion = (state.parsed.segments || []).find((segment) => !isRapidMotion(segment) && !isLiveToolSegment(segment) && !segment.toolKey);
  if (firstUnassignedMotion) {
    warnings.push({
      line: firstUnassignedMotion.executionLine || firstUnassignedMotion.line || null,
      message: "A cutting move occurs before any executable T call. Its tool-dependent stock removal is blocked.",
    });
  }
  const turningToolKeys = new Set((state.parsed.segments || [])
    .filter((segment) => !isLiveToolSegment(segment) && !isRapidMotion(segment) && segment.toolKey)
    .map((segment) => segment.toolKey));
  warnings.push(...[...new Set((state.parsed.executableToolCalls || []).map((call) => call.key))].filter((toolKey) => turningToolKeys.has(toolKey)).flatMap((toolKey) => {
    const readiness = toolAssignmentReadiness(toolKey);
    if (readiness.ready) {
      const model = readiness.model.cuttingModel;
      if (model.mode !== "axial-band") return [];
      const messages = [];
      for (const segment of state.parsed.segments.filter((entry) => entry.toolKey === toolKey && entry.type !== "rapid")) {
        const sourceMotion = segment.sourceMotion || segment.type;
        if (sourceMotion === "arc-cw" || sourceMotion === "arc-ccw") {
          messages.push({line: segment.executionLine || segment.line, message: `${toolKey} uses a finite-width cutter on an arc. Exact swept-arc stock removal is not yet supported, so that cut is blocked.`});
          continue;
        }
        const deltaZ = segment.end.z - segment.start.z;
        const allowed = model.axialDirection === "both"
          || Math.abs(deltaZ) <= 1e-9
          || (model.axialDirection === "positive-z" && deltaZ > 0)
          || (model.axialDirection === "negative-z" && deltaZ < 0);
        if (!allowed) messages.push({line: segment.executionLine || segment.line, message: `${toolKey} is not confirmed for this Z cutting direction; stock removal is blocked for this move.`});
      }
      return messages;
    }
    const first = toolCallsForKey(toolKey)[0];
    const message = readiness.status === "unassigned"
      ? `${toolKey} is unassigned. Its motion remains visible, but stock removal is blocked until the program tool is selected.`
      : readiness.status === "display-only" ? `${toolKey}: ${readiness.errors[0]}`
        : `${toolKey} tool definition is incomplete: ${readiness.errors[0]}`;
    return [{line: first?.line || null, message}];
  }));
  warnings.push(...toolRotationReport().warnings);
  return warnings;
}

function invalidateToolAssignments({renderControls = true} = {}) {
  state.toolAssignmentRevision += 1;
  state.stockProfileCache = null;
  if (!state.programDirty) applyProgramNoseCompensation();
  updateReferenceComparison();
  renderReferenceGeometryUi();
  if (renderControls) renderProgramToolAssignments();
  updateStats();
  draw();
  schedulePersist();
}

function toolChoiceLabel(definition) {
  const status = TOOL_ASSEMBLY_2D_STATUS[definition.displayVerification || definition.verification]
    || TOOL_ASSEMBLY_2D_STATUS.unverified;
  return `${definition.name} · ${status} · ${definition.cuttingModel?.mode === "nominal-lathe" ? "NOMINAL CUTTING MODEL" : definition.displayOnly ? "DISPLAY ONLY — NO STOCK REMOVAL" : definition.geometryKind === "axial-milling-cutter" ? "CUTTER ONLY" : "2D OUTLINE"}`;
}

function selectField(labelText, values, selected, placeholder, onChange, accessibleName = labelText) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const select = document.createElement("select");
  select.setAttribute("aria-label", accessibleName);
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

function setupNumberField(labelText, valueMm, onChange, accessibleName = labelText) {
  const label = document.createElement('label');
  label.textContent = `${labelText} (${unitName()})`;
  const input = document.createElement('input');
  input.type = 'number'; input.step = 'any';
  input.value = Number.isFinite(valueMm) ? String(Number(displayValue(valueMm).toPrecision(15))) : '';
  input.setAttribute('aria-label', accessibleName);
  input.addEventListener('change', () => {
    const text = input.value.trim();
    onChange(text && Number.isFinite(Number(text)) ? Number(text) * unitScale() : null);
  });
  label.append(input);
  return label;
}

function renderLatheControllerSettings() {
  const body = $('latheControllerSettingsBody');
  body.replaceChildren();
  const machine = currentMachineProfile();
  const note = document.createElement('p'); note.className = 'program-tool-hint';
  if (machine?.liveToolDialect !== 'haas-lathe-ngc') {
    note.textContent = 'G76 and G41/G42 currently require the sourced Haas NGC controller profile. Generic/Fanuc and the draft Hardinge profile do not inherit Haas behavior.';
    body.append(note); return;
  }
  note.textContent = 'Straight radial G76: declared Settings 86/99, A0 and no chamfer. Enter the actual machine settings, including explicit zero. G41/G42 additionally needs the exact tool nose/offset setup below. Changes require Plot program.';
  body.append(note);
  const settings = latheControllerSettings(state.latheControllerSettings, machine.id);
  const change = patch => {
    state.latheControllerSettings = {...latheControllerSettings(state.latheControllerSettings, machine.id), ...patch};
    state.programRevision += 1;
    state.playing = false; state.programDirty = true; state.programEditOrigin = null;
    state.stockProfileCache = null;
    elements.status.textContent = 'Controller settings changed — plot to refresh';
    updateStockRemovedStatus(null, 'PLOT REQUIRED'); updateTransport();
    invalidateReferenceComparison('PLOT REQUIRED', 'Controller settings changed; plot again before using the reference result.');
    renderLatheControllerSettings(); schedulePersist();
  };
  body.append(setupNumberField('Setting 86 · thread finish allowance', settings.finishAllowanceMm,
    finishAllowanceMm => change({finishAllowanceMm}), 'G76 finish allowance'));
  body.append(setupNumberField('Setting 99 · minimum thread cut', settings.minimumCutMm,
    minimumCutMm => change({minimumCutMm}), 'G76 minimum cut'));
  body.append(selectField('Setting 232 · default G76 P', [
    ['1', 'P1 · constant area, single edge'], ['2', 'P2 · constant area, both edges'],
    ['3', 'P3 · constant depth, single edge'], ['4', 'P4 · constant depth, both edges'],
  ], settings.defaultP == null ? '' : String(settings.defaultP), 'Unknown · require explicit P in code',
  value => change({defaultP: value ? Number(value) : null})));
  body.append(selectField('Thread chamfer state', [['off', 'Known OFF · no chamfer']],
    settings.chamferEnabled === false ? 'off' : '', 'Unknown · require M24 in code',
    value => change({chamferEnabled: value === 'off' ? false : null})));
}

function renderNoseCompensationControls(controls, toolKey, assignment, definition) {
  if (!(definition?.cuttingModel?.mode === 'point' || definition?.cuttingModel?.operation === 'id-bore')) return;
  const details = document.createElement('details');
  state.noseCompensationOpenTools ||= new Set();
  details.open = state.noseCompensationOpenTools.has(toolKey);
  details.dataset.noseTool = toolKey;
  details.addEventListener('toggle', () => {
    if (!details.isConnected) return;
    if (details.open) state.noseCompensationOpenTools.add(toolKey);
    else state.noseCompensationOpenTools.delete(toolKey);
  });
  const summary = document.createElement('summary'); summary.textContent = 'G41/G42 · tool nose & offset'; details.append(summary);
  const config = assignment.noseCompensation || {};
  const change = patch => {
    const current = state.toolAssignments[toolKey];
    state.toolAssignments[toolKey] = reviseToolAssignmentSetup(current, {noseCompensation: {
      ...current.noseCompensation, contract: 'haas-lathe-ngc-nose-v1', accepted: false, ...patch}});
    invalidateToolAssignments();
  };
  const note = document.createElement('p'); note.className = 'program-tool-hint';
  note.textContent = 'Use the actual control offset values. Radius + radius wear defines the nominal nose circle. Tip direction is from nose center to the imaginary sharp tip in physical Z/X—not tool hand or spindle direction. Full insert and holder collision are not included.';
  details.append(note);
  for (const [field, label] of [['noseRadiusMm', 'Nose geometry radius'], ['radiusWearMm', 'Radius wear · enter 0 if none']]) {
    details.append(setupNumberField(label, config[field], value => change({[field]: value}), `${label} for ${toolKey}`));
  }
  const registerLabel = document.createElement('label'); registerLabel.textContent = 'Exact offset register · two digits';
  const register = document.createElement('input'); register.type = 'text'; register.maxLength = 2;
  register.value = config.offsetRegister || ''; register.setAttribute('aria-label', `Nose offset register for ${toolKey}`);
  register.addEventListener('change', () => change({offsetRegister: register.value.trim()}));
  registerLabel.append(register); details.append(registerLabel);
  const directions = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  const signed = n => n < 0 ? '−' : n > 0 ? '+' : '0';
  details.append(selectField('Nose center → imaginary tip', directions.map(([z,x]) => [`${z},${x}`, `${signed(z)}Z / ${signed(x)}X`]),
    config.tipDirection ? `${config.tipDirection.z},${config.tipDirection.x}` : '', 'Choose the actual tip orientation',
    value => { const [z,x] = value.split(',').map(Number); change({tipDirection: value ? {z,x} : null}); },
    `Nose tip direction for ${toolKey}`));
  details.append(selectField('Nose cutting side', [['od','Outside diameter'],['id','Inside diameter']], config.materialSide,
    'Choose OD or ID', value => change({materialSide: value || null}), `Nose material side for ${toolKey}`));
  details.append(selectField('Programmed X wall', [['positive-x','Positive X'],['negative-x','Negative X']], config.wallSide,
    'Choose the programmed wall', value => change({wallSide: value || null}), `Nose wall for ${toolKey}`));
  const label = document.createElement('label'); label.className = 'toggle-row';
  const accept = document.createElement('input'); accept.type = 'checkbox'; accept.checked = config.accepted === true;
  accept.setAttribute('aria-label', `Accept nose compensation for ${toolKey}`);
  accept.addEventListener('change', () => change({accepted: accept.checked}));
  const text = document.createElement('span'); text.textContent = 'Use this nose/offset setup, then reconfirm the tool';
  label.append(accept, text); details.append(label); controls.append(details);
}

function programToolSummaryText(keys) {
  const ready = keys.filter(key => toolAssignmentReadiness(key).ready).length;
  const displayOnly = keys.filter(key => toolAssignmentReadiness(key).status === "display-only").length;
  if (!keys.length) return "NO T CALLS";
  return displayOnly ? `${ready}/${keys.length} STOCK READY · ${displayOnly} DISPLAY ONLY` : `${ready}/${keys.length} READY`;
}

function renderProgramToolAssignments() {
  renderLatheControllerSettings();
  const calls = state.parsed.executableToolCalls || [];
  const keys = [...new Set(calls.map((call) => call.key))];
  elements.programToolList.replaceChildren();
  elements.programToolSummary.textContent = programToolSummaryText(keys);
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
    if (definition?.mountingRequired) {
      controls.append(selectField(
        "Mounting orientation",
        definition.mountingAxis === "program-z"
          ? [["standard", "Upper ID wall · bar toward +Z"], ["flipped", "Lower ID wall · roll 180° about Z"]]
          : [["standard", "Standard · insert down"], ["flipped", "Flipped 180° · insert up / back-facing"]],
        assignment.mountingOrientation,
        "Choose how this holder is installed",
        (mountingOrientation) => {
          state.toolAssignments[toolKey] = reviseToolAssignmentSetup(state.toolAssignments[toolKey], {
            mountingOrientation: mountingOrientation || null,
          });
          invalidateToolAssignments();
        },
        `Mounting orientation for ${toolKey}`,
      ));
      controls.append(selectField(
        "Required spindle direction · your setup",
        [["m3", "M3 · this mounted setup requires M3"], ["m4", "M4 · this mounted setup requires M4"]],
        assignment.requiredSpindleDirection,
        "Confirm required rotation on your machine",
        (requiredSpindleDirection) => {
          state.toolAssignments[toolKey] = reviseToolAssignmentSetup(state.toolAssignments[toolKey], {
            requiredSpindleDirection: requiredSpindleDirection || null,
          });
          invalidateToolAssignments();
        },
        `Required spindle direction for ${toolKey}`,
      ));
      const mountingHint = document.createElement("p");
      mountingHint.className = "program-tool-hint";
      mountingHint.textContent = definition.mountingAxis === "program-z"
        ? "Axial ID tool: choose the installed mounting and cutting wall. Rolling about Z changes radial offsets, not bar direction or catalog identity. M3/M4 never moves it. Starting bore must be entered in Stock; holder/bore clearance is not verified."
        : `${definition.hand === "left" ? "LH" : definition.hand === "right" ? "RH" : definition.hand === "neutral" ? "Neutral" : "Catalog"} holder identity stays fixed. Flip only to match its physical installation; then reconfirm rotation, cutting direction and tip reference. M3/M4 never moves the holder. Rotation is your machine/setup declaration, not inferred from tool hand.`;
      controls.append(mountingHint);
    }
    const datumChoices = definition?.cuttingModel?.tipDatumChoices || [];
    if (datumChoices.length) {
      controls.append(selectField(
        definition?.cuttingModel?.operation === "face-groove" ? "Programmed radial reference" : "Programmed cutting reference",
        datumChoices.map((value) => [value, ({
          "negative-z-edge": "Negative-Z cutting edge",
          center: "Insert center",
          "positive-z-edge": "Positive-Z cutting edge",
          "inner-edge": "Inner-radius cutting edge",
          "outer-edge": "Outer-radius cutting edge",
          "tip-center": "Rounded thread-tip centerline · X at tip",
          "programmed-contact-point": "Programmed contact point · no nose compensation",
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
    const wallSideChoices = definition?.cuttingModel?.wallSideChoices || [];
    if (wallSideChoices.length) {
      controls.append(selectField("Cutting wall", wallSideChoices.map((value) => [value,
        value === "positive-x" ? "Positive X · upper ID wall" : "Negative X · lower ID wall"]),
      assignment.wallSide, "Choose the programmed ID wall", (wallSide) => {
        state.toolAssignments[toolKey] = reviseToolAssignmentSetup(state.toolAssignments[toolKey], {wallSide: wallSide || null});
        invalidateToolAssignments();
      }, `Cutting wall for ${toolKey}`));
    }
    const directionChoices = definition?.cuttingModel?.axialDirectionChoices || [];
    if (directionChoices.length) {
      controls.append(selectField(
        "Permitted cutting direction",
        directionChoices.map((value) => [value, ({
          "positive-z": "Toward +Z (back turn)",
          "negative-z": "Toward −Z",
          "radial-only": "Radial plunge only",
          both: "Both +Z and −Z",
        })[value] || value]),
        assignment.axialDirection,
        `Confirm direction (suggested: ${definition.cuttingModel.recommendedAxialDirection || "none"})`,
        (axialDirection) => {
          state.toolAssignments[toolKey] = reviseToolAssignmentSetup(state.toolAssignments[toolKey], {
            axialDirection: axialDirection || null,
          });
          invalidateToolAssignments();
        },
        `Permitted cutting direction for ${toolKey}`,
      ));
    }
    const nominal = definition?.cuttingModel?.mode === "nominal-lathe";
    if (nominal) {
      const nominalNote = document.createElement("p");
      nominalNote.className = "program-tool-hint";
      nominalNote.textContent = definition.cuttingModel.operation.includes("thread")
        ? "THREAD SECTION ENVELOPE: nominal 60° rounded-tip profile on sourced Haas G32/G76 passes. G76 requires explicit controller settings. Not helical thread form, pitch-diameter inspection or holder clearance."
        : "NOMINAL CUTTER SIMULATION: uses published cutting dimensions and your programmed datum, independently of the holder CAD drawing. Physical insert tolerance, compensation and holder clearance are not verified.";
      controls.append(nominalNote);
      const nominalLabel = document.createElement("label");
      nominalLabel.className = "toggle-row";
      const nominalAccept = document.createElement("input");
      nominalAccept.type = "checkbox";
      nominalAccept.checked = assignment.nominalAccepted === true;
      nominalAccept.setAttribute("aria-label", `Use nominal cutting model for ${toolKey}`);
      nominalAccept.addEventListener("change", () => {
        state.toolAssignments[toolKey] = reviseToolAssignmentSetup(state.toolAssignments[toolKey], {
          nominalAccepted: nominalAccept.checked,
          nominalModelRef: definition.cuttingModel.nominalModelRef,
        });
        invalidateToolAssignments();
      });
      const labelText = document.createElement("span");
      labelText.textContent = "Use nominal cutting model with this datum";
      nominalLabel.append(nominalAccept, labelText);
      controls.append(nominalLabel);
    }
    renderNoseCompensationControls(controls, toolKey, assignment, definition);
    const confirmation = document.createElement("button");
    confirmation.type = "button";
    confirmation.className = "program-tool-confirmation";
    const requiredConfigurationComplete = Boolean(assignmentRef)
      && library.some((entry) => entry.id === assignmentRef.id && Number(entry.revision) === Number(assignmentRef.revision))
      && (!definition?.mountingRequired || (
        ["standard", "flipped"].includes(assignment.mountingOrientation)
        && ["m3", "m4"].includes(assignment.requiredSpindleDirection)
      ))
      && (!datumChoices.length || Boolean(assignment.tipDatum))
      && (!wallSideChoices.length || wallSideChoices.includes(assignment.wallSide))
      && (!nominal || assignment.nominalAccepted === true)
      && (!directionChoices.length || Boolean(assignment.axialDirection))
      && (!assignment.noseCompensation?.accepted || noseCompensationSetupIssues(assignment.noseCompensation).length === 0);
    confirmation.disabled = !requiredConfigurationComplete;
    confirmation.setAttribute("aria-pressed", String(assignment.confirmed === true));
    const cutterOnly = definition?.geometryKind === "axial-milling-cutter";
    const unconfirmedLabel = nominal ? "Confirm nominal cutter, datum and installed setup."
      : definition?.displayOnly
      ? "Confirm display placement only — stock removal unavailable."
      : cutterOnly
      ? "Confirm exact cutter and flat-tip program reference for bounded axial-bore demo."
      : "Confirm mounted holder, insert, hand, and programmed reference convention.";
    const confirmedLabel = nominal ? "Nominal cutting setup confirmed — click to clear."
      : definition?.displayOnly
      ? "Display placement confirmed — stock removal still unavailable."
      : cutterOnly
      ? "Cutter and flat-tip reference confirmed — click to clear confirmation."
      : "Mounted setup confirmed — click to clear confirmation.";
    confirmation.setAttribute("aria-label", nominal ? `Confirm ${toolKey} nominal cutting setup` : definition?.displayOnly
      ? `Confirm ${toolKey} display placement only, not stock removal`
      : cutterOnly
      ? `Confirm ${toolKey} exact cutter and flat-tip program reference`
      : `Confirm ${toolKey} mounted holder, insert, hand, and programmed reference convention`);
    confirmation.textContent = assignment.confirmed === true ? confirmedLabel : unconfirmedLabel;
    confirmation.addEventListener("click", () => {
      const confirmed = state.toolAssignments[toolKey]?.confirmed !== true;
      const nextAssignment = {...state.toolAssignments[toolKey], confirmed};
      if (confirmed) nextAssignment.confirmationSource = "user";
      else delete nextAssignment.confirmationSource;
      state.toolAssignments[toolKey] = nextAssignment;
      confirmation.setAttribute("aria-pressed", String(confirmed));
      confirmation.textContent = confirmed ? confirmedLabel : unconfirmedLabel;
      invalidateToolAssignments({renderControls: false});
      const nextReadiness = toolAssignmentReadiness(toolKey);
      elements.programToolSummary.textContent = programToolSummaryText(keys);
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
  if (tab === "driven" || tab === "cutters") return record.id;
  return tab === "assemblies" ? record.id : record.revisionRef;
}

function toolLibraryRecordName(record, tab = state.toolLibraryTab) {
  if (tab === "driven") return `${record.manufacturer} ${record.catalogNumber} · ${record.type}`;
  if (tab === "cutters") return `${record.manufacturer} ${record.catalogNumber} · ${record.name}`;
  if (tab === "assemblies") return record.name;
  const kind = tab === "holders" ? "Holder" : "Insert";
  return `${record.manufacturer} ${record.catalogId?.iso || record.catalogId?.ansi || record.materialNumber} · ${kind}`;
}

function toolLibraryRecordShape(record, tab = state.toolLibraryTab) {
  if (tab === "driven") return null;
  if (tab === "cutters") return record.profile;
  if (tab === "assemblies") return record.facets.shape;
  if (tab === "holders") return record.cuttingGeometry?.insertShape || (record.cuttingGeometry?.application?.includes("groove") ? "groove" : null);
  return record.cuttingGeometry?.shape || null;
}

function toolLibraryRecordFamily(record, tab = state.toolLibraryTab) {
  if (tab === "driven") return record.type;
  if (tab === "cutters") return record.family;
  if (tab === "assemblies") return ({turning: "turn", boring: "id-bore", grooving: "groove-profile"})[record.facets.family] || record.facets.family;
  const application = String(record.cuttingGeometry?.application || record.cuttingGeometry?.applications?.[0] || "");
  if (["parting", "face-grooving", "od-threading", "id-threading", "id-grooving"].includes(application)) return application;
  if (application === "grooving") return "groove-profile";
  if (application.includes("boring")) return "id-bore";
  return application.includes("groove") || application.includes("back-turn") ? "groove-profile" : "turn";
}

function toolLibraryRecordFamilies(record, tab = state.toolLibraryTab) {
  if (!["holders", "inserts"].includes(tab) || !record.cuttingGeometry?.applications?.length) {
    return [toolLibraryRecordFamily(record, tab)];
  }
  return record.cuttingGeometry.applications.map(application => toolLibraryRecordFamily({
    ...record, cuttingGeometry: {...record.cuttingGeometry, application},
  }, tab));
}

function toolLibraryRecordDisplayTier(record, tab = state.toolLibraryTab) {
  if (tab === "driven") return "catalog-only";
  if (tab === "cutters") return record.claims?.parametricCuttingGeometry ? "catalog-construction" : "catalog-only";
  if (tab !== "assemblies") return "catalog-only";
  const stateValue = record.claims?.displayGeometry?.state;
  if (stateValue === "manufacturer-cad-projection") return "manufacturer-cad-projection";
  if (stateValue === "catalog-construction") return "catalog-construction";
  return "catalog-only";
}

function toolLibraryRecordsForTab(tab = state.toolLibraryTab) {
  if (tab === "driven") return [...listLiveToolLibraryRecords()];
  if (tab === "cutters") return [...listMillingToolLibraryRecords()];
  if (tab === "holders") return [...TOOL_LIBRARY_CATALOG.holders];
  if (tab === "inserts") return [...TOOL_LIBRARY_CATALOG.inserts];
  return listToolLibraryAssemblies();
}

function toolLibrarySearchText(record, tab = state.toolLibraryTab) {
  if (tab === "driven") {
    const sources = (record.sourceRefs || []).map((sourceRef) => LIVE_TOOL_LIBRARY_SOURCE_BY_ID.get(sourceRef)).filter(Boolean);
    return JSON.stringify({record, sources, catalogNumberCompact: record.catalogNumber.replace(/\s+/g, "")}).toLowerCase();
  }
  if (tab === "cutters") {
    const sources = (record.sourceRefs || []).map((sourceRef) => MILLING_TOOL_LIBRARY_SOURCE_BY_ID.get(sourceRef)).filter(Boolean);
    return JSON.stringify({record, sources, catalogNumberCompact: record.catalogNumber.replace(/\s+/g, "")}).toLowerCase();
  }
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
  const unclassified = state.toolLibraryTab === "driven" || state.toolLibraryTab === "cutters";
  return toolLibraryRecordsForTab().filter((record) => (
    (unclassified || !family || toolLibraryRecordFamilies(record).includes(family))
    && (unclassified || !shape || (shape === "parting"
      ? toolLibraryRecordFamilies(record).includes("parting")
      : toolLibraryRecordShape(record) === shape))
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

function sourceComponentPreview(record, className) {
    const svg = svgNode("svg", {class: "tool-library-preview-svg", role: "img", "aria-label": `${record.catalogId.iso} actual source-registered component display outline`});
    const points = record.cadDisplayOutline.map(([x, y]) => ({x, y}));
    const xmin = Math.min(...points.map(p => p.x)), xmax = Math.max(...points.map(p => p.x));
    const ymin = Math.min(...points.map(p => p.y)), ymax = Math.max(...points.map(p => p.y));
    const padding = Math.max(xmax - xmin, ymax - ymin) * 0.1;
    svg.setAttribute("viewBox", `${xmin - padding} ${ymin - padding} ${xmax - xmin + 2 * padding} ${ymax - ymin + 2 * padding}`);
    appendSvgPolyline(svg, points, {className});
    return svg;
}

function insertLibraryPreview(insert) {
  if (insert.cadDisplayOutline) return sourceComponentPreview(insert, "insert-outline");
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
  if (holder.cadDisplayOutline) return sourceComponentPreview(holder, "holder-envelope");
  const svg = svgNode("svg", {class: "tool-library-preview-svg", role: "img", "aria-label": `${holder.catalogId.iso} published holder envelope dimensions`});
  const dimensions = holder.dimensions || {};
  const width = dimensions.shankDiameter || dimensions.shankWidth || 1;
  const length = dimensions.overallLength || 1;
  const headLength = Math.min(length, dimensions.headLength || 0);
  const padding = width * 0.45;
  svg.setAttribute("viewBox", `${-padding} ${-padding} ${width + padding * 2} ${length + padding * 2}`);
  svg.append(svgNode("rect", {x: 0, y: 0, width, height: length, class: "holder-envelope", fill: "none"}));
  if (headLength > 0) svg.append(svgNode("rect", {x: 0, y: length - headLength, width, height: headLength, class: "holder-head-zone", fill: "none"}));
  return svg;
}

function mountedAssemblyPreview(detail, {cuttingEnd = false} = {}) {
  const definition = toolAssembly2dById(detail.assembly.id);
  if (!definition || Number(definition.revision) !== Number(detail.assembly.revision)) return null;
  const model = buildToolAssemblyDisplay2d({...definition, mountingOrientation: "standard"}, {z: 0, x: 0});
  if (!model.valid) return null;
  const paths = model.components.flatMap((component) => (component.paths || [{points: component.outline, closed: true}]).map((path) => ({...path, role: component.role})));
  const boundsPaths = cuttingEnd ? paths.filter(path => path.role === "insert") : paths;
  const allPoints = boundsPaths.flatMap((path) => path.points || []).map((point) => ({x: point.z, y: -point.x}));
  if (!allPoints.length) return null;
  const minimumX = Math.min(...allPoints.map((point) => point.x));
  const maximumX = Math.max(...allPoints.map((point) => point.x));
  const minimumY = Math.min(...allPoints.map((point) => point.y));
  const maximumY = Math.max(...allPoints.map((point) => point.y));
  const padding = Math.max(maximumX - minimumX, maximumY - minimumY) * (cuttingEnd ? 0.7 : 0.06);
  const svg = svgNode("svg", {class: "tool-library-preview-svg mounted", role: "img", "aria-label": `${detail.assembly.name} retained manufacturer CAD top-plan projection`});
  if (cuttingEnd) {
    svg.classList.add("cutting-end");
    svg.setAttribute("aria-label", `${detail.assembly.name} cutting end detail, same source scale`);
  }
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
    shankDiameter: "Round shank diameter", minimumBoreDiameter: "Minimum bore diameter",
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
    "manufacturer-cad-routing": "official product-to-CAD identity",
    "manufacturer-compatible-parts": "official compatible-parts list",
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

function drivenUnitSources(record) {
  return [...new Set(record?.sourceRefs || [])].map((sourceRef) => LIVE_TOOL_LIBRARY_SOURCE_BY_ID.get(sourceRef)).filter(Boolean);
}

function millingCutterSources(record) {
  return [...new Set(record?.sourceRefs || [])].map((sourceRef) => MILLING_TOOL_LIBRARY_SOURCE_BY_ID.get(sourceRef)).filter(Boolean);
}

function millingCutterPreview(record) {
  const model = millingToolPreviewViewModel(record);
  const {x, y, width, height} = model.viewBox;
  const svg = svgNode("svg", {
    class: "tool-library-preview-svg milling-cutter",
    role: "img",
    "aria-label": `${model.title} dimension-driven cutter schematic`,
    viewBox: `${x} ${y} ${width} ${height}`,
  });
  for (const primitive of model.primitives) {
    const className = `milling-${primitive.role}`;
    if (primitive.type === "line") {
      svg.append(svgNode("line", {
        x1: primitive.start.x, y1: primitive.start.y,
        x2: primitive.end.x, y2: primitive.end.y,
        class: className,
        "stroke-dasharray": primitive.dash?.join(" ") || "",
      }));
      continue;
    }
    appendSvgPolyline(svg, primitive.points, {
      className,
      closed: primitive.type === "polygon" || primitive.closed === true,
    });
  }
  return {svg, model};
}

function definitionListSection(title, entries) {
  const section = document.createElement("section");
  section.className = "tool-library-section";
  const heading = document.createElement("h4");
  heading.textContent = title;
  const grid = document.createElement("dl");
  grid.className = "tool-library-dimensions";
  for (const [label, value] of entries.filter(([, value]) => value !== null && value !== undefined && value !== "")) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = String(value);
    grid.append(term, description);
  }
  section.append(heading, grid);
  return section;
}

function drivenUnitFactEntries(record) {
  const mount = [record.mount?.family, record.mount?.shankDiameterMm ? `Ø${record.mount.shankDiameterMm} mm shank` : null].filter(Boolean).join(" · ");
  const output = [record.output?.colletSystem, record.output?.diameterMm ? `Ø${record.output.diameterMm} mm output` : null].filter(Boolean).join(" · ");
  const orientation = record.orientation?.reversible
    ? `Reversible · ${record.orientation.adjustmentDegrees}° adjustment`
    : null;
  const features = [
    record.operatingFeatures?.dryRunPermitted ? "Dry run permitted" : null,
    record.operatingFeatures?.bearing ? `${record.operatingFeatures.bearing} bearing` : null,
  ].filter(Boolean).join(" · ");
  return [
    ["Manufacturer", record.manufacturer],
    ["Catalog number", record.catalogNumber],
    ["Unit type", record.type],
    ["Mount", mount],
    ["Mass", Number.isFinite(record.massKg) ? `${record.massKg} kg` : null],
    ["Output", output],
    ["Orientation", orientation],
    ["Drive ratio", record.drive?.ratio],
    ["Output rotation", record.drive?.rotationRelationship],
    ["Maximum torque", Number.isFinite(record.drive?.maximumTorqueNm) ? `${record.drive.maximumTorqueNm} Nm` : null],
    ["Maximum speed", Number.isFinite(record.drive?.maximumSpeedRpm) ? `${record.drive.maximumSpeedRpm.toLocaleString("en-US")} rpm` : null],
    ["Coolant", record.coolant?.modes?.join(" / ")],
    ["Maximum coolant pressure", Number.isFinite(record.coolant?.maximumPressureBar) ? `${record.coolant.maximumPressureBar} bar` : null],
    ["Published features", features],
  ];
}

function drivenUnitDrawingEntries(record) {
  const drawing = record.publishedDrawing;
  if (!drawing) return [];
  const range = (value) => value ? `${value.minimum} to ${value.maximum} mm` : null;
  const millimeters = (value) => Number.isFinite(value) ? `${value} mm` : null;
  const millimeterList = (value) => Array.isArray(value) && value.length ? value.map((entry) => `${entry} mm`).join(" · ") : null;
  const degreeList = (value) => Array.isArray(value) && value.length ? value.map((entry) => `${entry}°`).join(" · ") : null;
  return [
    ["Drawing publication", drawing.publishedOn],
    ["X range", range(drawing.xRange)],
    ["Y range", range(drawing.yRange)],
    ["Body range", range(drawing.bodyRange)],
    ["Overall length", millimeters(drawing.overallLength)],
    ["Width", millimeters(drawing.width)],
    ["Height", millimeters(drawing.height)],
    ["Center distance", millimeters(drawing.centerDistance)],
    ["Drive / machine diameter", millimeters(drawing.driveDiameter ?? drawing.machineDiameter)],
    ["Output diameter", millimeters(drawing.outputDiameter)],
    ["Tool-end diameters", millimeterList(drawing.toolEndDiameters)],
    ["Axial dimensions", millimeterList(drawing.axialDimensions)],
    ["Linear dimension chain", millimeterList(drawing.linearChain)],
    ["Horizontal reference dimensions", millimeterList(drawing.horizontalReferenceDimensions)],
    ["Vertical reference dimensions", millimeterList(drawing.verticalReferenceDimensions)],
    ["Published radius", Number.isFinite(drawing.radius) ? `R${drawing.radius} mm` : null],
    ["Published angles", degreeList(drawing.anglesDegrees)],
  ];
}

function renderDrivenUnitDetail(record) {
  const header = document.createElement("header");
  const titleBlock = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "DRIVEN UNIT · BROWSE ONLY";
  const title = document.createElement("h3");
  title.id = "toolLibraryDetailTitle";
  title.textContent = toolLibraryRecordName(record, "driven");
  titleBlock.append(eyebrow, title);
  const revision = document.createElement("span");
  revision.className = "tool-library-revision";
  revision.textContent = `REV ${record.revision}`;
  header.append(titleBlock, revision);
  elements.toolLibraryDetail.append(header);

  const copy = document.createElement("p");
  copy.className = "tool-library-detail-copy";
  copy.textContent = `${record.revisionRef}. Manufacturer-published factual metadata and outbound source links are retained; no mounted transform or program reference is established.`;
  elements.toolLibraryDetail.append(copy);

  const unavailable = {
    state: "catalog only",
    available: false,
    blockedReason: record.assignment.blockedReason,
  };
  const authorities = document.createElement("div");
  authorities.className = "tool-library-authorities";
  authorities.setAttribute("aria-label", "Driven-unit authority boundaries");
  authorities.append(
    makeAuthority("display", unavailable),
    makeAuthority("reference", unavailable),
    makeAuthority("cutting", unavailable),
    makeAuthority("collision", unavailable),
  );
  elements.toolLibraryDetail.append(authorities);

  const noPreview = document.createElement("div");
  noPreview.className = "tool-library-no-preview";
  const noPreviewTitle = document.createElement("strong");
  noPreviewTitle.textContent = "No copied or derived outline";
  const noPreviewText = document.createElement("span");
  noPreviewText.textContent = "This browse-only record intentionally shows no manufacturer drawing, CAD-derived shape, mounted pose, or constructed envelope.";
  noPreview.append(noPreviewTitle, noPreviewText);
  elements.toolLibraryDetail.append(noPreview);

  elements.toolLibraryDetail.append(definitionListSection("Published catalog facts", drivenUnitFactEntries(record)));
  const drawingEntries = drivenUnitDrawingEntries(record);
  if (drawingEntries.length) {
    elements.toolLibraryDetail.append(definitionListSection("Published drawing dimensions", drawingEntries));
  } else {
    const missingDrawing = document.createElement("div");
    missingDrawing.className = "tool-library-detail-empty";
    const missingTitle = document.createElement("strong");
    missingTitle.textContent = "No current dimensioned drawing retained";
    const missingText = document.createElement("span");
    missingText.textContent = "Only the manufacturer product record and official STEP download are linked; no dimensions were inferred from CAD bounds.";
    missingDrawing.append(missingTitle, missingText);
    elements.toolLibraryDetail.append(missingDrawing);
  }
  elements.toolLibraryDetail.append(sourceSection(drivenUnitSources(record)));

  const boundary = document.createElement("div");
  boundary.className = "tool-library-catalog-boundary";
  const boundaryTitle = document.createElement("strong");
  boundaryTitle.textContent = "Licensing boundary";
  const boundaryText = document.createElement("span");
  boundaryText.textContent = LIVE_TOOL_LIBRARY_CATALOG.licensingBoundary.note;
  boundary.append(boundaryTitle, boundaryText);
  elements.toolLibraryDetail.append(boundary);

  const limitation = document.createElement("div");
  limitation.className = "tool-library-limitation";
  const limitationTitle = document.createElement("strong");
  limitationTitle.textContent = "Catalog-only / unassignable";
  const limitationText = document.createElement("span");
  limitationText.textContent = record.assignment.blockedReason;
  limitation.append(limitationTitle, limitationText);
  elements.toolLibraryDetail.append(limitation);
  elements.toolLibraryAssign.disabled = true;
  elements.toolLibraryAssign.textContent = "Catalog record only";
}

function renderMillingCutterDetail(record) {
  const preview = millingCutterPreview(record);
  const eligible = record.demoCuttingEligibility?.eligible === true;
  const header = document.createElement("header");
  const titleBlock = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = eligible ? "MILLING CUTTER · BOUNDED DEMO" : "MILLING CUTTER · BROWSE ONLY";
  const title = document.createElement("h3");
  title.id = "toolLibraryDetailTitle";
  title.textContent = toolLibraryRecordName(record, "cutters");
  titleBlock.append(eyebrow, title);
  const revision = document.createElement("span");
  revision.className = "tool-library-revision";
  revision.textContent = `REV ${record.revision}`;
  header.append(titleBlock, revision);
  elements.toolLibraryDetail.append(header);

  const copy = document.createElement("p");
  copy.className = "tool-library-detail-copy";
  copy.textContent = `${record.revisionRef}. The profile below is an original parametric schematic built from manufacturer-published dimensions; no manufacturer artwork or CAD is bundled.`;
  elements.toolLibraryDetail.append(copy);

  const authorities = document.createElement("div");
  authorities.className = "tool-library-authorities";
  authorities.setAttribute("aria-label", "Milling cutter authority boundaries");
  const unavailable = {state: "unavailable", available: false, blockedReason: "No driven holder, mounted transform, or collision envelope is established."};
  const bounded = {
    state: eligible ? "bounded axial bore" : "browse only",
    available: eligible,
    blockedReason: eligible ? record.demoCuttingEligibility.blockedOutsideScope : record.demoCuttingEligibility.blockedReason,
  };
  authorities.append(
    makeAuthority("display", {state: "catalog construction", available: true}),
    makeAuthority("reference", bounded),
    makeAuthority("cutting", bounded),
    makeAuthority("collision", unavailable),
  );
  elements.toolLibraryDetail.append(authorities);

  const figure = document.createElement("figure");
  figure.className = "tool-library-preview";
  figure.append(preview.svg);
  const caption = document.createElement("figcaption");
  caption.textContent = `Source-scale cutter cross-section: Ø${preview.model.dimensions.cutterDiameterMm} mm cutter, ${preview.model.dimensions.cuttingLengthMm} mm ${preview.model.dimensions.cuttingLengthKind.replaceAll("-", " ")}, Ø${preview.model.dimensions.shankDiameterMm} mm shank, ${preview.model.dimensions.overallLengthMm} mm OAL.`;
  figure.append(caption);
  elements.toolLibraryDetail.append(figure);

  const point = preview.model.dimensions.point || {};
  elements.toolLibraryDetail.append(
    definitionListSection("Published cutter facts", [
      ["Manufacturer", record.manufacturer],
      ["Catalog number", record.catalogNumber],
      ["Family / profile", `${record.family} · ${record.profile}`],
      ["Flutes", record.flutes],
      ["Cutter diameter", `${preview.model.dimensions.cutterDiameterMm} mm · ${(preview.model.dimensions.cutterDiameterMm / 25.4).toFixed(4)} in`],
      [preview.model.dimensions.cuttingLengthKind === "flute-length" ? "Flute length" : "Length of cut", `${preview.model.dimensions.cuttingLengthMm} mm · ${(preview.model.dimensions.cuttingLengthMm / 25.4).toFixed(4)} in`],
      ["Shank diameter", `${preview.model.dimensions.shankDiameterMm} mm · ${(preview.model.dimensions.shankDiameterMm / 25.4).toFixed(4)} in`],
      ["Overall length", `${preview.model.dimensions.overallLengthMm} mm · ${(preview.model.dimensions.overallLengthMm / 25.4).toFixed(4)} in`],
      ["Point", point.pointAngleDegrees ? `${point.pointAngleDegrees}° included` : point.type],
      ["Center cutting", record.centerCutting === null ? "Not retained" : record.centerCutting ? "Yes" : "No"],
      ["Material / coating", [record.material, record.coating?.name].filter(Boolean).join(" · ")],
    ]),
    definitionListSection("Independent authority labels", millingToolPreviewClaimLabels(record).map((claim) => [claim.id, claim.label])),
    sourceSection(millingCutterSources(record)),
  );

  const boundary = document.createElement("div");
  boundary.className = "tool-library-catalog-boundary";
  const boundaryTitle = document.createElement("strong");
  boundaryTitle.textContent = "Licensing boundary";
  const boundaryText = document.createElement("span");
  boundaryText.textContent = MILLING_TOOL_LIBRARY_CATALOG.licensingBoundary.note;
  boundary.append(boundaryTitle, boundaryText);
  elements.toolLibraryDetail.append(boundary);

  const limitation = document.createElement("div");
  limitation.className = "tool-library-limitation";
  const limitationTitle = document.createElement("strong");
  limitationTitle.textContent = eligible ? "Bounded assignment scope" : "Why assignment is blocked";
  const limitationText = document.createElement("span");
  limitationText.textContent = eligible
    ? record.demoCuttingEligibility.blockedOutsideScope
    : record.demoCuttingEligibility.blockedReason;
  limitation.append(limitationTitle, limitationText);
  elements.toolLibraryDetail.append(limitation);

  const selectedTarget = elements.toolLibraryTarget.value;
  elements.toolLibraryTarget.disabled = false;
  elements.toolLibraryAssign.disabled = !(eligible && selectedTarget);
  elements.toolLibraryAssign.textContent = eligible ? "Assign cutter-only demo" : "Catalog record only";
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

function nominalPartoffSectionPreview(definition) {
  const section = document.createElement("section");
  section.className = "tool-library-preview tool-library-nominal";
  section.dataset.nominalPartoff = definition.id;
  const heading = document.createElement("h4");
  heading.textContent = "Nominal part-off section · dimensions only";
  const copy = document.createElement("p");
  const previewDimension = value => `${displayValue(value).toFixed(elements.displayUnits.value === "inch" ? 4 : 3)} ${unitName()}`;
  copy.textContent = `Width ${previewDimension(definition.width)} · corner radius ${previewDimension(definition.cornerRadius)}. Ideal straight front with two circular corners, independently defined from the published W/R drawing. This is not the chipbreaker CAD edge, a mounted setup, or stock-removal verification.`;
  const preview = document.createElement("figure");
  const draw = tipDatum => {
    preview.replaceChildren();
    if (!tipDatum) return;
    const nominal = buildA4cNominalPartoffSection({tipDatum, acceptNominalSection: true, referencePoint: {z: 0, x: 0}});
    if (!nominal.valid) return;
    const pad = definition.width * 0.14;
    const svg = svgNode("svg", {class: "tool-library-preview-svg nominal-section", role: "img",
      "aria-label": `Nominal part-off front, ${tipDatum} reference`,
      viewBox: `${nominal.bounds.minimumZ - pad} ${-definition.cornerRadius - pad} ${definition.width + 2 * pad} ${definition.cornerRadius + 2 * pad}`});
    // Native SVG circular arcs display the analytic section, not a mesh fit.
    const path = nominal.frontBoundary.map((edge, index) => `${index ? "" : `M ${edge.from.z} ${-edge.from.x} `}${edge.kind === "line"
      ? `L ${edge.to.z} ${-edge.to.x}`
      : `A ${edge.radius} ${edge.radius} 0 0 0 ${edge.to.z} ${-edge.to.x}`}`).join(" ");
    svg.append(svgNode("path", {d: path, fill: "none", stroke: "#ffc857", "stroke-width": 2, "vector-effect": "non-scaling-stroke"}));
    svg.append(svgNode("circle", {cx: 0, cy: 0, r: definition.width * 0.012, fill: "#70e9c0"}));
    const caption = document.createElement("figcaption");
    caption.textContent = "Green point = chosen virtual preview reference. Preview choice does not change your program or tool assignment.";
    preview.append(svg, caption);
  };
  section.append(heading, copy, selectField("Preview Z reference only", [
    ["negative-z-edge", "Negative-Z virtual corner"], ["center", "Front-line center"], ["positive-z-edge", "Positive-Z virtual corner"],
  ], "", "Choose a preview reference", draw, "Nominal part-off preview reference"), preview);
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
    elements.toolLibraryAssign.textContent = state.toolLibraryTab === "driven" || state.toolLibraryTab === "cutters" ? "Catalog record only" : "Assign mounted assembly";
    return;
  }
  const tab = state.toolLibraryTab;
  if (tab === "driven") {
    renderDrivenUnitDetail(record);
    return;
  }
  if (tab === "cutters") {
    renderMillingCutterDetail(record);
    return;
  }
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
      ? record.cadDisplayOutline
        ? "Selected holder's source-CAD outline at source scale — not a clearance envelope."
      : record.dimensions.shankDiameter
        ? "Published round-shank diameter × overall-length bounding envelope only — not the holder-head shape."
        : "Published shank envelope and head-length zone only — not a mounted holder-head outline."
      : previewInsert?.cadDisplayOutline
        ? "Selected insert's manufacturer CAD outline in its source-registered frame — display only, not a qualified cutting profile."
      : previewInsert?.cuttingGeometry?.shape === "groove"
        ? "Standalone cutter envelope constructed from published cutting width, depth, and corner radius — not a mounted assembly transform."
        : "Standalone insert plan constructed from published IC, included angle, nose radius, and hole dimensions — not a mounted assembly transform.";
  preview.append(caption);
  elements.toolLibraryDetail.append(preview);

  if ((detail?.assembly.facets.family === "boring" || detail?.assembly.displayOnly || toolAssembly2dById(record.id)?.cuttingModel?.mode === "nominal-lathe") && detail.assembly.claims.displayGeometry.available) {
    const endPreview = document.createElement("figure");
    endPreview.className = "tool-library-preview";
    const endSvg = mountedAssemblyPreview(detail, {cuttingEnd: true});
    if (endSvg) endPreview.append(endSvg);
    const endCaption = document.createElement("figcaption");
    endCaption.textContent = "Cutting end detail · retained manufacturer CAD. The separate nominal cutting model uses published dimensions and your selected program datum; this drawing does not establish physical accuracy or holder clearance.";
    endPreview.append(endCaption);
    elements.toolLibraryDetail.append(endPreview);
  }

  if (tab === "assemblies") {
    if (record.nominalSection) elements.toolLibraryDetail.append(nominalPartoffSectionPreview(record.nominalSection));
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
  elements.toolLibraryTarget.disabled = false;
  elements.toolLibraryAssign.disabled = !(tab === "assemblies" && record.assignment.assignable && selectedTarget);
  elements.toolLibraryAssign.textContent = tab === "assemblies" && record.assignment.assignable
    ? toolAssembly2dById(record.id)?.cuttingModel?.mode === "nominal-lathe" ? "Assign nominal cutting tool" : record.displayOnly ? "Assign display only — no stock removal" : "Assign mounted assembly"
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
  elements.toolLibraryResultsTitle.textContent = ({assemblies: "MOUNTED ASSEMBLIES", holders: "HOLDERS", inserts: "INSERTS", cutters: "MILLING CUTTERS", driven: "DRIVEN UNITS"})[state.toolLibraryTab];
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
      ? `${record.revisionRef} · ${record.facets.shape} · ${record.facets.insertIcInches ? `${record.facets.insertIcInches} in IC` : record.facets.family.replaceAll("-", " ")}`
      : state.toolLibraryTab === "driven"
        ? `${record.revisionRef} · ${record.output?.colletSystem || "output unknown"} · ${record.drive?.ratio || "ratio unknown"}`
        : state.toolLibraryTab === "cutters"
          ? `${record.revisionRef} · ${record.profile} · Ø${record.publishedDimensions.cutterDiameter} ${record.publishedDimensions.units}`
        : `${record.revisionRef} · material ${record.materialNumber}`;
    const badges = document.createElement("span");
    badges.className = "tool-library-result-badges";
    const sourceBadge = document.createElement("i");
    sourceBadge.textContent = state.toolLibraryTab === "driven" ? "HEIMATEC SOURCE" : "MANUFACTURER SOURCE";
    const authorityBadge = document.createElement("i");
    authorityBadge.className = toolLibraryRecordDisplayTier(record) === "manufacturer-cad-projection" || record.demoCuttingEligibility?.eligible ? "verified" : "catalog";
    authorityBadge.textContent = state.toolLibraryTab === "cutters" && record.demoCuttingEligibility?.eligible
      ? "BOUNDED BORE"
      : toolLibraryRecordDisplayTier(record) === "manufacturer-cad-projection" ? "CAD DISPLAY" : toolLibraryRecordDisplayTier(record) === "catalog-construction" ? "SCALED SCHEMATIC" : "CATALOG ONLY";
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
  const simplified = state.toolLibraryTab === "driven" || state.toolLibraryTab === "cutters";
  const driven = state.toolLibraryTab === "driven";
  elements.toolLibraryFamilyFilterLabel.hidden = simplified;
  elements.toolLibraryShapeFilterLabel.hidden = simplified;
  elements.toolLibraryFamilyFilter.disabled = simplified;
  elements.toolLibraryShapeFilter.disabled = simplified;
  elements.toolLibraryTarget.disabled = driven;
  if (simplified) {
    elements.toolLibraryFamilyFilter.value = "";
    elements.toolLibraryShapeFilter.value = "";
    elements.toolLibraryAuthorityFilter.value = "";
  }
  elements.toolLibrarySearch.placeholder = driven
    ? "Heimatec catalog number, axial, radial, ER32, BMT…"
    : state.toolLibraryTab === "cutters"
      ? "Manufacturer, cutter number, flat, ball, drill…"
      : "Manufacturer, catalog number, ISO code, family…";
}

function setToolLibraryTab(tab) {
  if (!["assemblies", "holders", "inserts", "cutters", "driven"].includes(tab)) return;
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
  state.toolLibraryTab = selectedAssemblyId && millingToolLibraryRecordById(selectedAssemblyId) ? "cutters" : "assemblies";
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
  const available = state.viewMode === "2d" && !isMillMode();
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
  if (isMillMode() || state.viewMode !== "2d" || !state.showTool2d) {
    elements.toolVerificationBadge.hidden = true;
    return;
  }
  const toolKey = activeProgramToolKey();
  const configured = configuredToolAssembly2d(toolKey);
  const physicalReference = toolPhysicalReferencePointForExecution(
    state.parsed.segments,
    state.visibleBlocks,
    xScale(),
  );
  const currentCut = state.parsed.segments[Math.max(0, Math.min(state.parsed.segments.length, state.visibleBlocks) - 1)];
  const nose = currentCut?.toolKey === toolKey && currentCut.compensationResolved ? currentCut.cutterEnvelope : null;
  const noseCenter = nose?.kind === 'nose-circle' ? {...physicalReference} : null;
  if (noseCenter) {
    physicalReference.z += nose.tipDirection.z * nose.radiusMm;
    physicalReference.x += nose.tipDirection.x * nose.radiusMm;
  }
  const spindleEvent = latestMachineEventAtPosition(state.parsed.spindleEvents, state.parsed.segments, state);
  const spindle = {
    direction: spindleEvent?.direction === "m3" || spindleEvent?.direction === "m4"
      ? spindleEvent.direction
      : "unknown",
    running: typeof spindleEvent?.running === "boolean" ? spindleEvent.running : null,
  };
  const badgeStatus = elements.toolVerificationBadge.querySelector("strong");
  elements.toolVerificationBadge.hidden = false;
  if (!toolKey || !configured) {
    elements.toolVerificationBadge.classList.add("invalid");
    badgeStatus.textContent = toolKey ? `${toolKey} UNASSIGNED` : "NO ACTIVE TOOL";
    return;
  }
  const liveCutter = configured.geometryKind === "axial-milling-cutter";
  const boringDisplay = configured.mountingAxis === "program-z";
  const liveSpindle = latestMachineEventAtPosition(state.parsed.liveToolEvents, state.parsed.segments, state);
  const model = buildToolAssemblyDisplay2d(configured, physicalReference, {
    spindleDirection: spindle.direction,
    spindleRunning: spindle.running,
  });
  if (!model.valid) {
    elements.toolVerificationBadge.classList.add("invalid");
    badgeStatus.textContent = `${toolKey} · OUTLINE UNAVAILABLE`;
    return;
  }
  const mainSpindleState = machineRunningState(spindle.running);
  const mainSpindleStateLabel = mainSpindleState === "stopped"
    ? " · SPINDLE STOPPED"
    : (mainSpindleState === "unknown" ? " · SPINDLE STATE UNKNOWN" : "");
  const liveSpindleState = machineRunningState(liveSpindle?.running);
  const spindleLabel = liveCutter
    ? liveSpindleState === "running"
      ? `${String(liveSpindle.command || liveSpindle.direction || "LIVE").toUpperCase()} · ${Number(liveSpindle.speed).toLocaleString("en-US")} RPM`
      : (liveSpindleState === "stopped" ? "LIVE SPINDLE STOPPED" : "LIVE SPINDLE STATE UNKNOWN")
    : `${configured.mountingOrientation === "standard" ? (boringDisplay ? "UPPER ID" : "STANDARD · INSERT DOWN") : configured.mountingOrientation === "flipped" ? (boringDisplay ? "LOWER ID · Z ROLL 180°" : "FLIPPED · INSERT UP") : "MOUNTING UNSET · NOMINAL OUTLINE"} · ${spindle.direction === "m3" || spindle.direction === "m4" ? spindle.direction.toUpperCase() : "ROTATION UNKNOWN"}${mainSpindleStateLabel}`;
  const rotationMismatch = !liveCutter && spindle.running === true
    && ["m3", "m4"].includes(spindle.direction)
    && ["m3", "m4"].includes(configured.requiredSpindleDirection)
    && spindle.direction !== configured.requiredSpindleDirection;
  elements.toolVerificationBadge.classList.toggle("invalid", !liveCutter && (!["standard", "flipped"].includes(configured.mountingOrientation) || rotationMismatch));
  badgeStatus.textContent = `${toolKey} · ${rotationMismatch ? "ROTATION MISMATCH · " : ""}${spindleLabel}${configured.cuttingModel?.mode === "nominal-lathe" ? " · NOMINAL CUTTER / CAD DISPLAY" : configured.displayOnly ? " · DISPLAY ONLY / NO STOCK REMOVAL" : ""}`;
  if (noseCenter) badgeStatus.textContent += ' · COMPENSATED NOSE';

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

  if (noseCenter) {
    const center = toolPhysicalToScreen(noseCenter);
    const edge = toolPhysicalToScreen({z: noseCenter.z + nose.radiusMm, x: noseCenter.x});
    ctx.strokeStyle = '#f472b6'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(center.x, center.y, Math.abs(edge.x - center.x), 0, Math.PI * 2); ctx.stroke();
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
  const effectiveXScale = segment?.xCoordinateMode === "radius" ? 1 : xScale();
  return segment.points.map((point) => worldToScreen({
    ...point,
    x: point.x * effectiveXScale / xScale(),
  }));
}

function isUnsupportedControllerPathPreview(segment) {
  return segment?.pathPreviewOnly === true
    && segment?.verificationIssues?.includes("unsupported-controller-command-preview");
}

function strokeSegment(segment, pending = false) {
  const colors = {rapid: "#f59e0b", rough: "#22c55e", "cycle-profile": "#67e8f9", finish: "#e5eefc", linear: "#38bdf8", "arc-cw": "#a78bfa", "arc-ccw": "#a78bfa"};
  const live = isLiveToolSegment(segment);
  const rapid = isRapidMotion(segment);
  const semanticBlocked = Boolean(segment.verificationBlocked || segment.liveToolBlocked);
  const controllerPreview = isUnsupportedControllerPathPreview(segment);
  const hardBlocked = semanticBlocked && !controllerPreview;
  const collision = !pending && !live && !semanticBlocked && collisionPointForSegment(segment, collisionOptions());
  ctx.strokeStyle = pending
    ? (hardBlocked ? "#7f1d1d" : (live ? "#80506e" : "#64748b"))
    : (hardBlocked || collision ? "#fb7185" : (live ? "#f472b6" : (colors[segment.type] || "#94a3b8")));
  ctx.lineWidth = hardBlocked || collision ? 2.8 : (rapid ? 1.2 : (pending ? 1.35 : 2.15));
  ctx.globalAlpha = pending ? (live ? 0.48 : 0.38) : 0.98;
  ctx.setLineDash(hardBlocked || controllerPreview ? [2, 2] : (live ? (rapid ? [7, 4, 2, 4] : [3, 2]) : (rapid ? [6, 5] : [])));
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

function selectedDxfMaterialEntities() {
  const reference = state.referenceGeometry;
  const candidate = selectedDxfMaterialCandidate(reference);
  if (!candidate || reference?.kind !== "dxf") return [];
  const entityIds = new Set();
  for (const primitiveId of candidate.primitiveIds || []) {
    const id = `reference-${String(primitiveId)}`;
    entityIds.add(id);
    entityIds.add(`${id}-a`);
    entityIds.add(`${id}-b`);
  }
  return (reference.entities || []).filter((entity) => entityIds.has(entity.id));
}

function drawReferenceGeometry() {
  if (!state.referenceGeometry?.ready || !elements.referenceGeometryToggle.checked) return;
  ctx.save();
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.92;
  ctx.setLineDash([8, 4]);
  for (const entity of state.referenceGeometry.entities) {
    const points = sampleGeometryEntity(entity, REFERENCE_DISPLAY_ARC_MAXIMUM_SEGMENTS).map(geometryToScreen);
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }
  const materialEntities = selectedDxfMaterialEntities();
  if (materialEntities.length) {
    const qualified = elements.referenceDxfMaterialInside.checked
      && state.referenceGeometry.mapped?.materialRegion?.qualified === true;
    ctx.strokeStyle = qualified ? "#a78bfa" : "#38bdf8";
    ctx.lineWidth = qualified ? 3.4 : 3;
    ctx.globalAlpha = 1;
    ctx.shadowColor = qualified ? "rgba(167, 139, 250, .72)" : "rgba(56, 189, 248, .62)";
    ctx.shadowBlur = 8;
    ctx.setLineDash([]);
    for (const entity of materialEntities) {
      const points = sampleGeometryEntity(entity, REFERENCE_DISPLAY_ARC_MAXIMUM_SEGMENTS).map(geometryToScreen);
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawReferenceDeviationWitness() {
  if (!state.referenceGeometry?.ready
    || !elements.referenceGeometryToggle.checked
    || !state.showReferenceWitness) return;
  const witness = state.referenceComparison?.worstWitness;
  if (witness && witness.deviation.lowerBoundMm > 1e-10) {
    ctx.save();
    const programPoint = geometryToScreen(witness.worstPoint);
    const nominalPoint = geometryToScreen(witness.nearestNominal.point);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = witness.classification === "within-tolerance" ? "#56e39f" : "#fb7185";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(programPoint.x, programPoint.y);
    ctx.lineTo(nominalPoint.x, nominalPoint.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ctx.strokeStyle;
    for (const point of [programPoint, nominalPoint]) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    const label = "Distance to reference · not motion";
    ctx.font = "12px system-ui, sans-serif";
    const labelWidth = ctx.measureText(label).width;
    const labelX = Math.max(8, Math.min(elements.canvas.clientWidth - labelWidth - 12, (programPoint.x + nominalPoint.x) / 2 + 8));
    const labelY = Math.max(22, Math.min(elements.canvas.clientHeight - 12, (programPoint.y + nominalPoint.y) / 2 - 10));
    ctx.fillStyle = "#071012ee";
    ctx.fillRect(labelX - 4, labelY - 15, labelWidth + 8, 21);
    ctx.fillStyle = "#e5d8ea";
    ctx.fillText(label, labelX, labelY);
    ctx.restore();
  }
}

function drawProfilePenetrationFragments() {
  const fragments = [];
  for (const result of penetratingMaterialSegmentResults()) {
    for (const fragment of result.violationFragments || []) {
      if (fragments.length >= MAX_PROFILE_PENETRATION_FRAGMENTS) break;
      fragments.push(fragment);
    }
    if (fragments.length >= MAX_PROFILE_PENETRATION_FRAGMENTS) break;
  }
  if (!fragments.length) return;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#ff365c";
  ctx.lineWidth = 4.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "#ff174d";
  ctx.shadowBlur = 12;
  ctx.setLineDash([]);
  for (const fragment of fragments) {
    const points = sampleGeometryEntity(fragment, REFERENCE_DISPLAY_ARC_MAXIMUM_SEGMENTS).map(geometryToScreen);
    if (points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDisplayHomeEstimate(width, height) {
  const estimate = displayHomeEstimate(currentMachineProfile());
  if (!estimate) return;
  const point = geometryToScreen(estimate);
  if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) return;
  ctx.save();
  ctx.strokeStyle = "#9ba9bb";
  ctx.fillStyle = "#c5ceda";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
  ctx.moveTo(point.x - 12, point.y); ctx.lineTo(point.x + 12, point.y);
  ctx.moveTo(point.x, point.y - 12); ctx.lineTo(point.x, point.y + 12);
  ctx.stroke();
  ctx.font = "11px monospace";
  const label = "ESTIMATED HOME · DISPLAY ONLY";
  const labelWidth = ctx.measureText(label).width;
  ctx.fillText(label, Math.max(8, Math.min(point.x + 16, width - labelWidth - 8)), Math.max(20, point.y - 16));
  ctx.restore();
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
  drawProfilePenetrationFragments();
  drawProgramPointMarkers2d(count);
  if (!count) return;
  const finalSegment = state.parsed.segments[count - 1];
  const marker = segmentScreenPoints(finalSegment).at(-1);
  ctx.fillStyle = "#e5eefc";
  ctx.shadowColor = "#56e39f";
  ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.arc(marker.x, marker.y, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  const {collisions} = evaluateCollisions(state.parsed.segments.slice(0, count), collisionOptions());
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
  const available = state.viewMode === "2d" && !isMillMode();
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
  if (entity.metadata?.referenceGeometry) {
    const format = entity.metadata.referenceFormat === "step" ? "STEP section" : "DXF";
    elements.status.textContent = `Imported ${format} dimensions carry a bounded numeric uncertainty (≤ ${formatReferenceDistance(entity.metadata.geometryUncertaintyMm || 0)}); use the reference-deviation result instead of pinning an exact dimension.`;
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

function resetGeometryInspectorDom() {
  elements.geometryInspector.hidden = true;
  $("geometryComponent").textContent = "Select component geometry";
  $("geometryEntity").textContent = "Corners, midpoints, and lines snap in 2D.";
  $("geometrySelectedPoint").textContent = "—";
  $("geometryPrimaryLabel").textContent = "Length";
  $("geometryLength").textContent = "—";
  $("geometrySecondaryLabel").textContent = "Delta";
  $("geometrySecondaryValue").textContent = "—";
  $("geometryCenter").textContent = "—";
  $("geometryStart").textContent = "—";
  $("geometryMidpoint").textContent = "—";
  $("geometryEnd").textContent = "—";
}

function renderGeometryInspector() {
  const active = state.viewMode === "2d" && !isMillMode() && Boolean(state.geometrySelection);
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
  const referenceNote = hit.entity.metadata?.referenceGeometry
    ? ` · ANALYTIC ${hit.entity.metadata.referenceFormat === "step" ? "STEP SECTION" : "DXF"} · NUMERIC BOUND ≤ ${formatReferenceDistance(hit.entity.metadata.geometryUncertaintyMm || 0)}`
    : "";
  $("geometryEntity").textContent = `${hit.entity.label} · ${snapNames[hit.kind] || "Geometry"}${samplingNote}${referenceNote}`;
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
    coordinateSystem: isMillMode() ? "mill" : "lathe",
  });
}

function draw3d(rect) {
  if (isMillMode()) {
    const currentPoint = elements.toolpathToggle.checked
      ? millPositionAt(state.parsed, {sourceLine: state.programLine, visibleCount: state.visibleBlocks})
      : null;
    renderMill3d(ctx, {
      width: rect.width,
      height: rect.height,
      segments: elements.toolpathToggle.checked ? state.parsed.segments : [],
      visibleCount: elements.toolpathToggle.checked ? state.visibleBlocks : 0,
      currentPoint,
      camera: state.camera3d,
      lengthScale: unitScale(),
      lengthUnit: unitName(),
    });
    state.graphicsHits = [];
    drawViewCube();
    return;
  }
  let stock = null;
  const quality = graphicsQuality();
  const interactive = state.playing || Date.now() < state.preview3dUntil || state.drag?.mode?.startsWith("3d-");
  const renderQuality = renderGraphicsQualityPreset(quality.id, {interactive});
  if (!elements.stockToggle.checked) {
    updateStockRemovedStatus(null, "OFF");
  } else if (state.programDirty) {
    updateStockRemovedStatus(null, "PLOT REQUIRED");
  } else {
    const stockDiameter = Math.max(0, setupValue(elements.stockDiameter));
    const stockLength = Math.max(0, setupValue(elements.stockLength));
    if (stockDiameter && stockLength) {
      stock = stockProfileFor(stockDiameter, stockLength);
      if (stock) updateStockRemovedStatus(stock); else updateStockRemovedStatus(null, "BLOCKED");
    } else updateStockRemovedStatus(null, "SET STOCK");
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

function drawFace(rect) {
  const stockRadius = elements.stockToggle.checked ? Math.max(0, setupValue(elements.stockDiameter)) / 2 : 0;
  const segments = elements.toolpathToggle.checked ? state.parsed.segments : [];
  const stockDiameter = Math.max(0, setupValue(elements.stockDiameter));
  const stockLength = Math.max(0, setupValue(elements.stockLength));
  const stock = !state.programDirty && elements.stockToggle.checked && stockDiameter && stockLength
    ? stockProfileFor(stockDiameter, stockLength)
    : null;
  renderLiveFace2d(ctx, {
    width: rect.width,
    height: rect.height,
    segments,
    visibleCount: elements.toolpathToggle.checked ? state.visibleBlocks : 0,
    xScale: xScale(),
    stockRadius,
    stockFaceIntervals: stock && hasStockCavities(stock) ? stockMaterialIntervals(stock, Math.max(0,
      Math.min(stock.columns - 1, Math.floor((stock.materialEndZ - stock.startZ) / (stock.length / (stock.columns - 1)))))) : null,
    axialBores: stock?.axialBores || [],
    lengthScale: unitScale(),
    lengthUnit: unitName(),
    lengthDecimals: elements.displayUnits.value === "inch" ? 4 : 3,
  });
  const faceHeading = elements.faceViewStatus.querySelector("strong");
  const faceCopy = elements.faceViewStatus.querySelector("span");
  const liveSummary = summarizeAxialFlatBoreStock(stock?.liveStock);
  if (liveSummary.status === LIVE_STOCK_STATUS.MODELED) {
    faceHeading.textContent = "FACE VIEW · AXIAL BORE MODELED";
    faceCopy.textContent = `${liveSummary.label}. Circle diameter and depth come from the assigned cutter and exact plunge; holder and collision remain path-only.`;
  } else if (stock && hasStockCavities(stock)) {
    faceHeading.textContent = "FACE VIEW · NOMINAL STOCK SECTION";
    faceCopy.textContent = "Material at the free-end axial section, including starting bore and annular openings. Use 2D for groove depth and internal profile. No holder-clearance claim.";
  } else {
    faceHeading.textContent = "FACE VIEW · PATH ONLY";
    faceCopy.textContent = "Programmed live-tool centerlines and stock face only. No unsupported material-removal or cutter/holder collision claim.";
  }
  state.graphicsHits = [];
  state.componentGeometry = [];
  state.geometryHover = null;
  state.geometrySelection = null;
  elements.toolVerificationBadge.hidden = true;
  if (!elements.stockToggle.checked) {
    updateStockRemovedStatus(null, "OFF");
  } else if (state.programDirty) {
    updateStockRemovedStatus(null, "PLOT REQUIRED");
  } else {
    if (stockDiameter && stockLength) {
      if (stock) updateStockRemovedStatus(stock); else updateStockRemovedStatus(null, "BLOCKED");
    } else updateStockRemovedStatus(null, "SET STOCK");
  }
}

function draw() {
  updateToolRotationAlert();
  const rect = elements.wrap.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (state.viewMode === "3d") {
    draw3d(rect);
  } else if (state.viewMode === "face") {
    drawFace(rect);
  } else if (isMillMode()) {
    const currentPoint = elements.toolpathToggle.checked
      ? millPositionAt(state.parsed, {sourceLine: state.programLine, visibleCount: state.visibleBlocks})
      : null;
    renderMillTop2d(ctx, {
      width: rect.width,
      height: rect.height,
      segments: elements.toolpathToggle.checked ? state.parsed.segments : [],
      visibleCount: elements.toolpathToggle.checked ? state.visibleBlocks : 0,
      currentPoint,
      lengthScale: unitScale(),
      lengthUnit: unitName(),
    });
    state.graphicsHits = [];
    state.geometryHover = null;
    state.geometrySelection = null;
  } else {
    drawGrid(rect.width, rect.height);
    drawKeepout();
    drawStock();
    drawReferenceGeometry();
    drawToolpath();
    drawToolAssembly2d();
    drawReferenceDeviationWitness();
    drawGeometryInspection();
    drawPinnedDimensions();
    drawStockSetupDimensions(rect.width, rect.height);
    drawDisplayHomeEstimate(rect.width, rect.height);
  }
  renderGeometryInspector();
  updateDimensionControls();
  const liveAttempts = isMillMode() ? [] : liveToolOperations();
  const firstBlockingWarning = (state.parsed.warnings || []).find((warning) => (
    warning?.verificationBlocked === true && Number.isFinite(warning.line)
  ));
  elements.empty.hidden = state.parsed.segments.length > 0;
  elements.empty.textContent = liveAttempts.length
    ? (liveAttempts.some((attempt) => attempt.blocked)
      ? "No drawable live-tool path — motion is blocked; see Program notes"
      : "Live-tool position established; the operation has no drawable path")
    : (isMillMode()
      ? (millPositionAt(state.parsed, {sourceLine: state.programLine, visibleCount: state.visibleBlocks})
        ? "Mill XYZ baseline established; no incoming rapid path was invented"
        : "No drawable mill motion — see Program notes")
      : firstBlockingWarning
        ? `Path blocked at line ${firstBlockingWarning.line} — see Program notes`
        : "No motion blocks found");
}

function updateBoundsReadout(bounds) {
  const output = $("boundsReadout");
  const decimals = elements.displayUnits.value === "inch" ? 3 : 1;
  const liveSummary = liveToolOperationSummary();
  const hasYBounds = Number.isFinite(bounds?.minY) && Number.isFinite(bounds?.maxY);
  const unresolvedLive = liveSummary.notDisplayed.length > 0;
  const pathOnly = hasYBounds
    || liveSummary.operations.length > 0
    || (state.parsed.cAxisMotions || []).length > 0
    || state.parsed.machineState?.blockedPathPreview === true;
  output.className = "";
  if (!bounds) {
    output.textContent = pathOnly ? "PATH ONLY · UNRESOLVED" : "—";
    output.className = pathOnly ? "warning-value" : "";
    output.title = pathOnly
      ? "Live-tool or C-axis operations are present, but no complete drawable dimensional bounds are available."
      : "No drawable program bounds are available.";
    return;
  }
  const zSpan = displayValue(bounds.maxZ - bounds.minZ).toFixed(decimals);
  const xSpan = displayValue(bounds.maxX - bounds.minX).toFixed(decimals);
  if (hasYBounds) {
    const ySpan = displayValue(bounds.maxY - bounds.minY).toFixed(decimals);
    output.textContent = `X ${xSpan} × Y ${ySpan} × Z ${zSpan} ${unitName()} · PATH ONLY${unresolvedLive ? " · UNRESOLVED" : ""}`;
  } else {
    output.textContent = `${zSpan} × ${xSpan} ${unitName()}${pathOnly ? ` · PATH ONLY${unresolvedLive ? " · UNRESOLVED" : ""}` : ""}`;
  }
  output.className = pathOnly ? "warning-value" : "";
  output.title = pathOnly
    ? `${unresolvedLive ? "One or more live-tool operations have no drawable segment. " : ""}Displayed centerline bounds only; non-axisymmetric stock removal and full driven-tool clearance are not modeled.`
    : "Drawable program Z × X bounds.";
}

function clearToolOffsetConfirmations() {
  toolOffsetConfirmationScope = null;
  confirmedToolOffsetPairings.clear();
}

function toolOffsetScopeFor(source, fileName) {
  return JSON.stringify([source, fileName,
    machineProfileForVerification(currentMachineProfile()), state.latheControllerSettings, elements.machineMode.value, elements.xMode.value, elements.programUnits.value]);
}

function toolOffsetPairingsForSource(source) {
  const scope = toolOffsetScopeFor(elements.input.value, currentProgramFileName());
  if (scope !== toolOffsetConfirmationScope) {
    confirmedToolOffsetPairings.clear();
    toolOffsetConfirmationScope = scope;
  }
  return source === elements.input.value ? [...confirmedToolOffsetPairings] : [];
}

function currentToolOffsetReview() {
  const reviews = state.parsed.toolOffsetReviews || [];
  return reviews.find(review => !review.confirmed) || reviews[0] || null;
}

function updateToolOffsetAlert() {
  const alert = $("toolOffsetAlert");
  const review = isMillMode() ? null : currentToolOffsetReview();
  alert.hidden = !review;
  if (!review) return;
  const confirmed = !state.programDirty && review.confirmed;
  alert.dataset.confirmed = String(confirmed);
  $("toolOffsetAlertTitle").textContent = state.programDirty
    ? "TOOL / OFFSET REVIEW INVALIDATED"
    : confirmed ? "TOOL / OFFSET PAIRING CONFIRMED" : "TOOL / OFFSET REVIEW REQUIRED";
  $("toolOffsetAlertMessage").textContent = state.programDirty
    ? "Program changed. Plot again to review its tool/offset pairings."
    : confirmed
      ? `Line ${review.line}: ${review.key} — Tool ${review.station} / offset ${review.offset} confirmed as intentional for this program and machine setup. Actual machine offset values are not verified.`
      : `Line ${review.line}: ${review.key} — Tool ${review.station} uses offset ${review.offset}. A wrong offset can misposition the tool. Verify the controller's two-digit tool / two-digit offset format and this pairing before proceeding. Downstream verification is blocked.`;
  const button = $("toolOffsetConfirm");
  button.textContent = confirmed ? "Require review again"
    : `Confirm tool ${review.station} / offset ${review.offset} is intentional`;
  button.disabled = state.programDirty;
  $("toolOffsetJump").disabled = state.programDirty;
}

function renderProgramNotes(notes) {
  $("warningCount").textContent = String(notes.length);
  const list = $("warningList");
  list.replaceChildren();
  if (!notes.length) {
    const item = document.createElement("li");
    item.className = "muted";
    item.textContent = "No parser warnings.";
    list.append(item);
    return;
  }
  [...notes].sort((a, b) => Number(b.code === "tool-offset-pairing-unconfirmed")
    - Number(a.code === "tool-offset-pairing-unconfirmed")).slice(0, 12).forEach((warning) => {
    const item = document.createElement("li");
    const controllerPreview = warning.code === "unsupported-m-code"
      && state.parsed.machineState?.blockedPathPreview === true;
    if ((warning.danger || warning.verificationBlocked) && !controllerPreview) item.className = "danger";
    else if (warning.info) item.className = "muted";
    item.textContent = `${warning.line ? `Line ${warning.line}: ` : ""}${warning.message}`;
    list.append(item);
  });
}

function updateMillStats() {
  const segments = state.parsed.segments || [];
  const decimals = millDisplayDecimals();
  const verifiedSegments = segments.filter((segment) => !segment.verificationBlocked);
  const unresolvedRapidSegments = verifiedSegments.filter((segment) => isRapidMotion(segment) && segment.rapidInterpolationUnresolved);
  const rapid = verifiedSegments
    .filter((segment) => isRapidMotion(segment) && !segment.rapidInterpolationUnresolved)
    .reduce((sum, segment) => sum + millSegmentLengthMm(segment), 0);
  const cut = verifiedSegments
    .filter((segment) => !isRapidMotion(segment))
    .reduce((sum, segment) => sum + millSegmentLengthMm(segment), 0);
  const bounds = millProgramBounds(segments);
  const blockedSegments = segments.filter((segment) => segment.verificationBlocked).length;

  $("motionCount").textContent = String(segments.length);
  $("cycleCount").textContent = "0";
  $("rapidDistance").textContent = unresolvedRapidSegments.length ? "UNRESOLVED" : formatDistance(rapid, decimals);
  $("rapidDistance").className = unresolvedRapidSegments.length ? "warning-value" : "";
  $("rapidDistance").title = unresolvedRapidSegments.length
    ? "At least one multi-axis G00 is shown only as an endpoint connector; rapid interpolation and total traveled distance depend on unconfigured controller/machine behavior."
    : "Exact commanded single-axis rapid distance.";
  $("cutDistance").textContent = formatDistance(cut, decimals);

  const pathStatus = $("liveToolStatus");
  pathStatus.textContent = blockedSegments ? `PATH ONLY · ${blockedSegments} BLOCKED` : "PATH ONLY";
  pathStatus.className = blockedSegments ? "danger-value" : "warning-value";
  pathStatus.title = "Programmed XYZ command centerlines only; no cutter, compensation, machine-position, stock, fixture, travel, or collision claim.";

  const stockStatus = $("stockRemoved");
  stockStatus.textContent = "NOT MODELED";
  stockStatus.className = "warning-value";
  stockStatus.title = "Mill stock removal is outside this bounded command-centerline viewer.";
  const collisionStatus = $("collisionStatus");
  collisionStatus.textContent = "NOT MODELED";
  collisionStatus.className = "warning-value";
  collisionStatus.title = "Mill cutter, holder, fixture, machine-envelope, and collision geometry are not modeled.";

  const cycleTime = estimateCycleTime(state.parsed, {xScale: 1});
  state.cycleTime = cycleTime;
  const timeText = cycleTime.hasEstimate ? qualifiedTime(cycleTime.seconds, cycleTime.quality) : "—";
  const timeTitle = [
    cycleTime.hasEstimate
      ? `Estimated programmed motion and dwell time: ${formatCycleTime(cycleTime.seconds)}.`
      : "Cycle time cannot be estimated from the available commanded path and feed data.",
    ...cycleTime.limitations,
    "Generic mill rapid rates, tool-change duration, and spindle acceleration are not modeled.",
  ].join(" ");
  for (const element of [$("cycleTimeHeader"), $("cycleTimeStat")]) {
    element.textContent = timeText;
    element.title = timeTitle;
    element.classList.toggle("partial-time", cycleTime.quality === "partial");
    element.classList.toggle("assumed-time", cycleTime.quality === "assumed");
  }

  const boundsOutput = $("boundsReadout");
  boundsOutput.className = "warning-value";
  boundsOutput.title = "Displayed canonical XYZ command-centerline bounds. Blocked display chords, when present, are included for review.";
  if (bounds && Number.isFinite(bounds.minY) && Number.isFinite(bounds.maxY)) {
    const xSpan = displayValue(bounds.maxX - bounds.minX).toFixed(decimals);
    const ySpan = displayValue(bounds.maxY - bounds.minY).toFixed(decimals);
    const zSpan = displayValue(bounds.maxZ - bounds.minZ).toFixed(decimals);
    boundsOutput.textContent = `X ${xSpan} × Y ${ySpan} × Z ${zSpan} ${unitName()} · PATH ONLY`;
  } else {
    boundsOutput.textContent = "PATH ONLY · UNRESOLVED";
  }

  const notes = [
    {
      line: null,
      info: true,
      message: "Mill mode preserves canonical XYZ programmed coordinates and analytic arc definitions. The canvas is a command-centerline display; cutter geometry, offsets, stock, fixtures, machine travel, and collision are not modeled.",
    },
    ...(state.parsed.warnings || []),
  ];
  for (const limitation of cycleTime.limitations) {
    notes.push({line: null, info: true, message: limitation});
  }
  renderProgramNotes(notes);
}

function updateStats() {
  if (isMillMode()) {
    updateMillStats();
    return;
  }
  const segments = state.parsed.segments;
  const verifiedSegments = segments.filter((segment) => !segment.verificationBlocked && !segment.liveToolBlocked);
  const rapid = verifiedSegments.filter((segment) => segment.type === "rapid").reduce((sum, segment) => sum + segmentLength(segment, xScale()), 0);
  const cut = verifiedSegments.filter((segment) => !isRapidMotion(segment) && !isLiveToolSegment(segment)).reduce((sum, segment) => sum + segmentLength(segment, xScale()), 0);
  const bounds = programBounds(segments, xScale());
  const collisionEvaluation = evaluateCollisions(segments, {
    ...collisionOptions(),
    unresolvedOperations: state.parsed.liveToolAttempts,
    cAxisMotions: state.parsed.cAxisMotions,
  });
  const {collisions} = collisionEvaluation;
  $("motionCount").textContent = String(segments.length);
  $("cycleCount").textContent = String(state.parsed.cycles.length);
  updateLiveToolStatus();
  $("rapidDistance").textContent = formatDistance(rapid);
  $("rapidDistance").className = "";
  $("rapidDistance").title = "Drawable rapid centerline distance.";
  $("cutDistance").textContent = formatDistance(cut);
  const machineOptions = machinePlotOptions(currentMachineProfile());
  const cycleTime = estimateCycleTime(state.parsed, {
    xScale: xScale(),
    rapidXMax: machineOptions.rapidXMax,
    rapidYMax: machineOptions.rapidYMax,
    rapidZMax: machineOptions.rapidZMax,
    rapidCMax: machineOptions.rapidCMax,
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
    "Excludes tool-change duration and spindle acceleration.",
  ];
  for (const element of [$("cycleTimeHeader"), $("cycleTimeStat")]) {
    element.textContent = timeText;
    element.title = timeTitleParts.join(" ");
    element.classList.toggle("partial-time", cycleTime.quality === "partial");
    element.classList.toggle("assumed-time", cycleTime.quality === "assumed");
  }
  updateBoundsReadout(bounds);
  const collisionStatus = $("collisionStatus");
  const pathOnlyCollisions = collisionEvaluation.warnings.length > 0
    || liveToolOperations().length > 0
    || (state.parsed.cAxisMotions || []).length > 0
    || state.parsed.machineState?.blockedPathPreview === true
    || state.parsed.machineState?.executionBlocked === true
    || state.parsed.toolOffsetReviews?.some(review => !review.confirmed);
  collisionStatus.textContent = collisions.length
    ? `${collisions.length} HIT${collisions.length === 1 ? "" : "S"}${pathOnlyCollisions ? " · PATH ONLY" : ""}`
    : pathOnlyCollisions ? "PATH ONLY" : "CLEAR";
  collisionStatus.className = collisions.length ? "danger-value" : (pathOnlyCollisions ? "warning-value" : "safe-value");
  collisionStatus.title = state.parsed.toolOffsetReviews?.some(review => !review.confirmed)
    ? "Tool/offset pairing review is unresolved. Command paths only; no complete machine clearance result."
    : state.parsed.machineState?.executionBlocked === true
    ? "Program verification is blocked. Only the supported command-path prefix was evaluated; see Program notes."
    : pathOnlyCollisions
    ? "The configured 2D chuck keep-out was evaluated for turning paths only. Live-tool 3D cutter/holder sweeps are not modeled."
    : "Configured 2D chuck keep-out status for supported turning paths.";
  const primaryProgramBlockers = state.parsed.warnings.filter((warning) => warning.verificationBlocked === true);
  const notes = [
    ...state.parsed.warnings.filter((warning) => warning.verificationBlocked !== true),
    ...assignmentWarnings(),
  ];
  const rapidAssumption = cycleTime.limitations.find((limitation) => limitation.includes("rapid timing assumes"));
  if (rapidAssumption) notes.unshift({line: null, info: true, message: rapidAssumption});
  if (collisions.length) {
    const lines = [...new Set(collisions.map((collision) => collision.segment.line).filter(Boolean))];
    notes.unshift({line: lines[0] || null, danger: true, message: `${collisions.length} toolpath move${collisions.length === 1 ? "" : "s"} enter the configured chuck keep-out envelope.`});
  }
  for (const warning of collisionEvaluation.warnings) {
    notes.unshift({...warning, verificationBlocked: true});
  }
  const stockDiameter = elements.stockToggle.checked ? Math.max(0, setupValue(elements.stockDiameter)) : 0;
  const stockLength = elements.stockToggle.checked ? Math.max(0, setupValue(elements.stockLength)) : 0;
  const analyzedStock = stockDiameter && stockLength
    ? stockProfileFor(stockDiameter, stockLength, state.parsed.segments.length, state.parsed.sourceLines)
    : null;
  const stockWarnings = (analyzedStock?.toolWarnings || []).filter(warning => warning.code !== "live-tool-stock-removal-unsupported");
  state.stockCuttingWarning = stockWarnings.length ? {...stockWarnings[0], blockedCuts: analyzedStock.turningBlockedCuts} : null;
  notes.unshift(...stockWarnings.map(warning => ({...warning, danger: !isToolSetupStockWarning(warning)})));
  if (analyzedStock?.nominalModeledCuts > 0 || analyzedStock?.compensatedModeledCuts > 0) {
    notes.push({line: null, info: true, message: analyzedStock.threadEnvelopeCuts > 0
      ? "THREAD SECTION ENVELOPE — nominal axisymmetric removal, not helical thread geometry, pitch-diameter inspection or holder clearance."
      : "NOMINAL CUTTER SIMULATION — published cutter dimensions and explicitly selected datum; physical accuracy and holder clearance are not verified."});
  }
  updateToolRotationAlert();
  const analyzedLiveStock = analyzedStock?.liveStock || null;
  const analyzedLiveSummary = summarizeAxialFlatBoreStock(analyzedLiveStock);
  const firstLiveCut = liveToolOperations().find((operation) => !operation.rapid);
  if (firstLiveCut) {
    if (analyzedLiveSummary.status === LIVE_STOCK_STATUS.MODELED) {
      const [firstBore] = analyzedLiveStock.axialBores;
      const boreLine = firstBore?.sourceLines?.[0] || firstLiveCut.line || null;
      const boreDetail = firstBore
        ? `: Ø${formatDistance(firstBore.radius * 2, elements.displayUnits.value === "inch" ? 4 : 3)} × ${formatDistance(firstBore.depth, elements.displayUnits.value === "inch" ? 4 : 3)} deep`
        : "";
      notes.unshift({
        line: boreLine,
        info: true,
        message: `Axial bore stock removal modeled${boreDetail}. Cutter-holder collision remains PATH ONLY.`,
      });
    } else {
      notes.unshift({
        line: firstLiveCut.line || null,
        verificationBlocked: true,
        message: "Live-tool stock removal is PATH ONLY: the programmed centerline is displayed, but this operation is outside the bounded axial-bore model.",
      });
    }
  }
  for (const cycle of state.parsed.cycles) {
    if (cycle.code === "G70") continue;
    notes.push({line: cycle.line, info: true, message: `${cycle.code} Type ${cycle.type} expanded to ${cycle.passes} roughing passes (P${cycle.p}–Q${cycle.q}).`});
  }
  notes.unshift(...primaryProgramBlockers);
  renderProgramNotes(notes);
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

function updateSpindleFeedReadout() {
  $("spindleFeedReadout").hidden = isMillMode();
  if (isMillMode()) return;
  const result = state.programDirty ? {reasons: ["PLOT REQUIRED — source has changed."]}
    : spindleFeedAtPosition(state.parsed, {sourceLine: state.programLine, visibleBlocks: state.visibleBlocks, xScale: xScale()});
  const number = value => new Intl.NumberFormat("en-US", {maximumSignificantDigits: 7}).format(value);
  const units = elements.displayUnits.value === "inch" ? "in" : "mm";
  $("spindleRpmReadout").textContent = Number.isFinite(result.rpm) ? `${number(result.rpm)} RPM` : "Unknown";
  const perMinute = state.feedReadoutMode !== "per-revolution";
  const formatFeed = (value, basis) => Number.isFinite(value)
    ? `${number(value / (units === "in" ? 25.4 : 1))} ${units}/${basis}` : "Unknown";
  $("cuttingFeedReadout").textContent = result.rapid ? "RAPID"
    : formatFeed(perMinute ? result.feed : result.feedPerRevolution, perMinute ? "min" : "rev");
  $("cuttingFeedSecondaryReadout").hidden = state.feedReadoutMode !== "both" || Boolean(result.rapid);
  $("cuttingFeedSecondaryReadout").textContent = formatFeed(result.feedPerRevolution, "rev")
    + (Number.isFinite(result.feedPerRevolution) ? "" : ` ${units}/rev`);
  for (const button of $("feedDisplayToggle").querySelectorAll("button")) {
    const mode = button.dataset.feedDisplay;
    button.textContent = mode === "both" ? "Both" : `${units}/${mode === "per-minute" ? "min" : "rev"}`;
    button.setAttribute("aria-pressed", String(mode === state.feedReadoutMode));
  }
  const cssUnits = result.cssUnits === "program" ? (result.programUnits === "in" ? "sfm" : "m/min") : result.cssUnits;
  const speedMode = result.spindleMode === "css" ? "G96" : result.spindleMode === "rpm" ? "G97" : "Mode unknown";
  const speedUnits = result.spindleMode === "css" ? (cssUnits === "sfm" ? "SFM" : cssUnits === "m/min" ? "m/min" : "units unknown") : "RPM";
  const runningStatus = result.spindleRunning === false ? "stopped" : result.spindleRunning === true ? `${result.spindleDirection.toUpperCase()} commanded` : "running state unknown";
  $("spindleStateReadout").textContent = result.spindleRunning === false ? "Stopped"
    : result.spindleRunning === true ? result.spindleDirection.toUpperCase() : "State unknown";
  $("spindleModeReadout").textContent = `${speedMode}${Number.isFinite(result.spindleSpeed) ? ` · S${number(result.spindleSpeed)} ${speedUnits}` : ""} · ${runningStatus}${result.spindleMode === "css" && result.cssUnits === "program" ? " · program units convention" : ""}`;
  $("feedModeReadout").textContent = result.feedMode === "per-minute" ? "G98" : result.feedMode === "per-revolution" ? "G99" : "Mode unknown";
  if (result.feedModeSource === "machine") $("feedModeReadout").textContent += " · machine start setting";
  if (Number.isFinite(result.commandedFeed)) {
    const basis = result.feedMode === "per-revolution" ? "rev" : result.feedMode === "per-minute" ? "min" : null;
    const feedUnits = basis ? ` ${result.programUnits === "in" ? "in" : "mm"}/${basis}` : " · feed basis unknown";
    $("feedModeReadout").textContent += ` · F${number(result.commandedFeed)}${feedUnits}`;
  }
  if (Number.isFinite(result.threadLeadMmPerRev)) $("feedModeReadout").textContent += " · thread lead";
  $("spindleLimitReadout").textContent = Number.isFinite(result.spindleLimit)
    ? `G50 S${number(result.spindleLimit)} · ${result.spindleRpmLimitMode === "css-only" ? "G96 only" : result.spindleRpmLimitMode === "both" ? "G96/G97" : "G97 effect unconfigured"}` : "G50 cap not set";
  const reasons = [...(result.reasons || [])];
  if (state.feedReadoutMode !== "per-minute" && result.feedPerRevolutionReason) reasons.push(result.feedPerRevolutionReason);
  $("spindleFeedStatus").textContent = reasons.join(" ");
  $("spindleFeedStatus").hidden = reasons.length === 0;
  const unknownFeed = !result.rapid && (!Number.isFinite(perMinute ? result.feed : result.feedPerRevolution)
    || (state.feedReadoutMode === "both" && !Number.isFinite(result.feedPerRevolution)));
  const readoutIssue = state.programDirty || !Number.isFinite(result.rpm) || unknownFeed;
  $("spindleFeedDetailsToggle").dataset.issue = String(readoutIssue);
  $("spindleFeedDetailsToggle").textContent = state.programDirty ? "Plot required" : readoutIssue ? "Why unknown?" : "Details";
}

function updateTransport({scrollProgram = false} = {}) {
  const totalBlocks = state.parsed.segments.length;
  const totalLines = state.parsed.sourceLines || programLineCount();
  const range = executionRangeForSourceLine(state.parsed.segments, state.programLine);
  const substep = range.count ? Math.max(1, Math.min(range.count, state.visibleBlocks - range.start)) : 0;
  const cycle = range.count > 1 ? state.parsed.segments[range.start]?.cycle : null;
  elements.timeline.max = String(Math.max(1, totalLines));
  elements.timeline.value = String(state.programLine);
  const blockText = range.count > 1
    ? `Line ${state.programLine} / ${totalLines} · ${cycle ? `${cycle} cycle` : "Move"} ${substep} / ${range.count}`
    : `Line ${state.programLine} / ${totalLines} · Block ${state.visibleBlocks} / ${totalBlocks}`;
  const programStopEvent = programStopEventAtPosition(state.parsed.timingEvents, state.parsed.segments, state);
  const atProgramStop = Boolean(programStopEvent);
  const atProgramEnd = programEndAtPosition(state.parsed.programEndLine, state.parsed.segments, state);
  const atBlockedPathPreview = blockedPathPreviewAtPosition(
    state.parsed.machineState?.blockedPathPreviewLine,
    state.parsed.segments,
    state,
  );
  const atSourceEnd = sourceEndAtPosition(state.parsed.segments, totalLines, state);
  const stopCommand = programStopEvent?.command === "M01" ? "M01" : "M00";
  const stopKind = stopCommand === "M01" ? "OPTIONAL STOP" : "PROGRAM STOP";
  const boundaryText = !state.playing && atProgramStop
    ? (atSourceEnd ? ` · ${stopCommand} ${stopKind} AT SOURCE END — no following program lines` : ` · ${stopCommand} ${stopKind} — Play resumes`)
    : (!state.playing && atProgramEnd
      ? " · M02/M30 PROGRAM END — Play restarts"
      : (!state.playing && atBlockedPathPreview ? " · PATH ONLY BOUNDARY — Playback blocked; Step inspects preview" : ""));
  elements.blockReadout.textContent = `${blockText}${boundaryText}`;
  elements.play.dataset.transportState = state.playing ? "pause" : "play";
  elements.play.setAttribute("aria-label", state.playing
    ? "Pause"
    : (atProgramStop
      ? (atSourceEnd ? `No following program lines after ${stopCommand} ${stopKind.toLowerCase()}` : `Resume after ${stopCommand} ${stopKind.toLowerCase()}`)
      : (atProgramEnd
        ? "Restart after M02 or M30 program end"
        : (atBlockedPathPreview ? "Playback blocked at unresolved command; use Step to inspect preview" : "Play"))));
  elements.timeline.disabled = state.programDirty;
  elements.play.disabled = state.programDirty || atBlockedPathPreview || (atProgramStop && atSourceEnd);
  elements.stepBack.disabled = state.programDirty || state.programLine <= 0;
  elements.stepForward.disabled = state.programDirty || (state.programLine >= totalLines && state.visibleBlocks >= range.end);
  updateReaderTime();
  updateSpindleFeedReadout();
  if (isMillMode()) {
    const point = millPositionAt(state.parsed, {sourceLine: state.programLine, visibleCount: state.visibleBlocks});
    const places = millDisplayDecimals();
    if (point) {
      $("millXReadout").textContent = displayValue(point.x).toFixed(places);
      $("millYReadout").textContent = displayValue(point.y).toFixed(places);
      $("millZReadout").textContent = displayValue(point.z).toFixed(places);
      const segment = state.visibleBlocks > 0
        ? state.parsed.segments[Math.min(state.visibleBlocks, totalBlocks) - 1]
        : null;
      elements.millReadout.title = segment?.verificationBlocked
        ? "Last verified XYZ before the blocked attempted move; its attempted endpoint is shown only by the red dashed review chord."
        : state.visibleBlocks === 0
          ? "Absolute G00 established this XYZ baseline; its unknown incoming rapid path is not drawn."
          : "Programmed command-center XYZ in the selected display units.";
    } else {
      $("millXReadout").textContent = "—";
      $("millYReadout").textContent = "—";
      $("millZReadout").textContent = "—";
      elements.millReadout.title = "Mill XYZ position is unresolved; establish a complete absolute G00 baseline.";
    }
  } else if (state.visibleBlocks > 0) {
    const segment = state.parsed.segments[Math.min(state.visibleBlocks, totalBlocks) - 1];
    const point = segment.end;
    const places = elements.displayUnits.value === "inch" ? 4 : 3;
    $("zReadout").textContent = displayValue(point.z).toFixed(places);
    $("xReadout").textContent = displayValue(point.x).toFixed(places);
  } else {
    const zero = elements.displayUnits.value === "inch" ? "0.0000" : "0.000";
    $("zReadout").textContent = zero;
    $("xReadout").textContent = zero;
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
  if (state.programDirty) return;
  const totalLines = state.parsed.sourceLines || programLineCount();
  if (!totalLines) return;
  state.playing = false;
  state.lastFrame = 0;
  const next = advanceExecutionPosition(state.parsed.segments, totalLines, state, direction);
  setProgramLine(next.line, {visibleBlocks: next.visibleBlocks});
}

function plotProgram({fit = true, clearDimensions = true} = {}) {
  const mill = isMillMode();
  const machine = currentMachineProfile();
  const plotOptions = machinePlotOptions(machine);
  const previousAssignments = state.toolAssignments;
  const previousAssignmentScope = state.toolAssignmentScope;
  const previousDocumentIdentity = state.toolAssignmentDocumentIdentity;
  const editOrigin = state.programDirty ? state.programEditOrigin : null;
  const nextAssignmentScope = mill
    ? previousAssignmentScope
    : programAssignmentScope(elements.input.value, {fileName: currentProgramFileName()});
  state.parsed = mill
    ? parseMillGcode(elements.input.value, {
      defaultUnits: selectedProgramUnits(machine),
      warnOnAssumedUnits: true,
      arcChordTolerance: graphicsQuality().arcChordTolerance,
    })
    : parseGcode(elements.input.value, {
      xMode: elements.xMode.value,
      arcChordTolerance: graphicsQuality().arcChordTolerance,
      ...plotOptions,
      confirmedToolOffsetPairings: toolOffsetPairingsForSource(elements.input.value),
    });
  if (!mill) {
    if (state.parsed.machineState?.initialPlaneUsed) {
      state.parsed.warnings.unshift({line: null, info: true,
        message: `Starting plane: X/Z (G18) from ${machine.name} setup. Programmed plane changes take precedence.`});
    }
    const nextDocumentIdentity = programToolDocumentIdentity(elements.input.value, {
      fileName: currentProgramFileName(),
    });
    if (plotOptions.initialPosition) {
      const source = String(plotOptions.initialPositionMode || "custom").replaceAll("-", " ").toUpperCase();
      state.parsed.warnings.unshift({
        line: null,
        info: true,
        message: `Initial rapid begins at the configured ${source} plotted tool-reference point. Turret, holder, and machine-coordinate transforms are not modeled by this point.`,
      });
    } else if (plotOptions.initialPositionMode !== "unknown" && plotOptions.initialPositionIssue === "incomplete") {
      state.parsed.warnings.unshift({
        line: null,
        info: true,
        message: `The selected ${String(plotOptions.initialPositionMode).replaceAll("-", " ")} start needs both plotted program-coordinate Initial X and Initial Z values; no incoming approach was invented.`,
      });
    }
    if (machine?.status === "draft") {
      state.parsed.warnings.unshift({line: null, info: true, message: `${machine.name} draft estimates are active; verify the machine definition before relying on approach or rapid geometry.`});
    }
    state.toolAssignments = editOrigin === "editor"
      ? reconcileToolAssignmentsForEditorEdit(state.parsed.executableToolCalls || [], previousAssignments, {
        editOrigin,
        previousDocumentIdentity,
        nextDocumentIdentity,
      })
      : reconcileToolAssignments(state.parsed.executableToolCalls || [], previousAssignments, {
        previousScope: previousAssignmentScope,
        nextScope: nextAssignmentScope,
      });
    if (editOrigin === "editor") {
      state.toolAssignments = Object.fromEntries(Object.entries(state.toolAssignments).map(([toolKey, assignment]) => [
        toolKey,
        assignment?.confirmationSource === "bundled-sample"
          ? {...assignment, confirmationSource: "job-retained"}
          : assignment,
      ]));
    }
    state.toolAssignments = Object.fromEntries(Object.entries(state.toolAssignments).map(([toolKey, assignment]) => {
      const assignmentRef = toolAssignmentAssemblyRef(assignment);
      const resolvedAssembly = assignmentRef && assignmentRef.legacy !== true
        ? resolveAssignableToolAssembly2d({id: assignmentRef.id, revision: assignmentRef.revision})
        : null;
      return [toolKey, normalizeVersionedToolAssignment(assignment, resolvedAssembly)];
    }));
    state.toolAssignmentScope = nextAssignmentScope;
    state.toolAssignmentDocumentIdentity = nextDocumentIdentity;
    if (isExactBundledTurningSample(elements.input.value, state.bundledSample)
      && (state.parsed.executableToolCalls || []).some((call) => call.key === "T0101")) {
      state.toolAssignments.T0101 ||= {
        ...createVersionedToolAssignment(DEFAULT_TOOL_ASSEMBLY_2D, {
          tipDatum: null, axialDirection: "negative-z", mountingOrientation: "standard", requiredSpindleDirection: "m3",
        }),
        confirmed: true,
        confirmationSource: "bundled-sample",
      };
    }
    if (isExactBundledProgram(elements.input.value, liveBoreSampleProgram, state.bundledSample)
      && (state.parsed.executableToolCalls || []).some((call) => call.key === "T0202")) {
      const cutter = resolveAssignableToolAssembly2d({id: LIVE_BORE_SAMPLE_CUTTER_ID, revision: 1});
      if (cutter) {
        state.toolAssignments.T0202 ||= {
          ...createVersionedToolAssignment(cutter),
          confirmed: true,
          confirmationSource: "bundled-sample",
        };
      }
    }
  }
  if (mill) state.toolAssignmentDocumentIdentity = null;
  else {
    state.parsed.commandedSegments = state.parsed.segments;
    state.parsed.commandedWarnings = state.parsed.warnings.slice();
    applyProgramNoseCompensation();
  }
  state.toolAssignmentRevision += 1;
  state.stockProfileCache = null;
  state.programLine = 0;
  state.visibleBlocks = 0;
  state.playing = false;
  state.programDirty = false;
  state.programEditOrigin = null;
  state.hoverBlockIndex = null;
  state.geometryHover = null;
  state.geometrySelection = null;
  if (clearDimensions) clearPinnedDimensions({disableMode: true});
  updateReferenceComparison();
  renderReferenceGeometryUi();
  renderProgramLineNumbers();
  renderProgramSyntax();
  if (!mill) renderProgramToolAssignments();
  const cycleStatus = state.parsed.cycles.filter((cycle) => cycle.code !== "G70").map((cycle) => `${cycle.code} ${cycle.passes} passes`).join(" • ");
  if (mill) {
    const blockingWarnings = state.parsed.warnings.filter((warning) => warning.verificationBlocked).length;
    elements.status.textContent = state.parsed.segments.length
      ? `${state.parsed.segments.length} mill motion blocks · XYZ command centerline${blockingWarnings ? ` · ${blockingWarnings} blocked issue${blockingWarnings === 1 ? "" : "s"}` : ""}`
      : blockingWarnings ? "No drawable mill path · see blocked Program notes" : "No mill motion found";
  } else {
    const liveSummary = liveToolOperationSummary();
    const blockedPreviewSegments = state.parsed.segments.filter((segment) => segment.pathPreviewOnly).length;
    const blockedPreviewLine = state.parsed.machineState?.blockedPathPreviewLine;
    elements.status.textContent = state.parsed.segments.length
      ? blockedPreviewSegments
        ? `${state.parsed.segments.length} motion blocks · PATH ONLY · blocked from line ${blockedPreviewLine}`
        : `${state.parsed.segments.length} motion blocks${cycleStatus ? ` • ${cycleStatus}` : ""}`
      : liveSummary.operations.length
        ? `No drawable live-tool path · ${liveSummary.blocked.length} blocked · ${liveSummary.notDisplayed.length} not drawn`
        : "No motion found";
  }
  updateStats(); updateTransport(); updateToolOffsetAlert();
  if (fit) fitView(); else draw();
}

function zoomAt(factor, x = elements.wrap.clientWidth / 2, y = elements.wrap.clientHeight / 2) {
  if (state.viewMode === "face" || (isMillMode() && state.viewMode === "2d")) return;
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
  if (!state.playing || state.programDirty) {
    state.playing = false;
    return;
  }
  const interval = 260 / Number(elements.speed.value);
  if (!state.lastFrame || timestamp - state.lastFrame >= interval) {
    state.lastFrame = timestamp;
    const totalLines = state.parsed.sourceLines || programLineCount();
    const next = advanceExecutionPosition(state.parsed.segments, totalLines, state, 1);
    state.programLine = next.line;
    state.visibleBlocks = next.visibleBlocks;
    begin3dInteractivePreview();
    const activeRange = executionRangeForSourceLine(state.parsed.segments, state.programLine);
    if (programStopAtPosition(state.parsed.timingEvents, state.parsed.segments, state)
      || programEndAtPosition(state.parsed.programEndLine, state.parsed.segments, state)
      || blockedPathPreviewAtPosition(
        state.parsed.machineState?.blockedPathPreviewLine,
        state.parsed.segments,
        state,
      )
      || (state.programLine >= totalLines && state.visibleBlocks >= activeRange.end)) {
      state.playing = false;
    }
    updateTransport({scrollProgram: true}); draw();
  }
  if (state.playing) requestAnimationFrame(animate);
}

const dimensionalInputs = [
  elements.jawDiameter, elements.clearance,
];
const stepCoordinateInputs = [elements.stepPlaneOffset, elements.stepAxialOrigin, elements.stepRadialOrigin];
let activeUnitScale = 25.4;

function refreshStockPlacementUi() {
  if (!appliedStockSetup) return;
  for (const [id, key] of Object.entries(stockSetupKeys)) {
    $(id).value = stockSetupDisplayInput(appliedStockSetup[key]);
    $(id).removeAttribute("aria-invalid");
  }
  $("stockFrontHint").textContent = `Relative to program Z0: use 0 for a flush front, or +${unitName() === "in" ? "0.125 in" : "3.175 mm"} for facing allowance.`;
  stockSetupMessage("Press Enter or leave a field to apply. Focus a field to see its dimension in 2D.");
}

function stockSetupDisplayInput(mm) {
  // Suppress binary tails without rounding machining input to a coarse UI step.
  return String(Number(displayValue(mm).toPrecision(15)));
}

function stockSetupMessage(message, error = false) {
  $("stockSetupStatus").textContent = message;
  $("stockSetupStatus").dataset.error = String(error);
}

function restoreStockSetupFromLegacyControls() {
  const value = (control) => control.value.trim() ? Number(control.value) * unitScale() : NaN;
  try {
    appliedStockSetup = roundBarSetupFromLegacy({
      diameter: value(elements.stockDiameter), length: value(elements.stockLength),
      gripLength: value(elements.stockGripLength), faceZ: value(elements.chuckFaceZ),
      pilotBoreDiameter: value($("stockPilotBore")),
    });
  } catch {
    appliedStockSetup = null;
    elements.stockToggle.checked = false;
    elements.collisionToggle.checked = false;
    for (const id of Object.keys(stockSetupKeys)) $(id).value = "";
    stockSetupMessage("Saved stock dimensions are invalid. Stock and chuck display are off; enter all four stock dimensions before enabling them.", true);
  }
}

function stockSetupFromControls() {
  const values = {};
  for (const control of [elements.stockDiameter, elements.stockStickout, elements.stockGripLength, elements.stockFrontZ, $("stockPilotBore")]) {
    const key = stockSetupKeys[control.id];
    const unchanged = appliedStockSetup && control.value === stockSetupDisplayInput(appliedStockSetup[key]);
    const value = unchanged ? appliedStockSetup[key] : control.value.trim() ? Number(control.value) * unitScale() : NaN;
    const valid = Number.isFinite(value) && (control === elements.stockFrontZ || value >= 0)
      && (control !== elements.stockDiameter || value > 0);
    control.setAttribute("aria-invalid", String(!valid));
    if (!valid) throw new RangeError("Enter a positive diameter, nonnegative stick-out and grip, and a numeric front Z.");
    values[key] = value;
  }
  return roundBarSetup(values);
}

function applyStockSetupControls() {
  try {
    appliedStockSetup = stockSetupFromControls();
  } catch (error) {
    stockSetupMessage(`Not applied — ${error.message} The last applied stock is still shown.`, true);
    return;
  }
  refreshStockPlacementUi();
  stockSetupMessage("Stock updated. Overall length and jaw position are calculated.");
  state.geometryHover = null;
  state.geometrySelection = null;
  clearPinnedDimensions({disableMode: true});
  updateStats(); fitView(); persistSession();
}

function refreshUnitUi() {
  const label = unitName();
  elements.unitReadout.textContent = label;
  $("millUnitReadout").textContent = label;
  document.querySelectorAll("[data-unit-label]").forEach((element) => { element.textContent = label; });
  const standardStep = elements.displayUnits.value === "inch" ? "0.01" : "0.1";
  elements.jawDiameter.step = standardStep;
  elements.clearance.step = elements.displayUnits.value === "inch" ? "0.005" : "0.1";
  elements.referenceGeometryTolerance.step = elements.displayUnits.value === "inch" ? "0.0001" : "0.001";
  refreshStockPlacementUi();
  updateGraphicsQualityHint();
}

function applyDisplayUnits(value) {
  const normalizedUnits = value === "mm" ? "mm" : "inch";
  const previousUnits = activeUnitScale === 25.4 ? "inch" : "mm";
  elements.displayUnits.value = normalizedUnits;
  const nextUnits = normalizedUnits;
  const nextScale = unitScale();
  const places = elements.displayUnits.value === "inch" ? 4 : 3;
  for (const input of dimensionalInputs) {
    const converted = convertUnitValue(Number(input.value) || 0, previousUnits, nextUnits);
    input.value = String(Number(converted.toFixed(places)));
  }
  for (const input of stepCoordinateInputs) {
    const text = input.value.trim();
    if (!text) continue;
    const retained = Number(input.dataset.canonicalMm);
    if (text === input.dataset.canonicalDisplayValue && Number.isFinite(retained)) {
      retainStepCoordinate(input, retained);
      continue;
    }
    const converted = convertUnitValue(Number(text), previousUnits, nextUnits);
    if (Number.isFinite(converted)) input.value = String(Number(converted.toPrecision(17)));
    delete input.dataset.canonicalMm;
    delete input.dataset.canonicalDisplayValue;
  }
  const convertedTolerance = convertUnitValue(Number(elements.referenceGeometryTolerance.value) || 0, previousUnits, nextUnits);
  elements.referenceGeometryTolerance.value = String(Number(convertedTolerance.toFixed(nextUnits === "inch" ? 8 : 7)));
  solidSetupDialog.displayUnitsChanged(previousUnits, nextUnits);
  if (state.referenceGeometry?.kind === "step" && state.referenceGeometry.pendingOperation === "section") {
    const mapping = stepMappingFromControls();
    state.referenceGeometry.pendingMessage = `Computing the exact ${mapping.normalAxis.toUpperCase()}=${formatReferenceDistance(mapping.planeOffsetMm)} B-rep section locally…`;
  }
  activeUnitScale = nextScale;
  refreshUnitUi();
  renderProgramToolAssignments();
  renderGeometryInspector();
  updateReferenceComparison();
  renderReferenceGeometryUi();
  updateStats(); updateTransport(); fitView();
  persistSession();
}

elements.displayUnits.addEventListener("change", () => applyDisplayUnits(elements.displayUnits.value));
$("feedDisplayToggle").addEventListener("click", event => {
  const mode = event.target.closest("button[data-feed-display]")?.dataset.feedDisplay;
  if (!["per-minute", "per-revolution", "both"].includes(mode)) return;
  state.feedReadoutMode = mode;
  updateSpindleFeedReadout();
});
$("spindleFeedDetailsToggle").addEventListener("click", () => {
  const details = $("spindleFeedDetails");
  details.hidden = !details.hidden;
  $("spindleFeedDetailsToggle").setAttribute("aria-expanded", String(!details.hidden));
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
  const cutter = state.toolLibraryTab === "cutters" ? millingToolLibraryRecordById(state.toolLibrarySelection) : null;
  const assignableRecord = assembly?.assignment?.assignable === true
    ? assembly
    : cutter?.demoCuttingEligibility?.eligible === true ? cutter : null;
  const definition = assignableRecord
    ? resolveAssignableToolAssembly2d({id: assignableRecord.id, revision: assignableRecord.revision})
    : null;
  if (!toolKey || !assignableRecord || !definition) return;
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
$("estimateHomeFromStroke").addEventListener("click", () => {
  const estimate = strokeSizedHomeEstimate(readMachineEditor(currentMachineProfile()));
  if (!estimate) {
    elements.machineSaveStatus.textContent = "Enter positive X and Z strokes to create a display estimate.";
    return;
  }
  elements.machineForm.elements.namedItem("displayHomeX").value = Number(estimate.x.toPrecision(10));
  elements.machineForm.elements.namedItem("displayHomeZ").value = Number(estimate.z.toPrecision(10));
  elements.machineForm.elements.namedItem("displayHomeMode").value = "estimate";
  elements.machineSaveStatus.textContent = "Stroke-sized display estimate prepared. Review coordinates, then save.";
});
elements.machineForm.elements.namedItem("liveToolDialect").addEventListener("change", (event) => {
  $("mf-initialFeedMode").disabled = event.target.value === "haas-lathe-ngc";
});
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
  clearToolAssignmentContext();
  state.bundledStepReference = false;
  revokeBundledDxfMaterialAuthority();
  updateProgramUnitsHint(machine);
  refreshUnitUi();
  plotProgram();
  persistSession();
});
elements.machineMode.addEventListener("change", () => {
  state.referenceIntentRevision += 1;
  if (state.referenceGeometry?.pending) {
    discardSupersededReferenceOperation(state.referenceGeometry, state.referenceGeneration);
  }
  clearToolAssignmentContext();
  state.bundledStepReference = false;
  revokeBundledDxfMaterialAuthority();
  if (elements.machineMode.value === "mill") solidSetupDialog.close();
  applyMachineModeUi();
  plotProgram();
  persistSession();
});

$("plotButton").addEventListener("click", () => { plotProgram(); persistSession(); });
$("loadSampleButton").addEventListener("click", () => loadProgram("sample-g71-rough.nc", sampleProgram, {bundledSample: true, machineMode: "lathe"}));
$("loadLiveBoreSampleButton").addEventListener("click", loadLiveBoreSample);
$("loadMillSampleButton").addEventListener("click", loadMillSample);
$("loadStepSampleButton").addEventListener("click", loadStepSample);
for (const id of ["loadSampleButton", "loadLiveBoreSampleButton", "loadMillSampleButton", "loadStepSampleButton"]) {
  $(id).addEventListener("click", () => $("sampleProgramMenu").removeAttribute("open"));
}
elements.loadDxfReferenceDemo.addEventListener("click", loadDxfSample);
elements.loadStepReferenceDemo.addEventListener("click", loadStepSample);
$("openButton").addEventListener("click", openProgram);
elements.importGeometry.addEventListener("click", openReferenceGeometry);
elements.importStep.addEventListener("click", openStepGeometry);
$("openSolidSetupButton").addEventListener("click", () => solidSetupDialog.open(state.referenceGeometry));
$("compareButton").addEventListener("click", openComparison);
elements.save.addEventListener("click", saveProgram);
elements.rememberJob.addEventListener("change", () => {
  if (!elements.rememberJob.checked) {
    disableRememberedJob("Saved job data was removed. The open job remains in memory until this tab closes or reloads.");
    writePrivatePreferences(localStorage, capturedPreferences(PRIVATE_PREFERENCE_IDS));
    return;
  }
  if (!setRememberJobEnabled(localStorage, true)) {
    disableRememberedJob("Browser storage is unavailable. The job remains private and was not stored.");
    return;
  }
  state.rememberJob = true;
  if (persistSession()) {
    elements.sessionPrivacyMessage.textContent = "This job is saved locally on this device. Turn this off when persistence is no longer needed.";
  }
});
elements.clearLocalData.addEventListener("click", () => {
  clearTimeout(persistTimer);
  const removed = clearLocalApplicationData(localStorage, sessionStorage);
  state.rememberJob = false;
  state.rememberedJobSaved = false;
  renderSessionPrivacy();
  elements.sessionPrivacyMessage.textContent = removed
    ? `Cleared ${removed} local G-Code Studio ${removed === 1 ? "record" : "records"}. The open job remains only in memory.`
    : "No saved G-Code Studio data was present. The open job remains only in memory.";
});
elements.fileInput.addEventListener("change", async () => {
  await loadBrowserFile(elements.fileInput.files[0]);
  elements.fileInput.value = "";
});
elements.geometryFileInput.addEventListener("change", async () => {
  await loadBrowserDxf(elements.geometryFileInput.files[0]);
  elements.geometryFileInput.value = "";
});
elements.stepFileInput.addEventListener("change", async () => {
  await loadBrowserStep(elements.stepFileInput.files[0]);
  elements.stepFileInput.value = "";
});
elements.referenceGeometryUnits.addEventListener("change", () => {
  if (state.referenceGeometry?.kind !== "dxf") return;
  revokeBundledDxfMaterialAuthority({remap: false});
  state.referenceGeometry.unitsAuthority = elements.referenceGeometryUnits.value ? "user-confirmed" : null;
  refreshReferenceGeometry({fit: true});
});
for (const control of [
  elements.referenceGeometryOriginX, elements.referenceGeometryOriginY,
  elements.referenceGeometryZDirection, elements.referenceGeometryXDirection,
]) {
  control.addEventListener("change", () => {
    if (state.referenceGeometry?.kind === "dxf") {
      revokeBundledDxfMaterialAuthority({remap: false});
      refreshReferenceGeometry({fit: true});
    }
  });
}
for (const control of [
  elements.referenceGeometryOriginX,
  elements.referenceGeometryOriginY,
  elements.referenceGeometryTolerance,
]) {
  control.addEventListener("input", () => {
    if (control !== elements.referenceGeometryTolerance) revokeBundledDxfMaterialAuthority({remap: false});
    invalidateReferenceComparison(
      "APPLY CHANGE",
      "A reference mapping or comparison threshold changed; finish the edit before using the path result.",
    );
  });
}
elements.referenceDxfMaterialContour.addEventListener("change", () => {
  const reference = state.referenceGeometry;
  if (reference?.kind !== "dxf") return;
  reference.bundledMaterialAuthority = null;
  elements.referenceDxfMaterialInside.checked = false;
  refreshReferenceGeometry();
});
elements.referenceDxfMaterialInside.addEventListener("change", () => {
  const reference = state.referenceGeometry;
  if (reference?.kind !== "dxf") return;
  reference.bundledMaterialAuthority = null;
  refreshReferenceGeometry();
});
elements.referenceGeometryTolerance.addEventListener("change", () => {
  updateReferenceComparison();
  renderReferenceGeometryUi();
  draw();
});
for (const control of [
  elements.stepAxialAxis, elements.stepRadialAxis, elements.stepNormalAxis, elements.stepPlaneOffset,
]) {
  control.addEventListener("change", () => {
    const reference = state.referenceGeometry;
    if (reference?.kind !== "step") return;
    solidSetupDialog.invalidateDraft();
    reference.sectionRevision = (reference.sectionRevision ?? 0) + 1;
    reference.sectionDto = null;
    reference.guidedSetup = null;
    reference.setupDiagnostics = [];
    reference.mapped = null;
    reference.entities = [];
    reference.displayWorkload = null;
    reference.ready = false;
    state.referenceComparison = null;
    populateStepContours(null);
    renderReferenceGeometryUi();
    draw();
  });
}
for (const control of [
  elements.stepAxialOrigin, elements.stepRadialOrigin,
  elements.stepAxialDirection, elements.stepRadialDirection,
]) {
  control.addEventListener("change", () => {
    if (state.referenceGeometry?.kind === "step") {
      solidSetupDialog.invalidateDraft();
      state.referenceGeometry.guidedSetup = null;
    }
    mapCurrentStepSection({fit: true});
  });
}
for (const control of [elements.stepAxialOrigin, elements.stepRadialOrigin]) {
  control.addEventListener("input", () => invalidateReferenceComparison(
    "APPLY CHANGE",
    "A STEP origin changed; finish the edit before using the path result.",
  ));
}
elements.stepContour.addEventListener("change", () => {
  solidSetupDialog.invalidateDraft();
  mapCurrentStepSection({fit: true});
});
elements.buildStepSection.addEventListener("click", buildStepSection);
elements.referenceGeometryToggle.addEventListener("change", () => {
  if (!elements.referenceGeometryToggle.checked) state.showReferenceWitness = false;
  state.geometryHover = null;
  state.geometrySelection = null;
  clearPinnedDimensions({disableMode: true});
  renderReferenceGeometryUi();
  fitView();
});
elements.inspectReferenceDeviation.addEventListener("click", () => {
  if (elements.inspectReferenceDeviation.disabled) return;
  state.showReferenceWitness = !state.showReferenceWitness;
  renderReferenceGeometryUi();
  draw();
});
elements.toolRotationSetup.addEventListener("click", () => {
  const first = toolRotationReport().first || state.stockCuttingWarning;
  if (!first) return;
  elements.programToolsSetup.open = true;
  if (first.code?.includes("bore")) {
    $("stockPilotBore").scrollIntoView({block: "nearest"});
    $("stockPilotBore").focus();
    return;
  }
  const card = [...elements.programToolList.querySelectorAll(".program-tool-card")]
    .find((candidate) => candidate.dataset.toolKey === first.toolKey);
  card?.scrollIntoView({block: "nearest"});
  const label = first.code === "tool-mounting-unset" ? "Mounting orientation" : "Required spindle direction";
  card?.querySelector(`[aria-label="${label} for ${first.toolKey}"]`)?.focus({preventScroll: true});
});
$("toolOffsetConfirm").addEventListener("click", () => {
  if (state.programDirty || isMillMode()) return;
  const review = currentToolOffsetReview();
  if (!review) return;
  toolOffsetPairingsForSource(elements.input.value);
  if (review.confirmed) confirmedToolOffsetPairings.delete(review.key);
  else confirmedToolOffsetPairings.add(review.key);
  plotProgram({fit: false, clearDimensions: false});
  if (elements.compareDialog.open && state.comparisonOriginal) renderComparison();
});
$("toolOffsetJump").addEventListener("click", () => {
  if (state.programDirty) return;
  const review = currentToolOffsetReview();
  if (!review) return;
  const lines = elements.input.value.split("\n");
  const offset = lines.slice(0, review.line - 1).reduce((total, line) => total + line.length + 1, 0);
  elements.input.setSelectionRange(offset, offset);
  setProgramLine(review.line);
  state.highlightedSourceLine = review.line;
  scrollProgramLineIntoView(review.line);
  positionProgramLineHighlight();
  renderProgramRiskHighlights();
  elements.editor.scrollIntoView({block: "nearest", inline: "nearest"});
  elements.input.focus({preventScroll: true});
});
elements.toolRotationJump.addEventListener("click", () => {
  const first = toolRotationReport().first || state.stockCuttingWarning;
  if (!first) return;
  if (Number.isInteger(first.blockIndex)) setProgramLine(first.line, {visibleBlocks: first.blockIndex + 1});
  else setProgramLine(first.line);
  state.highlightedSourceLine = first.sourceLine || first.line;
  scrollProgramLineIntoView(state.highlightedSourceLine);
  positionProgramLineHighlight();
  renderProgramRiskHighlights();
  elements.input.focus({preventScroll: true});
});
elements.profilePenetrationJump.addEventListener("click", () => {
  const target = worstProfilePenetrationResult() || materialEntryDiagnostics(state.referenceComparison)[0];
  if (!target?.sourceLine || state.programDirty) return;
  const sourceLine = Number(target.sourceLine);
  const executionLine = Number(target.executionLine);
  const globalBlockIndex = Number(target.globalBlockIndex);
  const targetExecutionLine = Number.isInteger(executionLine) && executionLine > 0
    ? executionLine
    : sourceLine;
  setProgramLine(targetExecutionLine, {
    visibleBlocks: Number.isInteger(globalBlockIndex) && globalBlockIndex >= 0 ? globalBlockIndex + 1 : null,
  });
  if (Number.isInteger(sourceLine) && sourceLine > 0) {
    state.highlightedSourceLine = sourceLine;
    scrollProgramLineIntoView(sourceLine);
    positionProgramLineHighlight();
    renderProgramRiskHighlights();
  }
  elements.status.textContent = `Nominal-material check · source line ${sourceLine || targetExecutionLine}`;
  elements.input.focus({preventScroll: true});
});
elements.removeGeometry.addEventListener("click", removeReferenceGeometry);
elements.originalFileInput.addEventListener("change", async () => {
  const file = elements.originalFileInput.files[0];
  elements.originalFileInput.value = "";
  const pickerRevision = state.comparisonPickerRevision;
  state.comparisonPickerRevision = null;
  if (pickerRevision !== null && pickerRevision !== state.comparisonOriginalRevision) return;
  if (!file) return;
  const revision = ++state.comparisonOriginalRevision;
  try {
    const content = await file.text();
    if (revision === state.comparisonOriginalRevision) setComparisonOriginal(file.name, content);
  } catch {
    if (revision === state.comparisonOriginalRevision) elements.status.textContent = "Could not read the original program.";
  }
});
elements.originalFileInput.addEventListener("cancel", () => { state.comparisonPickerRevision = null; });
$("chooseOriginalButton").addEventListener("click", chooseComparisonOriginal);
$("chooseOriginalEmptyButton").addEventListener("click", chooseComparisonOriginal);
$("snapshotOriginalButton").addEventListener("click", () => setComparisonOriginal(`${elements.fileName.textContent || "program.nc"} · snapshot`, elements.input.value, {snapshot: true}));
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
for (const [layer, control] of [["original", elements.compareOriginalToggle], ["revised", elements.compareRevisedToggle], ["matching", elements.compareMatchingToggle]]) {
  control.addEventListener("click", () => {
    state.compareLayers[layer] = !state.compareLayers[layer];
    control.setAttribute("aria-pressed", String(state.compareLayers[layer]));
    drawComparisonGraphics();
  });
}
elements.compareZoomIn.addEventListener("click", () => zoomComparisonGraphics(1.25));
elements.compareZoomOut.addEventListener("click", () => zoomComparisonGraphics(0.8));
elements.compareFit.addEventListener("click", fitComparisonGraphics);
for (const canvas of [elements.originalCompareCanvas, elements.revisedCompareCanvas, elements.overlayCompareCanvas]) {
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomComparisonGraphics(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002), canvas, event);
  }, {passive: false});
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || state.compareDrag || !state.compareViewport) return;
    state.compareDrag = {canvas, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      offsetZ: state.compareCamera.offsetZ, offsetX: state.compareCamera.offsetX, scale: state.compareViewport.scale};
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-panning");
  });
  canvas.addEventListener("pointermove", (event) => {
    const drag = state.compareDrag;
    if (!drag || drag.canvas !== canvas || drag.pointerId !== event.pointerId) return;
    state.compareCamera.offsetZ = drag.offsetZ - (event.clientX - drag.x) / drag.scale;
    state.compareCamera.offsetX = drag.offsetX + (event.clientY - drag.y) / drag.scale;
    drawComparisonGraphics();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(type, (event) => {
    if (state.compareDrag?.canvas !== canvas || state.compareDrag.pointerId !== event.pointerId) return;
    stopComparisonDrag();
  });
}
elements.fitGeometryDifferences.addEventListener("change", () => {
  if (elements.fitGeometryDifferences.checked) elements.fitGeometryPart.checked = false;
  fitComparisonGraphics();
});
elements.fitGeometryPart.addEventListener("change", () => {
  if (elements.fitGeometryPart.checked) elements.fitGeometryDifferences.checked = false;
  fitComparisonGraphics();
});
elements.graphicsInfoButton.addEventListener("click", () => setGraphicsInfo(elements.graphicsInfoPanel.hidden));
$("closeGraphicsInfoButton").addEventListener("click", () => setGraphicsInfo(false));
elements.previousCompareChange.addEventListener("click", () => scrollToComparisonChange(state.compareChangeIndex < 0 ? -1 : state.compareChangeIndex - 1));
elements.nextCompareChange.addEventListener("click", () => scrollToComparisonChange(state.compareChangeIndex + 1));
$("fitButton").addEventListener("click", fitView);
$("zoomInButton").addEventListener("click", () => zoomAt(1.25));
$("zoomOutButton").addEventListener("click", () => zoomAt(0.8));
function setGraphicsDimension(mode) {
  if (!["2d", "face", "3d"].includes(mode)) return;
  if (isMillMode() && mode === "face") mode = "2d";
  state.viewMode = mode;
  const threeDimensional = mode === "3d";
  const face = mode === "face";
  const twoDimensional = mode === "2d";
  if (!threeDimensional) {
    cancel3dPrecisionRedraw();
    navigation3dRenderer.cancel();
    state.preview3dUntil = 0;
  }
  state.hoverBlockIndex = null;
  state.geometryHover = null;
  state.graphicsHits = [];
  elements.view2d.classList.toggle("active", twoDimensional);
  elements.viewFace.classList.toggle("active", face);
  elements.view3d.classList.toggle("active", threeDimensional);
  elements.view2d.setAttribute("aria-pressed", String(twoDimensional));
  elements.viewFace.setAttribute("aria-pressed", String(face));
  elements.view3d.setAttribute("aria-pressed", String(threeDimensional));
  elements.canvas.setAttribute("aria-label", isMillMode()
    ? (threeDimensional
      ? "Interactive three-dimensional mill command-centerline backplot in native XYZ coordinates. Stock, cutter geometry, compensation, and collision are not modeled."
      : "Top X/Y projection of the mill command-centerline path. Z motion is retained in geometry and shown in the coordinate readout and 3D view.")
    : face
    ? "Machine-oriented live-tool face view from the free end toward the chuck, with positive X up and positive Y left. Shows programmed X/Y centerlines and any supported analytic axial bores; unsupported material removal and complete cutter-holder collision remain path-only."
    : threeDimensional
      ? "Interactive three-dimensional lathe backplot."
      : "Interactive lathe backplot. Click component geometry to inspect it, or use Dimension to pin exact line and radius measurements.");
  elements.canvas.style.cursor = threeDimensional ? "grab" : (face || isMillMode() ? "default" : "crosshair");
  elements.viewCube.hidden = !threeDimensional;
  elements.faceViewStatus.hidden = !face;
  if (!twoDimensional) {
    state.geometrySelection = null;
    state.dimensionMode = false;
  }
  elements.wrap.classList.toggle("three-d", threeDimensional);
  elements.wrap.classList.toggle("face-view", face);
  $("fitButton").disabled = face;
  $("zoomInButton").disabled = face || (isMillMode() && twoDimensional);
  $("zoomOutButton").disabled = face || (isMillMode() && twoDimensional);
  state.drag = null;
  updateDimensionControls();
  updateToolControls();
  renderReferenceGeometryUi();
  fitView();
}
elements.view2d.addEventListener("click", () => setGraphicsDimension("2d"));
elements.viewFace.addEventListener("click", () => setGraphicsDimension("face"));
elements.view3d.addEventListener("click", () => setGraphicsDimension("3d"));
elements.toolOverlay.addEventListener("click", () => {
  if (isMillMode() || state.viewMode !== "2d") return;
  state.showTool2d = !state.showTool2d;
  updateToolControls();
  draw();
});
elements.dimensionButton.addEventListener("click", () => {
  if (isMillMode() || state.viewMode !== "2d") return;
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
elements.timeline.addEventListener("input", () => {
  if (state.programDirty) return;
  state.playing = false;
  setProgramLine(Number(elements.timeline.value));
});
elements.stepBack.addEventListener("click", () => stepProgram(-1));
elements.stepForward.addEventListener("click", () => stepProgram(1));
elements.play.addEventListener("click", () => {
  if (state.programDirty) return;
  const totalLines = state.parsed.sourceLines || programLineCount();
  if (!totalLines) return;
  const atProgramEnd = programEndAtPosition(state.parsed.programEndLine, state.parsed.segments, state);
  const atBlockedPathPreview = blockedPathPreviewAtPosition(
    state.parsed.machineState?.blockedPathPreviewLine,
    state.parsed.segments,
    state,
  );
  const atSourceEnd = sourceEndAtPosition(state.parsed.segments, totalLines, state);
  if (atBlockedPathPreview) return;
  if (atSourceEnd && programStopAtPosition(state.parsed.timingEvents, state.parsed.segments, state)) return;
  state.playing = !state.playing;
  if (state.playing && (atProgramEnd || atSourceEnd)) {
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

elements.optionalStop.addEventListener("change", () => {
  const position = state.programDirty ? null : {
    line: state.programLine,
    visibleBlocks: state.visibleBlocks,
    range: executionRangeForSourceLine(state.parsed.segments, state.programLine),
  };
  state.playing = false;
  state.lastFrame = 0;
  updateOptionalStopControl();
  plotProgram({fit: false, clearDimensions: false});
  if (position) {
    const range = executionRangeForSourceLine(state.parsed.segments, position.line);
    const visibleBlocks = position.visibleBlocks >= position.range.end
      ? range.end
      : Math.min(range.end, range.start + Math.max(0, position.visibleBlocks - position.range.start));
    setProgramLine(position.line, {visibleBlocks});
  }
  if (!elements.codeInspector.hidden) inspectProgramTokenAtCaret({hideWhenNone: true});
});

for (const control of [
  elements.orientation, elements.xMode, elements.stockToggle,
  elements.jawDiameter, elements.clearance, elements.collisionToggle,
]) {
  control.addEventListener("change", () => {
    if (!appliedStockSetup && [elements.stockToggle, elements.collisionToggle].includes(control)) {
      control.checked = false;
      stockSetupMessage("Enter valid stock dimensions before enabling stock or the chuck envelope.", true);
      return;
    }
    state.geometryHover = null;
    state.geometrySelection = null;
    clearPinnedDimensions({disableMode: true});
    if (control === elements.xMode) {
      state.bundledStepReference = false;
      revokeBundledDxfMaterialAuthority();
      plotProgram();
    } else { updateStats(); fitView(); }
    persistSession();
  });
}

for (const control of [elements.stockDiameter, elements.stockStickout, elements.stockGripLength, elements.stockFrontZ, $("stockPilotBore")]) {
  control.addEventListener("input", () => {
    control.removeAttribute("aria-invalid");
    stockSetupMessage("Edit pending — press Enter or leave this field to apply. Drawing shows the last applied stock.");
  });
  control.addEventListener("change", applyStockSetupControls);
  control.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); control.blur(); } });
  control.addEventListener("focus", () => { stockDimensionFocus = stockSetupKeys[control.id]; draw(); });
  control.addEventListener("blur", () => { stockDimensionFocus = null; draw(); });
}
$("stockDimensionsToggle").addEventListener("change", fitView);

elements.canvas.addEventListener("wheel", (event) => { event.preventDefault(); const rect = elements.canvas.getBoundingClientRect(); zoomAt(event.deltaY < 0 ? 1.12 : 0.89, event.clientX - rect.left, event.clientY - rect.top); }, {passive: false});
function graphicsHitForEvent(event) {
  if (state.programDirty) return null;
  if (isMillMode() && state.viewMode === "2d") return null;
  if (!graphicsSelectionEnabled(state.viewMode)) return null;
  const rect = elements.canvas.getBoundingClientRect();
  return graphicsHitAt(state.graphicsHits, event.clientX - rect.left, event.clientY - rect.top, {currentBlock: state.visibleBlocks});
}
function geometryHitForEvent(event) {
  if (isMillMode() || state.viewMode !== "2d") return null;
  const rect = elements.canvas.getBoundingClientRect();
  return geometryHitAt(
    state.componentGeometry,
    geometryToScreen,
    {x: event.clientX - rect.left, y: event.clientY - rect.top},
  );
}
function updateGraphicsHover(event) {
  if (state.viewMode === "face") {
    state.hoverBlockIndex = null;
    state.geometryHover = null;
    elements.canvas.style.cursor = "default";
    return null;
  }
  if (isMillMode() && state.viewMode === "2d") {
    state.hoverBlockIndex = null;
    state.geometryHover = null;
    elements.canvas.style.cursor = "default";
    return null;
  }
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
  if (isMillMode() || state.viewMode !== "2d") return false;
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
  if (state.programDirty) return false;
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
  if (state.viewMode === "face") return;
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
  if (isMillMode()) return;
  if (event.button !== 0) return;
  elements.canvas.setPointerCapture(event.pointerId);
  state.drag = {mode: "2d", x: event.clientX, y: event.clientY, offsetX: state.camera.offsetX, offsetY: state.camera.offsetY, button: event.button, moved: false};
  elements.canvas.style.cursor = "grabbing";
});
elements.canvas.addEventListener("pointermove", (event) => {
  if (state.viewMode === "face") {
    elements.canvas.style.cursor = "default";
    return;
  }
  if (isMillMode() && state.viewMode === "2d") {
    elements.canvas.style.cursor = "default";
    return;
  }
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
  elements.canvas.style.cursor = state.viewMode === "face" || (isMillMode() && state.viewMode === "2d")
    ? "default"
    : (hasHover ? "pointer" : (state.viewMode === "3d" ? "grab" : "crosshair"));
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
  elements.canvas.style.cursor = state.viewMode === "face" || (isMillMode() && state.viewMode === "2d")
    ? "default"
    : (state.viewMode === "3d" ? "grab" : "crosshair");
  updateTransport();
});
elements.input.addEventListener("scroll", () => {
  positionProgramLineHighlight();
  positionProgramSyntax();
  renderProgramSearchHighlights();
  renderProgramRiskHighlights();
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
    if (document.activeElement !== elements.input || state.playing) return;
    syncProgramLineToCursor();
    if (!elements.codeInspector.hidden) inspectProgramTokenAtCaret({hideWhenNone: true});
  });
}
document.addEventListener("selectionchange", () => {
  if (document.activeElement === elements.input) scheduleProgramCursorSync();
});
elements.input.addEventListener("click", () => {
  syncProgramLineToCursor({force: true});
  inspectProgramTokenAtCaret({hideWhenNone: true});
});
elements.input.addEventListener("keydown", (event) => {
  if (programCursorNavigationKey(event.key)) scheduleProgramCursorSync();
});
elements.input.addEventListener("input", markProgramChanged);
elements.codeInspectorClose.addEventListener("click", () => {
  elements.codeInspector.hidden = true;
  elements.input.focus({preventScroll: true});
});
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
window.addEventListener("resize", () => {
  renderProgramSearchHighlights();
  renderProgramRiskHighlights();
});

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
  const file = event.dataTransfer?.files?.[0];
  const filename = file?.name?.toLowerCase() || "";
  if (filename.endsWith(".dxf")) await loadBrowserDxf(file);
  else if (filename.endsWith(".step") || filename.endsWith(".stp")) await loadBrowserStep(file);
  else await loadBrowserFile(file);
});

window.addEventListener("keydown", (event) => {
  if (event.defaultPrevented) return;
  if (state.solidSetupActive) return;
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
  const programRevision = ++state.programRevision;
  const initial = await window.pywebview.api.get_initial_file();
  if (state.programRevision !== programRevision) return;
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

createPaneSplitter({
  container: elements.workspace,
  separator: elements.paneSplitter,
  primaryPane: elements.programPanel,
  orientation: "vertical",
  minSize: () => window.matchMedia("(min-width: 1101px)").matches ? 255 : 230,
  maxSize: 720,
  secondaryMinSize: () => window.matchMedia("(min-width: 1101px)").matches
    ? 740
    : 408,
  defaultSize: 330,
  step: 16,
  largeStep: 64,
  applySize: (size) => elements.workspace.style.setProperty("--program-pane-width", `${size}px`),
  onChange: () => requestAnimationFrame(() => {
    resizeCanvas();
    positionProgramSyntax();
    renderProgramSearchHighlights();
    renderProgramRiskHighlights();
  }),
  label: "Resize program and graphics panes",
  controls: [elements.programPanel.id, elements.graphicsPanel.id],
});

new ResizeObserver(resizeCanvas).observe(elements.wrap);
new ResizeObserver(() => {
  if (elements.compareDialog.open && state.compareView === "graphics") requestAnimationFrame(drawComparisonGraphics);
}).observe(elements.compareGraphicsAudit);
const legacySessionMigration = migrateLegacySession(localStorage);
const legacyMachineProfileMigration = quarantineLegacyMachineProfileCache(localStorage);
applyStoredPreferences(readPrivatePreferences(localStorage));
state.machineProfiles = mergeMachineProfiles(DEFAULT_MACHINE_PROFILES, readMachineProfileCache());
renderMachineSelect();
state.rememberJob = isRememberJobEnabled(localStorage);
const rememberedJob = state.rememberJob ? readRememberedJob(localStorage) : null;
state.rememberJob = isRememberJobEnabled(localStorage);
const restored = restoreSession(rememberedJob);
state.rememberedJobSaved = restored;
renderSessionPrivacy();
const startupPrivacyMessages = [];
if (legacySessionMigration.removed) startupPrivacyMessages.push("Removed the previous plaintext autosave. This job now starts in private RAM-only mode.");
if (legacyMachineProfileMigration.status === "quarantined") {
  startupPrivacyMessages.push("Quarantined a legacy unscoped machine-profile cache and did not load it. Re-enter trusted machine settings before use.");
} else if (legacyMachineProfileMigration.status === "conflict") {
  startupPrivacyMessages.push("Ignored conflicting legacy machine-profile caches and did not load either. Use Clear local data before entering trusted machine settings.");
} else if (legacyMachineProfileMigration.status === "retained") {
  startupPrivacyMessages.push("Ignored a legacy unscoped machine-profile cache, but browser storage prevented quarantining it. Use Clear local data before entering trusted machine settings.");
}
if (startupPrivacyMessages.length) elements.sessionPrivacyMessage.textContent = startupPrivacyMessages.join(" ");
const requestedBundledStepReferenceRestore = restored
  && state.bundledStepReference
  && isExactBundledProgram(elements.input.value, stepSampleProgram, state.bundledSample);
const restoreBundledStepReference = requestedBundledStepReferenceRestore
  && elements.machineMode.value === "lathe"
  && elements.xMode.value === "diameter";
if (requestedBundledStepReferenceRestore && !restoreBundledStepReference) {
  state.bundledStepReference = false;
}
activeUnitScale = unitScale();
restoreStockSetupFromLegacyControls();
elements.referenceGeometryTolerance.value = String(Number((DEFAULT_PROFILE_TOLERANCE_MM / activeUnitScale).toFixed(
  elements.displayUnits.value === "inch" ? 8 : 7,
)));
refreshUnitUi();
updateProgramUnitsHint();
updateToolControls();
if (!restored) {
  elements.input.value = sampleProgram;
  state.bundledSample = true;
}
renderProgramIdentity();
applyMachineModeUi();
updateOptionalStopControl();
plotProgram();
if (restoreBundledStepReference) void loadStepSample({reuseProgram: true});
else if (requestedBundledStepReferenceRestore) persistSession();

// Report this loaded application, never the version of a newer network asset.
$("appVersion").textContent = APP_VERSION;
$("appVersion").title = `Loaded application version ${APP_VERSION} · build ${APP_BUILD}`;
$("appVersion").setAttribute("aria-label", `Application version ${APP_VERSION}`);
