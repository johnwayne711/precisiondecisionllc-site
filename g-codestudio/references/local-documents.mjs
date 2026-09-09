import {REFERENCE_DOCUMENT_IDS, readReferencePdf, saveReferencePdf, removeReferencePdf} from "./document-store.mjs";

const urls = new Map();
function release(id) {
  if (urls.has(id)) URL.revokeObjectURL(urls.get(id));
  urls.delete(id);
}
for (const id of REFERENCE_DOCUMENT_IDS) {
  const row = document.querySelector(`[data-document="${id}"]`);
  const picker = row.querySelector("input");
  const status = row.querySelector('[role="status"]');
  const open = row.querySelector("[data-open]");
  const download = row.querySelector("[data-download]");
  const remove = row.querySelector("button");
  const actions = row.querySelector("[data-actions]");
  function show(record) {
    release(id);
    open.removeAttribute("href");
    download.removeAttribute("href");
    download.removeAttribute("download");
    open.hidden = download.hidden = true;
    actions.hidden = !record;
    if (!record) { status.textContent = "No PDF saved on this browser."; return; }
    if (!(record.blob instanceof Blob) || record.blob.type !== "application/pdf") {
      status.textContent = "The saved document is unreadable. Choose a replacement PDF.";
      return;
    }
    const url = URL.createObjectURL(record.blob);
    urls.set(id, url);
    open.hidden = download.hidden = false;
    open.href = download.href = url;
    download.download = record.name;
    status.textContent = `${record.name} · ${(record.blob.size / 1048576).toFixed(2)} MB · Saved on this browser`;
  }
  async function act(operation, failure) {
    picker.disabled = remove.disabled = true;
    status.textContent = "Reading or updating saved PDF…";
    try { await operation(); }
    catch (error) { status.textContent = `${failure} ${error.message}`; }
    finally { picker.disabled = remove.disabled = false; }
  }
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    picker.value = "";
    if (!file) return;
    void act(async () => { show(await saveReferencePdf(id, file)); }, "Not saved.");
  });
  remove.addEventListener("click", () => {
    void act(async () => { await removeReferencePdf(id); show(null); }, "Not removed.");
  });
  void act(async () => { show(await readReferencePdf(id)); }, "Storage unavailable.");
}
window.addEventListener("pagehide", event => {
  // Back/Forward Cache retains this page and its links; retain their URLs too.
  if (!event.persisted) for (const id of urls.keys()) release(id);
});
