export const LIVE_TOOL_DIALECTS = Object.freeze({
  unconfigured: Object.freeze({
    id: "unconfigured",
    label: "Unconfigured / unknown",
    commands: Object.freeze({}),
    feedModes: Object.freeze({perMinute: [94, 98], perRevolution: [95, 99]}),
    sources: Object.freeze([]),
  }),
  "haas-lathe-ngc": Object.freeze({
    id: "haas-lathe-ngc",
    label: "Haas lathe (NGC)",
    commands: Object.freeze({
      liveForward: 133,
      liveReverse: 134,
      liveStop: 135,
      cAxisEngage: 154,
      cAxisDisengage: 155,
      polarInterpolationOn: 112,
      polarInterpolationOff: 113,
      absolutePosition: 390,
      incrementalPosition: 391,
    }),
    // On a Haas lathe G94/G95 are canned cycles. G98/G99 select feed mode.
    feedModes: Object.freeze({perMinute: [98], perRevolution: [99]}),
    sources: Object.freeze([
      Object.freeze({
        title: "Haas M133 / M134 / M135 Live Tool Fwd/Rev/Stop",
        url: "https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dlathe.value%3DM134.html",
      }),
      Object.freeze({
        title: "Haas G112 XY to XC Interpolation",
        url: "https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG112.html",
      }),
      Object.freeze({
        title: "Haas Lathe Programming Workbook",
        url: "https://www.haascnc.com/content/dam/haascnc/en/service/reference/programming-workbooks/lathe---programming-workbook.pdf",
      }),
      Object.freeze({
        title: "Haas Lathe G-Code List",
        url: "https://www.haascnc.com/service/service-content/guide-procedures/lathe---g-codes.html",
      }),
      Object.freeze({
        title: "Haas Lathe C-Axis and G112 Programming",
        url: "https://www.haascnc.com/service/online-operator-s-manuals/lathe-operator-s-manual/lathe---options-programming.html",
      }),
      Object.freeze({
        title: "Haas Setting 162 - Default To Float",
        url: "https://www.haascnc.com/service/codes-settings.type%3Dsetting.machine%3Dlathe.value%3DS162.html",
      }),
      Object.freeze({
        title: "Haas Setting 77 - Scale Integer F",
        url: "https://www.haascnc.com/service/codes-settings.type%3Dsetting.machine%3Dlathe.value%3DS77.html",
      }),
    ]),
  }),
});

export function liveToolDialect(id = "unconfigured") {
  return LIVE_TOOL_DIALECTS[id] || LIVE_TOOL_DIALECTS.unconfigured;
}

export function liveToolCommand(dialect, command) {
  const value = liveToolDialect(dialect).commands[command];
  return Number.isFinite(value) ? value : null;
}

export function liveToolCapability(value) {
  return value === "equipped" || value === "not-equipped" ? value : "unknown";
}

export function axisCapability(value) {
  return value === "available" || value === "unavailable" ? value : "unknown";
}

export function cAxisEngagement(value) {
  return value === "required" || value === "automatic" ? value : "unknown";
}

const PROGRAM_START_MODES = new Set(["home", "tool-change", "safe-index", "custom"]);

export function plottedProgramStart(profile) {
  const mode = PROGRAM_START_MODES.has(profile?.startMode) ? profile.startMode : "unknown";
  if (mode === "unknown") return {mode, point: null, reason: "unknown"};
  const rawX = profile?.startX;
  const rawZ = profile?.startZ;
  const x = rawX === null || rawX === undefined || rawX === "" ? NaN : Number(rawX);
  const z = rawZ === null || rawZ === undefined || rawZ === "" ? NaN : Number(rawZ);
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return {mode, point: null, reason: "incomplete"};
  }
  return {mode, point: {x, z}, reason: null};
}
