import {createSolidPreview, solidPreviewMappedProfileStrokes, solidPreviewSectionStrokes, validateSolidPreviewModel} from "./solid-preview.mjs";
import {principalAxis, setupFromCylinder, setupFromFrontFace, manualPrincipalSetup, changeLongitudinalPlane} from "./solid-setup.mjs";
import {mapStepSectionToLatheGeometry} from "./step-import.mjs";
import {convertUnitValue, fromMillimeters, scaleForUnits} from "./units.mjs";

const AXES = ["x", "y", "z"];
const PLANE_NAMES = {x: "YZ", y: "XZ", z: "XY"};

// The draft is intentionally separate from the applied reference. Camera and
// plane changes never change the nominal or authorize an existing comparison.
export function createSolidSetupDialog({onApply, getMachineContext, onActiveChange = () => {}, onRecoverWorker = async () => false}) {
  const $ = (id) => document.getElementById(id);
  const workspace = $("solidSetupWorkspace");
  const controls = $("solidPlacementControls");
  const ui = Object.fromEntries([
    "solidSetupFile", "solidPreviewMessage", "solidModelSize", "solidMachineContext",
    "solidCylinder", "solidConfirmCylinder", "solidManualAxis", "solidCenterX", "solidCenterY", "solidCenterZ",
    "solidFrontFace", "solidSetupSummary", "solidBuildPreview", "solidSectionContour",
    "solidSetupStatus", "solidApplySection", "solidRadialSide",
  ].map((id) => [id, $(id)]));
  let reference = null;
  let model = null;
  let setup = null;
  let section = null;
  let selectedFaceId = null;
  let cylinderId = null;
  let proposedCylinderId = null;
  let previewLoading = false;
  let sectionLoading = false;
  let revision = 0;
  let previewAttempted = false;
  let opener = null;
  let active = false;
  const planeButtons = [...controls.querySelectorAll("[data-solid-plane]")];
  const viewer = createSolidPreview($("solidPreviewCanvas"), {
    onFacePick: pickFace,
    onPlanePick: choosePlane,
  });

  function status(message, error = false) {
    ui.solidSetupStatus.textContent = message;
    ui.solidSetupStatus.classList.toggle("is-error", error);
  }
  function option(value, label) {
    const item = document.createElement("option");
    item.value = value;
    item.textContent = label;
    return item;
  }
  function displayUnits() { return getMachineContext().units === "mm" ? "mm" : "inch"; }
  function unitLabel() { return displayUnits() === "inch" ? "in" : "mm"; }
  function formatCoordinate(mm) {
    return `${fromMillimeters(mm, displayUnits()).toFixed(displayUnits() === "inch" ? 5 : 4)} ${unitLabel()}`;
  }
  function eligibleCylinders() {
    return (model?.faces ?? []).filter((face) => face.kind === "cylinder" && principalAxis(face.axis));
  }
  function populateCylinders() {
    ui.solidCylinder.replaceChildren(option("", "Select a cylindrical surface"));
    for (const face of eligibleCylinders()) {
      ui.solidCylinder.append(option(face.id, `${face.id} · Ø${formatCoordinate(face.radiusMm * 2)} · model ${principalAxis(face.axis).toUpperCase()}`));
    }
    if (cylinderId && ui.solidCylinder.options.some((item) => item.value === cylinderId)) ui.solidCylinder.value = cylinderId;
  }
  function renderModelSize() {
    if (!model) return;
    const size = AXES.map((axis) => model.bounds.max[axis] - model.bounds.min[axis]);
    const values = size.map((value) => fromMillimeters(value, displayUnits()).toFixed(displayUnits() === "inch" ? 5 : 4));
    ui.solidModelSize.textContent = `Model extents X × Y × Z: ${values.join(" × ")} ${unitLabel()}. Source units: ${reference.model.sourceUnits.name}.`;
  }
  function contours() { return section?.section?.contours ?? []; }
  function selectedContour() { return contours().find((item) => item.id === ui.solidSectionContour.value); }
  function mapping() {
    return {...setup, radialDirection: Number(ui.solidRadialSide.value), selectedContourId: selectedContour()?.id ?? "", profileSide: "positive"};
  }
  function invalidateSection() {
    revision += 1;
    section = null;
    sectionLoading = false;
    viewer.setSection(null);
    ui.solidSectionContour.replaceChildren(option("", "Preview section first"));
    ui.solidSectionContour.disabled = true;
    ui.solidApplySection.disabled = true;
  }
  function invalidateDraft() {
    if (!reference) return;
    invalidateSection();
    status("Advanced model coordinates changed. Rebuild this visual placement before using it again.");
    renderSetup();
  }
  function readyToSection() {
    return model && setup && selectedFaceId && AXES.includes(setup.normalAxis)
      && Number.isFinite(setup.axialOriginMm) && Number.isFinite(setup.radialOriginMm);
  }
  function renderSetup() {
    const machine = getMachineContext();
    viewer.setDisplayUnits(machine.units);
    ui.solidMachineContext.textContent = `${machine.orientation === "right" ? "Chuck right" : "Chuck left"} · X ${machine.xMode} · ${machine.units === "inch" ? "inches" : "millimeters"}. Using your existing machine settings.`;
    for (const button of planeButtons) {
      button.disabled = !setup || button.dataset.solidPlane === setup.axialAxis || sectionLoading;
      button.setAttribute("aria-pressed", String(button.dataset.solidPlane === setup?.normalAxis));
    }
    ui.solidBuildPreview.disabled = !readyToSection() || sectionLoading;
    ui.solidBuildPreview.textContent = sectionLoading ? "Building exact profile…" : "Rebuild exact profile";
    ui.solidCylinder.disabled = !model || sectionLoading;
    ui.solidConfirmCylinder.hidden = !proposedCylinderId || Boolean(setup);
    ui.solidConfirmCylinder.disabled = !model || sectionLoading || !proposedCylinderId || Boolean(setup);
    ui.solidFrontFace.disabled = !setup || sectionLoading;
    ui.solidRadialSide.disabled = !setup || sectionLoading;
    $("solidUseManualAxis").disabled = !model || sectionLoading;
    if (!setup) {
      ui.solidSetupSummary.textContent = "Select a spindle axis to begin.";
      viewer.setPlane(null);
      const proposed = model?.faces.find((face) => face.id === proposedCylinderId);
      viewer.setSelection(proposed ? {faceId: proposed.id, axis: principalAxis(proposed.axis), origin: {...proposed.origin}} : {});
      return;
    }
    const axial = setup.axialAxis.toUpperCase();
    const datum = selectedFaceId ? `Z0 datum: model ${axial}=${formatCoordinate(setup.axialOriginMm)}. Model +${axial} → program ${setup.axialDirection === 1 ? "+Z" : "−Z"}.` : "Choose the face or shoulder your program uses as Z0.";
    const plane = setup.normalAxis ? `${PLANE_NAMES[setup.normalAxis]} through centerline (${setup.normalAxis.toUpperCase()}=${formatCoordinate(setup.planeOffsetMm)}).` : "Choose a longitudinal plane.";
    const radial = `Model ${Number(ui.solidRadialSide.value) === 1 ? "+" : "−"}${setup.radialAxis.toUpperCase()} → physical +X radius.`;
    ui.solidSetupSummary.textContent = `Spindle: model ${axial}. ${datum} ${plane} ${radial}`;
    viewer.setPlane(setup.normalAxis ? {normalAxis: setup.normalAxis, offsetMm: setup.planeOffsetMm} : null);
    const origin = Object.fromEntries(AXES.map((axis) => [axis, 0]));
    if (setup.normalAxis) origin[setup.normalAxis] = setup.planeOffsetMm;
    if (setup.radialAxis) origin[setup.radialAxis] = setup.radialOriginMm;
    origin[setup.axialAxis] = Number.isFinite(setup.axialOriginMm) ? setup.axialOriginMm : 0;
    viewer.setSelection({faceId: selectedFaceId ?? cylinderId, axis: setup.axialAxis, origin});
  }
  function populateFrontFaces() {
    ui.solidFrontFace.replaceChildren(option("", "Select the face or shoulder at program Z0"));
    for (const face of model?.faces ?? []) {
      if (face.kind !== "plane" || principalAxis(face.normal) !== setup?.axialAxis) continue;
      ui.solidFrontFace.append(option(face.id, `${face.id} · ${setup.axialAxis.toUpperCase()}=${formatCoordinate(face.origin[setup.axialAxis])}`));
    }
    if (selectedFaceId && ui.solidFrontFace.options.some((item) => item.value === selectedFaceId)) ui.solidFrontFace.value = selectedFaceId;
    if (ui.solidFrontFace.options.length === 1) {
      status("No principal planar face or shoulder is available for this axis. Use Advanced model coordinates in the reference panel for an explicit datum.", true);
    }
  }
  function chooseCylinder(id) {
    const face = model?.faces.find((item) => item.id === id);
    if (!face) return;
    try {
      const axis = principalAxis(face.axis);
      // A visible, proposed plane does not apply a mapping. Preview and Use
      // remain explicit user actions; either longitudinal plane can be chosen.
      const normalAxis = axis === "z" ? "y" : axis === "x" ? "z" : "x";
      setup = setupFromCylinder(face, {normalAxis});
      cylinderId = id;
      proposedCylinderId = null;
      selectedFaceId = null;
      ui.solidCylinder.value = id;
      ui.solidManualAxis.value = "";
      invalidateSection();
      populateFrontFaces();
      status("Cylinder selected. Now select your Z0 face or shoulder.");
      renderSetup();
    } catch (error) { status(error.message, true); }
  }
  async function chooseFace(id) {
    const face = model?.faces.find((item) => item.id === id);
    if (!face || !setup) return;
    try {
      const datum = setupFromFrontFace(face, setup.axialAxis);
      setup = {...setup, ...datum};
      selectedFaceId = id;
      ui.solidFrontFace.value = id;
      invalidateSection();
      status("Z0 datum selected. Building the exact machining-side profile…");
      renderSetup();
      await buildSection();
    } catch (error) { status(error.message, true); }
  }
  function pickFace(id) {
    const face = model?.faces.find((item) => item.id === id);
    if (sectionLoading || !face) return;
    if (face.kind === "cylinder") chooseCylinder(id);
    else if (face.kind === "plane" && setup) void chooseFace(id);
    else status(setup ? "Choose a planar face or shoulder perpendicular to the spindle axis." : "Choose a cylindrical surface first, or enter a centerline manually.", true);
  }
  async function choosePlane(normalAxis) {
    if (!setup || sectionLoading) return;
    try {
      setup = changeLongitudinalPlane(setup, normalAxis);
      invalidateSection();
      status(`${PLANE_NAMES[normalAxis]} plane selected through the spindle centerline. Rebuilding the exact profile…`);
      renderSetup();
      if (readyToSection()) await buildSection();
    } catch (error) { status(error.message, true); }
  }
  function updateSelectedContour() {
    const contour = selectedContour();
    ui.solidApplySection.disabled = true;
    if (!contour) { viewer.setSection(null); return; }
    const selectedSection = {...section, section: {...section.section, contours: [contour]}};
    if (solidPreviewSectionStrokes(selectedSection).length !== contour.edges.length) {
      viewer.setSection(null);
      status("This contour exceeds the solid preview's display limit or cannot be displayed. Guided Apply is blocked; use a simpler profile or inspect the advanced section workflow.", true);
      return;
    }
    const currentMapping = mapping();
    const mapped = mapStepSectionToLatheGeometry(section, currentMapping);
    if (!mapped.authorized) {
      viewer.setSection(null);
      status(mapped.diagnostics.map((item) => item.message).join(" "), true);
      return;
    }
    const mappedStrokes = solidPreviewMappedProfileStrokes(mapped, currentMapping);
    if (mappedStrokes.length !== mapped.primitives.length) {
      viewer.setSection(null);
      status("The exact machining-side profile cannot be displayed within the solid preview limits, so Apply is blocked.", true);
      return;
    }
    viewer.setMappedProfile(mapped, currentMapping);
    ui.solidApplySection.disabled = false;
    status(`${mapped.primitives.length} exact machining-side profile segment${mapped.primitives.length === 1 ? "" : "s"} ready. Confirm this placement to compare it with the G-code.`);
  }
  async function buildSection() {
    if (!readyToSection() || sectionLoading) return;
    invalidateSection();
    const requestedRevision = revision;
    const requestedReference = reference;
    sectionLoading = true;
    status("Computing the section from the original solid on this device…");
    renderSetup();
    try {
      const result = await reference.worker.section({normalAxis: setup.normalAxis, planeOffsetMm: setup.planeOffsetMm});
      if (revision !== requestedRevision || reference !== requestedReference) return;
      if (result?.authorized !== true || result?.format !== "step-section" || result.source?.sha256 !== reference.source.sha256
        || result.source?.byteLength !== reference.source.byteLength || result.source?.name !== reference.source.name) {
        throw new Error("The section did not pass its source and geometry checks.");
      }
      section = result;
      ui.solidSectionContour.replaceChildren(option("", "Select a section contour"));
      for (const [index, contour] of contours().entries()) {
        ui.solidSectionContour.append(option(contour.id, `Contour ${index + 1} · ${contour.edges.length} exact edges`));
      }
      ui.solidSectionContour.disabled = false;
      if (contours().length === 1) ui.solidSectionContour.value = contours()[0].id;
      if (!contours().length) throw new Error("This plane does not intersect a supported closed contour. Choose the other longitudinal plane.");
      status("Select the intended contour and inspect the highlighted section before using it.");
      updateSelectedContour();
    } catch (error) {
      if (revision !== requestedRevision || reference !== requestedReference) return;
      section = null;
      ui.solidSectionContour.disabled = true;
      ui.solidApplySection.disabled = true;
      status(error.message, true);
    } finally {
      if (revision === requestedRevision && reference === requestedReference) {
        sectionLoading = false;
        renderSetup();
      }
    }
  }
  async function ensurePreview() {
    if (!active || !reference || reference.model?.authorized !== true || previewLoading || previewAttempted) return;
    previewLoading = true;
    previewAttempted = true;
    const requestedReference = reference;
    ui.solidPreviewMessage.hidden = false;
    ui.solidPreviewMessage.textContent = "Preparing solid preview…";
    try {
      const result = reference.preview ?? await reference.worker.preview();
      if (reference !== requestedReference) return;
      if (result?.schemaVersion !== 1 || result?.format !== "step-solid-preview" || result.displayOnly !== true
        || result.source?.sha256 !== reference.source.sha256 || result.source?.byteLength !== reference.source.byteLength
        || result.source?.name !== reference.source.name) throw new Error("The solid preview did not match the imported file.");
      const validation = validateSolidPreviewModel(result);
      if (!validation.ok) throw new Error(validation.reason);
      model = result;
      reference.preview = result;
      viewer.setModel(result);
      viewer.setView("iso");
      viewer.fit();
      ui.solidPreviewMessage.hidden = true;
      populateCylinders();
      renderModelSize();
      const cylinders = eligibleCylinders();
      const first = cylinders[0];
      const sameCenterline = first && cylinders.every((face) => {
        const axis = principalAxis(face.axis);
        if (axis !== principalAxis(first.axis)) return false;
        return AXES.filter((candidate) => candidate !== axis).every((candidate) => face.origin[candidate] === first.origin[candidate]);
      });
      if (sameCenterline) {
        proposedCylinderId = first.id;
        ui.solidCylinder.value = "";
        ui.solidConfirmCylinder.textContent = `Use proposed ${principalAxis(first.axis).toUpperCase()} spindle axis`;
        status(`Spindle axis proposed from ${cylinders.length} coaxial cylindrical surface${cylinders.length === 1 ? "" : "s"}. Confirm it before choosing the planar face or shoulder used as program Z0.`);
        renderSetup();
      } else {
        proposedCylinderId = null;
        status(cylinders.length ? "Solid loaded. Click a cylindrical surface to locate the spindle axis." : "Solid loaded. This part has no supported principal cylinder; enter its spindle axis and centerline manually.");
        renderSetup();
      }
    } catch (error) {
      if (reference !== requestedReference) return;
      let analyticAvailable = Boolean(reference.worker && !reference.worker.closed);
      if (!analyticAvailable) {
        try { analyticAvailable = await onRecoverWorker(requestedReference) === true; }
        catch { analyticAvailable = false; }
      }
      if (reference !== requestedReference) return;
      ui.solidPreviewMessage.textContent = "Solid preview unavailable";
      const reason = error instanceof Error ? error.message : String(error);
      status(analyticAvailable
        ? `${reason} The exact analytic solid was restored. Return to the toolpath and use Advanced model coordinates.`
        : `${reason} The analytic geometry worker could not be restored; reimport the STEP solid before comparison.`, true);
    } finally { if (reference === requestedReference) previewLoading = false; }
  }
  function clear() {
    revision += 1;
    reference = null;
    model = null;
    setup = null;
    section = null;
    selectedFaceId = null;
    cylinderId = null;
    proposedCylinderId = null;
    previewLoading = false;
    sectionLoading = false;
    previewAttempted = false;
    ui.solidRadialSide.value = "1";
    viewer.setModel(null);
    viewer.setSection(null);
    viewer.setPlane(null);
    viewer.setSelection({});
    for (const field of [ui.solidSetupFile, ui.solidModelSize, ui.solidMachineContext, ui.solidSetupSummary, ui.solidSetupStatus]) field.textContent = "";
    for (const field of [ui.solidCenterX, ui.solidCenterY, ui.solidCenterZ, ui.solidManualAxis]) field.value = "";
    for (const field of [ui.solidCylinder, ui.solidFrontFace, ui.solidSectionContour]) {
      field.replaceChildren(option("", "Select"));
      field.disabled = true;
    }
    ui.solidApplySection.disabled = true;
    ui.solidBuildPreview.disabled = true;
    ui.solidPreviewMessage.textContent = "Loading solid…";
    close({restoreFocus: false});
  }
  function update(nextReference) {
    if (nextReference !== reference || !active) return;
    ui.solidSetupFile.textContent = reference.source.name;
    if (reference.model?.authorized === false) {
      ui.solidPreviewMessage.hidden = false;
      ui.solidPreviewMessage.textContent = "STEP import blocked";
      status(reference.model.diagnostics.map((item) => item.message).join(" "), true);
    } else if (reference.pending && !model) {
      ui.solidPreviewMessage.hidden = false;
      ui.solidPreviewMessage.textContent = "Loading the local geometry engine and solid…";
    }
    renderSetup();
    void ensurePreview();
  }
  function displayUnitsChanged(previousUnits, nextUnits) {
    const from = previousUnits === "mm" ? "mm" : "inch";
    const to = nextUnits === "mm" ? "mm" : "inch";
    if (from !== to) {
      for (const input of [ui.solidCenterX, ui.solidCenterY, ui.solidCenterZ]) {
        const text = input.value.trim();
        if (!text) continue;
        const converted = convertUnitValue(Number(text), from, to);
        if (Number.isFinite(converted)) input.value = String(Number(converted.toPrecision(17)));
      }
    }
    populateCylinders();
    if (setup) populateFrontFaces();
    renderModelSize();
    renderSetup();
  }
  function open(nextReference) {
    if (!nextReference || nextReference.kind !== "step") return;
    const capturedFocus = document.activeElement;
    if (reference !== nextReference) { clear(); reference = nextReference; }
    opener = capturedFocus;
    if (!workspace.hidden) return update(reference);
    workspace.hidden = false;
    controls.hidden = false;
    $("stepAdvancedControls").hidden = true;
    setActive(true);
    onActiveChange(true);
    // Keep the reference controls visible next to the solid being placed.
    $("referenceGeometrySetup").open = true;
    $("openSolidSetupButton").textContent = "Placement open in main view";
    if (!model && !previewLoading) previewAttempted = false;
    update(reference);
    viewer.fit();
    $("solidPreviewCanvas").focus({preventScroll: true});
  }
  function setActive(value) { active = value; }
  function close({restoreFocus = true} = {}) {
    if (!active && workspace.hidden) return;
    setActive(false);
    workspace.hidden = true;
    controls.hidden = true;
    $("stepAdvancedControls").hidden = false;
    $("openSolidSetupButton").textContent = "Place solid in 3D";
    onActiveChange(false);
    if (restoreFocus) opener?.focus?.();
  }

  $("solidSetupClose").addEventListener("click", () => close());
  // Keep canvas/setup keystrokes from changing the program behind the workspace.
  workspace.addEventListener("keydown", (event) => event.stopPropagation());
  controls.addEventListener("keydown", (event) => event.stopPropagation());
  $("solidFit").addEventListener("click", () => viewer.fit());
  for (const button of workspace.querySelectorAll("[data-solid-view]")) button.addEventListener("click", () => viewer.setView(button.dataset.solidView));
  for (const button of planeButtons) button.addEventListener("click", () => choosePlane(button.dataset.solidPlane));
  ui.solidCylinder.addEventListener("change", () => {
    if (ui.solidCylinder.value) chooseCylinder(ui.solidCylinder.value);
    else { setup = null; cylinderId = null; selectedFaceId = null; invalidateSection(); populateFrontFaces(); renderSetup(); }
  });
  ui.solidConfirmCylinder.addEventListener("click", () => {
    if (proposedCylinderId) chooseCylinder(proposedCylinderId);
  });
  ui.solidFrontFace.addEventListener("change", () => {
    if (ui.solidFrontFace.value) return chooseFace(ui.solidFrontFace.value);
    else { selectedFaceId = null; invalidateSection(); renderSetup(); }
  });
  $("solidUseManualAxis").addEventListener("click", () => {
    try {
      const axialAxis = ui.solidManualAxis.value;
      const normalAxis = axialAxis === "z" ? "y" : axialAxis === "x" ? "z" : "x";
      const scale = scaleForUnits(displayUnits());
      const values = [ui.solidCenterX, ui.solidCenterY, ui.solidCenterZ].map((input) => input.value.trim() === "" ? NaN : Number(input.value) * scale);
      setup = manualPrincipalSetup({axialAxis, normalAxis, spindleCenterMm: Object.fromEntries(AXES.map((axis, index) => [axis, values[index]]))});
      selectedFaceId = null;
      cylinderId = null;
      proposedCylinderId = null;
      ui.solidCylinder.value = "";
      invalidateSection();
      populateFrontFaces();
      status("Explicit centerline selected. Choose the planar face or shoulder at program Z0.");
      renderSetup();
    } catch (error) { status(error.message, true); }
  });
  ui.solidBuildPreview.addEventListener("click", buildSection);
  ui.solidSectionContour.addEventListener("change", updateSelectedContour);
  ui.solidRadialSide.addEventListener("change", async () => {
    invalidateSection(); renderSetup(); status("Machining side changed. Rebuilding the exact profile…");
    if (readyToSection()) await buildSection();
  });
  ui.solidApplySection.addEventListener("click", () => {
    if (!selectedContour() || !section || !readyToSection()) return;
    const mapped = mapStepSectionToLatheGeometry(section, mapping());
    if (!mapped.authorized) { status("The section mapping is blocked. Review your setup before applying it.", true); return; }
    try {
      onApply({reference, sectionDto: section, mapping: mapping(), provenance: {
        sourceHash: reference.source.sha256,
        spindleSource: cylinderId ? "selected-analytic-cylinder" : "explicit-manual-centerline",
        spindleFaceId: cylinderId,
        frontFaceId: selectedFaceId,
        planeNormalAxis: setup.normalAxis,
      }});
      close();
    } catch (error) { status(error.message, true); }
  });
  return {open, close, update, clear, invalidateDraft, displayUnitsChanged, isActive: () => active};
}
