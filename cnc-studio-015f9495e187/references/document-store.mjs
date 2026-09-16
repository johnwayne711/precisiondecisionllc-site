export const REFERENCE_PDF_LIMIT = 20 * 1024 * 1024;
export const REFERENCE_DOCUMENT_IDS = Object.freeze(["manual", "brochure"]);
const DATABASE = "verify.references.sl75.v1";

function checkedId(id) {
  if (!REFERENCE_DOCUMENT_IDS.includes(id)) throw new Error("Unknown reference document.");
  return id;
}

export async function prepareReferencePdf(id, file) {
  checkedId(id);
  if (!(file instanceof Blob) || !file.size || file.size > REFERENCE_PDF_LIMIT) {
    throw new Error("Choose a PDF up to 20 MB.");
  }
  if (await file.slice(0, 5).text() !== "%PDF-") throw new Error("This file does not have a PDF header. Choose the original PDF.");
  const name = String(file.name || `${id}.pdf`).split(/[\\/]/).at(-1).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || `${id}.pdf`;
  return {id, name, savedAt: new Date().toISOString(), blob: file.slice(0, file.size, "application/pdf")};
}

async function accessStore(mode, operation) {
  if (!globalThis.indexedDB) throw new Error("PDF storage is unavailable in this browser. Keep a downloaded copy instead.");
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore("documents", {keyPath: "id"});
    request.onerror = () => reject(new Error("PDF storage could not be opened. Keep a downloaded backup."));
    request.onblocked = () => { blocked = true; reject(new Error("Close other reference tabs and try again.")); };
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
  });
  return new Promise((resolve, reject) => {
    let result;
    let transaction;
    try { transaction = database.transaction("documents", mode); }
    catch (error) { database.close(); reject(error); return; }
    transaction.oncomplete = () => { database.close(); resolve(result); };
    transaction.onabort = transaction.onerror = () => {
      database.close();
      reject(new Error("The PDF could not be saved or read. Browser storage may be full or disabled; keep a downloaded backup."));
    };
    try {
      const request = operation(transaction.objectStore("documents"));
      request.onsuccess = () => { result = request.result; };
    } catch (error) {
      transaction.abort();
      database.close();
      reject(error);
    }
  });
}

export async function saveReferencePdf(id, file) {
  const record = await prepareReferencePdf(id, file);
  await accessStore("readwrite", store => store.put(record));
  return record;
}

export function readReferencePdf(id) {
  checkedId(id);
  return accessStore("readonly", store => store.get(id));
}

export function removeReferencePdf(id) {
  checkedId(id);
  return accessStore("readwrite", store => store.delete(id));
}
