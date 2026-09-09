const input = document.querySelector("#referenceSearch");
const sections = [...document.querySelectorAll(".reference-section")];
const status = document.querySelector("#referenceSearchStatus");
function searchReference() {
  const terms = input.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  let visible = 0;
  for (const section of sections) {
    const text = section.textContent.toLocaleLowerCase();
    section.hidden = !terms.every(term => text.includes(term));
    if (!section.hidden) visible += 1;
  }
  status.textContent = terms.length
    ? `${visible} of ${sections.length} sections match${visible ? "." : ". Clear search to show all sections."}`
    : `All ${sections.length} sections shown.`;
}
input.addEventListener("input", searchReference);
document.querySelector("#clearReferenceSearch").addEventListener("click", () => {
  input.value = "";
  searchReference();
  input.focus();
});
// Native Ctrl+F / Command+F remains available; no application shortcut handler.
searchReference();
