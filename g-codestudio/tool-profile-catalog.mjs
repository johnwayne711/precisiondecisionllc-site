import {nominalLatheCuttingClaim} from "./tool-lathe-cutting.mjs";

// Retained CAD display and separately accepted nominal cutting are independent
// claims. Neither supplies physical accuracy, seating or collision authority.
export function profileCatalogRecords(tools) {
  const sources = new Map(), holders = new Map(), inserts = new Map();
  const compatibilityEdges = [], assemblies = [];
  // A component may serve multiple assemblies, but its immutable geometry may
  // not depend on which assembly happened to be visited last.
  const component = (records, record, family) => {
    const previous = records.get(record.revisionRef);
    if (previous) {
      const {cuttingGeometry: oldGeometry, ...oldFacts} = previous;
      const {cuttingGeometry: newGeometry, ...newFacts} = record;
      const {applications: oldApplications, ...oldShape} = oldGeometry;
      const newShape = {...newGeometry};
      delete newShape.applications;
      if (JSON.stringify(oldFacts) !== JSON.stringify(newFacts)
        || JSON.stringify(oldShape) !== JSON.stringify(newShape)) {
        throw new Error(`Conflicting component identity or registered display frame: ${record.revisionRef}`);
      }
      previous.cuttingGeometry.applications = [...new Set([...oldApplications, family])].sort();
    } else records.set(record.revisionRef, record);
  };
  const source = (component, material, kind, url, sha256) => {
    const id = `source:kennametal:${component}:${material}:${kind}`;
    const record = {id, revision: 1, revisionRef: `${id}@1`, publisher: "Kennametal",
      authority: "manufacturer", kind: `manufacturer-${kind}`, url, retrievedOn: "2026-09-07"};
    if (sha256) record.sha256 = sha256;
    const previous = sources.get(id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(record)) throw new Error(`Conflicting exact source: ${id}`);
    sources.set(id, record);
    return id;
  };
  const unavailable = (blockedReason, sourceRefs) => ({state: "unavailable", available: false, assignable: false, blockedReason, sourceRefs});
  for (const tool of tools) {
    const {holder: h, insert: i, projection: p} = tool;
    const hp = source("holder", h.materialNumber, "product-page", h.productUrl);
    const ip = source("insert", i.materialNumber, "product-page", i.productUrl);
    const hs = source("holder", h.materialNumber, "cad-step", p.source.stepUrl, p.source.stepSha256);
    const hm = source("holder", h.materialNumber, "cad-manifest", p.source.manifestUrl, p.source.manifestSha256);
    const si = source("insert", i.materialNumber, "cad-step", p.source.insertStepUrl, p.source.insertStepSha256);
    const holderRoute = h.cadRouting || (p.source.holderCadRouteUrl
      ? {url: p.source.holderCadRouteUrl, sha256: p.source.holderCadRouteSha256} : null);
    const insertRoute = i.cadRouting || (p.source.insertCadRouteUrl
      ? {url: p.source.insertCadRouteUrl, sha256: p.source.insertCadRouteSha256} : null);
    const hr = holderRoute ? source("holder", h.materialNumber, "cad-routing", holderRoute.url, holderRoute.sha256) : null;
    const ir = insertRoute ? source("insert", i.materialNumber, "cad-routing", insertRoute.url, insertRoute.sha256) : null;
    const cp = tool.compatibilitySource ? source("insert", i.materialNumber, "compatible-parts",
      tool.compatibilitySource.url, tool.compatibilitySource.sha256) : null;
    const compatibilitySources = [hp, ip, cp].filter(Boolean);
    const sourceRefs = [hp, ip, hs, hm, si, hr, ir, cp].filter(Boolean);
    const holderRevision = h.revision || 1, insertRevision = i.revision || 1, revision = tool.revision || 1;
    const holderRef = `holder:kennametal:${h.materialNumber}@${holderRevision}`;
    const insertRef = `insert:kennametal:${i.materialNumber}@${insertRevision}`;
    component(holders, {
      id: holderRef.split("@")[0], revision: holderRevision, revisionRef: holderRef,
      manufacturer: "Kennametal", materialNumber: h.materialNumber,
      catalogId: {iso: h.name, ansi: h.name}, hand: h.hand, gageInsert: h.gageInsert,
      dimensions: {units: "mm", ...h.dimensions},
      cuttingGeometry: {applications: [tool.family], insertShape: tool.shape},
      officialCadAvailable: true, sourceRefs: [hp, hs, hm, hr].filter(Boolean),
      cadDisplayOutline: p.holderOutline,
    }, tool.family);
    component(inserts, {
      id: insertRef.split("@")[0], revision: insertRevision, revisionRef: insertRef,
      manufacturer: "Kennametal", materialNumber: i.materialNumber,
      catalogId: {iso: i.name, ansi: i.name}, hand: i.hand,
      dimensions: {units: "mm", ...i.dimensions},
      cuttingGeometry: {shape: tool.shape, applications: [tool.family], ...i.cuttingGeometry},
      officialCadAvailable: true, sourceRefs: [ip, si, ir].filter(Boolean),
      // This is the selected component in the source-registered assembly frame,
      // not a width/depth rectangle or a different generic gage insert.
      cadDisplayOutline: p.insertOutline,
    }, tool.family);
    const compatibilityRef = `compatibility:kennametal:${h.materialNumber}+${i.materialNumber}@${revision}`;
    compatibilityEdges.push({
      id: compatibilityRef.split("@")[0], revision, revisionRef: compatibilityRef,
      holderRevisionRef: holderRef, insertRevisionRef: insertRef,
      state: "manufacturer-listed-compatible", compatible: true, evidence: tool.compatibilityEvidence,
      sourceRefs: compatibilitySources,
    });
    const fact = {state: "manufacturer-published", available: true, sourceRefs: [hp, ip, hr, ir].filter(Boolean)};
    assemblies.push({
      id: tool.id, revision,
      revisionRef: `assembly:kennametal:${h.name.toLowerCase()}+${i.name.toLowerCase()}@${revision}`,
      name: tool.name, manufacturer: "Kennametal",
      holderRevisionRef: holderRef, insertRevisionRef: insertRef, compatibilityRevisionRef: compatibilityRef,
      facets: {shape: tool.shape, family: tool.family, hand: h.hand, insertIcInches: null, applications: tool.applications},
      catalogRecordOnly: false, displayOnly: false, nominalCutting: true,
      ...(tool.nominalSection ? {nominalSection: tool.nominalSection} : {}),
      assignment: {state: "nominal-cutting-conditional", assignable: true, scope: ["displayGeometry", "mountedReference", "cuttingModel"],
        blockedOutsideScope: "Nominal acceptance, programmed cutter datum and supported setup are required; CAD display does not establish physical cutting accuracy or collision clearance."},
      claims: {
        identity: fact, dimensions: fact, compatibility: {...fact, sourceRefs: compatibilitySources},
        displayGeometry: {
          state: "manufacturer-cad-projection", available: true, assignable: true,
          revisionRef: p.id, projection: tool.notice,
          sourceModelUncertaintyMm: p.sourceModelUncertaintyMm ?? null,
          insertRepresentation: "exact-selected-insert-source-registered-display",
          sourceRefs,
        },
        mountedReference: {
          state: "manufacturer-cad-reference", available: true, assignable: true,
          revisionRef: `${p.id}-reference`,
          reference: {type: "manufacturer-holder-reference-display-only", coordinateSystem: `${h.name} source XYZ`,
            coordinateOrder: ["x", "y", "z"], units: "mm", point: [...p.modelCrp], displayTransformRef: p.id},
          sourceRefs: [hs, si],
        },
        cuttingModel: nominalLatheCuttingClaim(tool.id, [ip, hp]),
        collisionModel: unavailable("No qualified cutter/holder collision envelope or clearance model.", sourceRefs),
      },
    });
  }
  return {sources: [...sources.values()], holders: [...holders.values()], inserts: [...inserts.values()], compatibilityEdges, assemblies};
}
