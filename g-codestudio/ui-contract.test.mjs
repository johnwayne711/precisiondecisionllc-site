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
