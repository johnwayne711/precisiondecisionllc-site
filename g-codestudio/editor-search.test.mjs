import assert from "node:assert/strict";
import test from "node:test";

import {
  nextProgramSearchIndex, programSearchIndexFromAnchor, programSearchMatches,
} from "./editor-search.mjs";

test("finds text and line matches without choosing a direction", () => {
  const source = "N10 G0 X1\nN20 G1 X2\nN30 G0 X3";

  assert.deepEqual(
    programSearchMatches(source, "G0").matches.map(({start, end, line}) => ({start, end, line})),
    [
      {start: 4, end: 6, line: 1},
      {start: 24, end: 26, line: 3},
    ],
  );
  assert.deepEqual(programSearchMatches(source, ":2").matches, [{start: 10, end: 19, line: 2}]);
});

test("chooses the first match up or down from the preserved caret anchor", () => {
  const matches = [
    {start: 4, end: 6},
    {start: 14, end: 16},
    {start: 24, end: 26},
  ];

  assert.equal(programSearchIndexFromAnchor(matches, 10, 1), 1);
  assert.equal(programSearchIndexFromAnchor(matches, 20, -1), 1);
  assert.equal(programSearchIndexFromAnchor(matches, 30, 1), 0);
  assert.equal(programSearchIndexFromAnchor(matches, 2, -1), 2);
});

test("continues directional search and wraps after the first choice", () => {
  const matches = [{start: 4, end: 6}, {start: 14, end: 16}, {start: 24, end: 26}];

  assert.equal(nextProgramSearchIndex(matches, 2, 1), 0);
  assert.equal(nextProgramSearchIndex(matches, 0, -1), 2);
});
