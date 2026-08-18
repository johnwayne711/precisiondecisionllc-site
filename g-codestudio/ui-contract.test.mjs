import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

test("keeps elapsed time green when timing becomes assumed", () => {
  const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.reader-time strong\.assumed-time\s*\{\s*color:\s*#fbbf24;\s*\}/);
  assert.match(styles, /\.reader-time #readerElapsedTime\.assumed-time\s*\{\s*color:\s*var\(--accent\);\s*\}/);
});
