/** Local Three.js ArcballControls adapter. Camera state is display-only, never a CAD placement. */
import {ArcballControls, OrthographicCamera, Vector3, Quaternion, Scene} from "./vendor/three/0.180.0/cad-controls.mjs";

const VIEWS = {iso: [-Math.PI / 4, Math.asin(1 / Math.sqrt(3))], xy: [0, Math.PI / 2], xz: [0, 0], yz: [Math.PI / 2, 0]};
export const SOLID_NAVIGATION_HELP = "Middle-drag rotate · Ctrl+middle pan · Shift+middle zoom · Wheel zoom · Double-click face to center";

export function createSolidNavigation(canvas, onChange = () => {}) {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.001, 100);
  const controlScene = new Scene();
  let controls, width = 1, height = 1, baseScale = 1, distance = 10, bounds = null;
  let center = new Vector3(), destroyed = false, fittedViewport = false;
  camera.position.set(0, -10, 0); camera.up.set(0, 0, 1); camera.lookAt(center);
  const pivot = () => camera.getWorldDirection(new Vector3()).multiplyScalar(distance).add(camera.position);
  function connect(target = pivot()) {
    controls?.dispose();
    controls = new ArcballControls(camera, canvas, controlScene);
    controls.target.copy(target); controls.update(); controls.setCamera(camera);
    controlScene.updateMatrixWorld(true);
    controls.enableAnimations = false; controls.enableFocus = false;
    controls.enableGizmos = false; controls.cursorZoom = true;
    controls.minZoom = 0.1; controls.maxZoom = 30; controls.scaleFactor = 1.2;
    // Explicit SOLIDWORKS-style preset. No inherited FOV or right-button actions.
    for (const action of [...controls.mouseActions]) controls.unsetMouseAction(action.mouse, action.key);
    controls.setMouseAction("ROTATE", 1);
    controls.setMouseAction("PAN", 1, "CTRL");
    controls.setMouseAction("ZOOM", 1, "SHIFT");
    controls.setMouseAction("ZOOM", "WHEEL");
    // Mouse-less accessibility alternatives; unmodified left mouse remains selection-only.
    controls.setMouseAction("ROTATE", 0, "CTRL");
    controls.setMouseAction("PAN", 0, "SHIFT");
    controls.addEventListener("change", () => { controlScene.updateMatrixWorld(true); onChange(); });
  }
  function frustum() {
    camera.left = -width / (2 * baseScale); camera.right = -camera.left;
    camera.top = height / (2 * baseScale); camera.bottom = -camera.top;
    camera.near = Math.max(1e-9, distance / 1000); camera.far = distance * 100;
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  }
  function setView(name) {
    if (!VIEWS[name]) return;
    const target = pivot(), [yaw, pitch] = VIEWS[name];
    const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
    // Same named source planes as the exact section UI. Roll is otherwise unrestricted.
    camera.position.copy(target).addScaledVector(new Vector3(sy * cp, -cy * cp, sp), distance);
    camera.up.set(-sy * sp, cy * sp, cp); camera.lookAt(target);
    connect(target); onChange();
  }
  function fit() {
    if (!bounds) return;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    fittedViewport = width > 1 && height > 1;
    const forward = camera.getWorldDirection(new Vector3());
    camera.position.copy(center).addScaledVector(forward, -distance);
    camera.zoom = 1; camera.updateMatrixWorld(true);
    const inverse = camera.quaternion.clone().invert();
    const corners = Array.from({length: 8}, (_, i) => new Vector3(
      bounds[i & 1 ? "max" : "min"].x, bounds[i & 2 ? "max" : "min"].y, bounds[i & 4 ? "max" : "min"].z,
    ).sub(center).applyQuaternion(inverse));
    const spanX = Math.max(...corners.map(p => p.x)) - Math.min(...corners.map(p => p.x));
    const spanY = Math.max(...corners.map(p => p.y)) - Math.min(...corners.map(p => p.y));
    baseScale = Math.min(Math.max(1, width - 90) / Math.max(distance * 1e-9, spanX), Math.max(1, height - 150) / Math.max(distance * 1e-9, spanY));
    frustum(); connect(center); onChange();
  }
  function resize(nextWidth, nextHeight) {
    if (width === nextWidth && height === nextHeight) return;
    width = Math.max(1, nextWidth); height = Math.max(1, nextHeight);
    if (!fittedViewport && bounds && width > 1 && height > 1) { fit(); return; }
    const target = pivot(); frustum(); connect(target); onChange();
  }
  function projector({directionOnly = false, scale = 31} = {}) {
    camera.updateMatrixWorld(true);
    const m = camera.matrixWorldInverse.elements, s = directionOnly ? scale : baseScale * camera.zoom;
    const ox = directionOnly ? 0 : width / 2, oy = directionOnly ? 0 : height / 2;
    const tx = directionOnly ? 0 : m[12], ty = directionOnly ? 0 : m[13], tz = directionOnly ? 0 : m[14];
    return p => ({x: ox + (m[0]*p.x + m[4]*p.y + m[8]*p.z + tx)*s,
      y: oy - (m[1]*p.x + m[5]*p.y + m[9]*p.z + ty)*s,
      depth: m[2]*p.x + m[6]*p.y + m[10]*p.z + tz});
  }
  function focus(point) {
    if (!point || ![point.x, point.y, point.z].every(Number.isFinite)) return;
    const target = new Vector3(point.x, point.y, point.z);
    camera.position.add(target.clone().sub(pivot())); connect(target); onChange();
  }
  function key(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    const value = event.key.toLowerCase();
    if (value === "f") fit();
    else if (["1", "2", "3", "4"].includes(value)) setView(["iso", "xy", "xz", "yz"][Number(value)-1]);
    else if (["+", "=", "-"].includes(value)) {
      const target = pivot(); camera.zoom = Math.max(0.1, Math.min(30, camera.zoom * (value === "-" ? 1/1.2 : 1.2)));
      frustum(); connect(target); onChange();
    } else if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(value)) {
      const target = pivot(), horizontal = value === "arrowleft" || value === "arrowright";
      const axis = new Vector3(horizontal ? 0 : 1, horizontal ? 1 : 0, 0).applyQuaternion(camera.quaternion);
      const q = new Quaternion().setFromAxisAngle(axis, (value === "arrowleft" || value === "arrowup" ? -1 : 1) * Math.PI/12);
      camera.position.sub(target).applyQuaternion(q).add(target); camera.up.applyQuaternion(q);
      camera.lookAt(target); connect(target); onChange();
    } else return false;
    event.preventDefault(); event.stopPropagation(); return true;
  }
  // Native Arcball pointer events own rotation/pan/pinch. Normalize wheel modes before they see it.
  function normalizeWheel(event) {
    if (!event.deltaMode) return;
    event.stopImmediatePropagation(); event.preventDefault();
    canvas.dispatchEvent(new WheelEvent("wheel", {clientX: event.clientX, clientY: event.clientY,
      ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, metaKey: event.metaKey, altKey: event.altKey,
      deltaY: event.deltaY * (event.deltaMode === 1 ? 16 : height), bubbles: true, cancelable: true}));
  }
  const cancel = () => { if (!destroyed) connect(); };
  canvas.addEventListener("wheel", normalizeWheel, {capture: true, passive: false});
  canvas.addEventListener("pointercancel", cancel);
  globalThis.window.addEventListener("blur", cancel);
  connect(); setView("iso");
  return {camera, fit, setView, resize, projector, focus, key, cancel,
    setBounds(value) {
      bounds = value;
      if (!value) return;
      center = new Vector3((value.min.x+value.max.x)/2, (value.min.y+value.max.y)/2, (value.min.z+value.max.z)/2);
      distance = Math.max(1e-6, value.max.x-value.min.x, value.max.y-value.min.y, value.max.z-value.min.z) * 4;
      fit();
    },
    snapshot: () => ({position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), zoom: camera.zoom, pivot: pivot().toArray(), scale: baseScale*camera.zoom}),
    destroy() { destroyed = true; controls.dispose(); canvas.removeEventListener("wheel", normalizeWheel, true); canvas.removeEventListener("pointercancel", cancel); globalThis.window.removeEventListener("blur", cancel); },
  };
}
