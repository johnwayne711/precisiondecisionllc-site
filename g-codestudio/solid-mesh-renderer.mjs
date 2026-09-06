/** GPU display of the bounded preview DTO. No GPU or Float32 value is dimensional authority. */
import {WebGLRenderer, Scene, Mesh, BufferGeometry, BufferAttribute, MeshLambertMaterial,
  AmbientLight, DirectionalLight, LineSegments, LineBasicMaterial, Raycaster, Vector2, Vector3} from "./vendor/three/0.180.0/cad-controls.mjs";

export function createSolidMeshRenderer(overlay, onChange) {
  if (!overlay.ownerDocument || !overlay.parentElement) return null;
  const canvas = overlay.ownerDocument.createElement("canvas");
  canvas.className = "solid-mesh-canvas"; canvas.setAttribute("aria-hidden", "true");
  let renderer;
  try { renderer = new WebGLRenderer({canvas, antialias: true, alpha: true}); }
  catch { return null; }
  overlay.parentElement.insertBefore(canvas, overlay);
  const scene = new Scene(), origin = new Vector3(), raycaster = new Raycaster();
  const light = new DirectionalLight(0xffffff, 2.1); scene.add(new AmbientLight(0xffffff, 1.7), light);
  let mesh = null, outline = null, ids = [], sourceTriangles = [], colors = null, lastSelection = "", lost = false;
  let viewCamera = null;
  function clear() {
    for (const object of [mesh, outline]) if (object) { scene.remove(object); object.geometry.dispose(); object.material.dispose(); }
    mesh = null; outline = null; ids = []; sourceTriangles = []; colors = null; lastSelection = "";
    renderer.clear();
  }
  function setModel(triangles, center) {
    clear(); origin.set(center.x, center.y, center.z); sourceTriangles = triangles;
    if (!triangles.length) return;
    const positions = new Float32Array(triangles.length*9), normals = new Float32Array(positions.length);
    colors = new Float32Array(positions.length); const lines = [];
    triangles.forEach((triangle, i) => {
      ids.push(triangle.faceId);
      triangle.points.forEach((point, j) => {
        const offset = i*9+j*3;
        positions.set([point.x-origin.x, point.y-origin.y, point.z-origin.z], offset);
        normals.set([triangle.normal.x, triangle.normal.y, triangle.normal.z], offset);
        if (triangle.boundary[j]) {
          const next = triangle.points[(j+1)%3];
          lines.push(point.x-origin.x, point.y-origin.y, point.z-origin.z, next.x-origin.x, next.y-origin.y, next.z-origin.z);
        }
      });
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(normals, 3));
    geometry.setAttribute("color", new BufferAttribute(colors, 3)); geometry.computeBoundingSphere();
    mesh = new Mesh(geometry, new MeshLambertMaterial({vertexColors: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1}));
    const edges = new BufferGeometry(); edges.setAttribute("position", new BufferAttribute(new Float32Array(lines), 3));
    outline = new LineSegments(edges, new LineBasicMaterial({color: 0x345362}));
    scene.add(mesh, outline); highlight(null, null);
  }
  function highlight(selected, hovered) {
    const key = JSON.stringify([selected, hovered]);
    if (!mesh || key === lastSelection) return;
    lastSelection = key;
    ids.forEach((id, i) => {
      const color = id === selected ? [0.10,0.63,0.40] : id === hovered ? [0.39,0.65,0.77] : [0.34,0.44,0.52];
      for (let j=0;j<3;j++) colors.set(color, i*9+j*3);
    });
    mesh.geometry.attributes.color.needsUpdate = true;
  }
  function render(camera, width, height, selected, hovered) {
    if (lost) return false;
    const pixelRatio = Math.min(2, globalThis.devicePixelRatio || 1);
    if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
    if (canvas.width !== Math.floor(width * pixelRatio) || canvas.height !== Math.floor(height * pixelRatio)) renderer.setSize(width, height, false);
    if (!viewCamera) viewCamera = camera.clone(); else viewCamera.copy(camera);
    viewCamera.position.sub(origin); viewCamera.updateMatrixWorld(true);
    light.position.copy(viewCamera.position).add(new Vector3(0, 1, 0).applyQuaternion(viewCamera.quaternion));
    highlight(selected, hovered); renderer.render(scene, viewCamera); return true;
  }
  function pick(point, width, height, camera) {
    if (!mesh || lost) return null;
    if (!viewCamera) viewCamera = camera.clone(); else viewCamera.copy(camera);
    viewCamera.position.sub(origin); viewCamera.updateMatrixWorld(true);
    raycaster.setFromCamera(new Vector2(point.x/width*2-1, 1-point.y/height*2), viewCamera);
    const hit = raycaster.intersectObject(mesh, false)[0];
    if (!hit) return null;
    return {faceId: ids[hit.faceIndex], point: hit.point.add(origin), triangle: sourceTriangles[hit.faceIndex]};
  }
  const contextLost = event => { event.preventDefault(); lost = true; canvas.hidden = true; onChange(); };
  const contextRestored = () => { lost = false; canvas.hidden = false; onChange(); };
  canvas.addEventListener("webglcontextlost", contextLost); canvas.addEventListener("webglcontextrestored", contextRestored);
  return {setModel, render, pick, available: () => !lost,
    statistics: () => ({renderer: lost ? "context-lost" : "webgl", triangles: renderer.info.render.triangles, drawCalls: renderer.info.render.calls}),
    destroy() { clear(); renderer.dispose(); canvas.removeEventListener("webglcontextlost", contextLost); canvas.removeEventListener("webglcontextrestored", contextRestored); canvas.remove(); },
  };
}
