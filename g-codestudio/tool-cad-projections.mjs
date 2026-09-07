// DISPLAY ONLY. Reproduce using tools/tool-library/project-mclnr163c.py.
// Independently projected MCLNR163C GTM body + mounted CUT insert, not a scaled
// MCLNR164D. No grid snapping; projected triangles are unioned before simplifying.
// CRP is STEP #3103, not estimated from the mesh or nominal holder dimensions.
// Clamp/screw/shim geometry is omitted. This outline has no machining authority.
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

export const MCLNR163C_CAD_PROJECTION = deepFreeze({
  "id": "kennametal-mclnr163c-gtm-top-plan-v1",
  "units": "mm",
  "coordinateOrder": [
    "model-x",
    "negative-model-z"
  ],
  "view": "top plan from model +Y onto model X/Z",
  "projectionGrid": 0,
  "holderSimplificationTolerance": 0.08,
  "insertSimplificationTolerance": 0.035,
  "cadInsertNoseRadius": 0.79375,
  "modelCrp": [
    -31.75,
    25.4,
    -127
  ],
  "source": {
    "stepUrl": "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/zip-g/MCLNR163C_GTM.stp",
    "stepSha256": "db9a866e3044c23e2869604ee24e394fbacc5f826efa673ed189bdccb44004c4",
    "manifestUrl": "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/json/MCLNR163C_GTM/MCLNR163C_GTM.json",
    "manifestSha256": "acf5fbd709477a75c504d661ac6603729a9309e34e226689e0ce6998f06ca499",
    "holderMeshSha256": "45ce7e82377f65c4f0110a964eeabe946d963abef7c215f3e252428ab47c3f4f",
    "insertMeshSha256": "f0fadf48a66b6ca9b802f10b4e5e8d361f0358fe62aa98711023b5035fbe10fe"
  },
  "holderOutline": [
    [
      -25.4,
      101.602
    ],
    [
      -28.8859,
      101.602
    ],
    [
      -30.2775,
      117.508
    ],
    [
      -29.463736,
      117.442796
    ],
    [
      -30.1689,
      125.503
    ],
    [
      -22.222459,
      124.877089
    ],
    [
      -22.2808,
      125.544
    ],
    [
      -14.9873,
      124.969
    ],
    [
      0,
      109.982
    ],
    [
      0,
      0
    ],
    [
      -25.4,
      0
    ]
  ],
  "insertOutline": [
    [
      -31.7488,
      126.159
    ],
    [
      -31.7087,
      126.456
    ],
    [
      -31.5404,
      126.741
    ],
    [
      -31.2708,
      126.934
    ],
    [
      -30.9368,
      127
    ],
    [
      -22.8972,
      126.358
    ],
    [
      -22.5287,
      126.231
    ],
    [
      -22.1087,
      125.882
    ],
    [
      -21.9357,
      125.623
    ],
    [
      -21.8802,
      125.393
    ],
    [
      -21.1804,
      117.394
    ],
    [
      -21.2152,
      117.087
    ],
    [
      -21.3623,
      116.815
    ],
    [
      -21.6422,
      116.601
    ],
    [
      -21.9905,
      116.528
    ],
    [
      -30.0301,
      117.171
    ],
    [
      -30.3986,
      117.297
    ],
    [
      -30.8187,
      117.646
    ],
    [
      -30.9583,
      117.834
    ],
    [
      -31.0472,
      118.135
    ]
  ],
  "faceDownVisiblePath": [
    [
      -30.254736,
      117.247809
    ],
    [
      -30.3986,
      117.297
    ],
    [
      -30.8187,
      117.646
    ],
    [
      -30.9583,
      117.834
    ],
    [
      -31.0472,
      118.135
    ],
    [
      -31.7488,
      126.159
    ],
    [
      -31.7087,
      126.456
    ],
    [
      -31.5404,
      126.741
    ],
    [
      -31.2708,
      126.934
    ],
    [
      -30.9368,
      127
    ],
    [
      -22.8972,
      126.358
    ],
    [
      -22.5287,
      126.231
    ],
    [
      -22.1087,
      125.882
    ],
    [
      -21.9357,
      125.623
    ],
    [
      -21.909575,
      125.514734
    ]
  ]
});
