import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

test("keeps elapsed green and remaining orange across timing states", () => {
  const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.reader-time strong\.partial-time\s*\{\s*color:\s*var\(--warn\);\s*\}/);
  assert.match(styles, /\.reader-time strong\.assumed-time\s*\{\s*color:\s*#fbbf24;\s*\}/);
  assert.match(
    styles,
    /\.reader-time #readerElapsedTime\.partial-time,\s*\.reader-time #readerElapsedTime\.assumed-time\s*\{\s*color:\s*var\(--accent\);\s*\}/,
  );
  assert.match(styles, /\.reader-time #readerRemainingTime\s*\{\s*color:\s*var\(--warn\);\s*\}/);
});

test("renders search matches without selecting them in the editor", () => {
  const app = readFileSync(new URL("./app.mjs", import.meta.url), "utf8");
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

  assert.match(html, /id="gcodeSearchHighlights"/);
  assert.match(styles, /\.gcode-search-match\.is-active/);
  assert.match(app, /programSearchIndexFromAnchor/);
  assert.doesNotMatch(app, /setSelectionRange\(match\.start,\s*match\.end\)/);
});
