// Independent official A16TMCLNR4 boring-bar GTM projection, DISPLAY ONLY.
// Reproduce using tools/tool-library/project-a16tmclnr4.py; evidence retains hashes.
// Preserve the raw source scale. The supplied mesh is coarse; its source error is
// unqualified, even though simplification is bounded. No boring/collision proof.
// IMPORTANT: nominalDisplayFrame is axial boring, NOT the vertical OD transform.
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const A16TMCLNR4_CAD_PROJECTION = deepFreeze({
  "id": "kennametal-a16tmclnr4-gtm-top-plan-v1",
  "units": "mm",
  "coordinateOrder": [
    "model-x",
    "negative-model-z"
  ],
  "view": "top plan from model +Y onto model X/Z",
  "projectionGrid": 0,
  "holderSimplificationTolerance": 0.001,
  "insertSimplificationTolerance": 0.001,
  "cadInsertNoseRadius": 0.79375,
  "modelCrp": [
    -16.26,
    0,
    -304.8
  ],
  "sourceTessellationErrorBoundMm": null,
  "nominalDisplayFrame": {
    "kind": "boring-bar-axial-upper-id-display-only",
    "sourceOrigin": [
      -16.26,
      0,
      -304.8
    ],
    "appZFromModel": [
      0,
      0,
      1
    ],
    "appPhysicalXFromModel": [
      -1,
      0,
      0
    ],
    "appYFromModel": [
      0,
      -1,
      0
    ],
    "description": "Nominal upper-ID display: app Z=model Z-CRP.Z; app physical X=CRP.X-model X. This is not the vertical-OD tool frame or physical setup confirmation.",
    "stockRemovalAuthority": false,
    "collisionAuthority": false
  },
  "source": {
    "stepUrl": "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/zip-g/A16TMCLNR4_GTM.stp",
    "stepSha256": "d6b1f89c1fc17d34e88cd02e0effee824b949673bffc1e6e7c44d50b5c9c41ed",
    "manifestUrl": "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/json/A16TMCLNR4_GTM/A16TMCLNR4_GTM.json",
    "manifestSha256": "f5c33a100f6f69727d92e2535d42ea68e5daf9ccf3f8a2b2c87f679d71f912bb",
    "holderMeshUrl": "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/json/A16TMCLNR4_GTM/NOCUT-71_1016456.json",
    "holderMeshSha256": "4df313d74a753c6453b66b8c93bbe0c512833eb13201fd415ad5e468651c4dfc",
    "insertMeshUrl": "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/json/A16TMCLNR4_GTM/CUT_1016456.json",
    "insertMeshSha256": "5d69567886f0da5e2d1e2195d1af42ed219889703dfb079cbcbe95906084f353"
  },
  "insertDisplayIdentity": "Manufacturer mounted compatible-size CUT gage outline; exact CNMG432 chipbreaker detail is not asserted.",
  "holderOutline": [
    [
      -14.1206,
      295.474
    ],
    [
      -14.3844,
      299.31
    ],
    [
      -14.645,
      303.194
    ],
    [
      -14.6407,
      303.268
    ],
    [
      -14.5536,
      303.555
    ],
    [
      -14.37,
      303.784
    ],
    [
      -14.1167,
      303.926
    ],
    [
      -13.8271,
      303.96
    ],
    [
      -4.307059,
      303.126797
    ],
    [
      -4.33617,
      303.561
    ],
    [
      -0.006325,
      303.182
    ],
    [
      12.3619,
      290.814
    ],
    [
      12.3635,
      284.986
    ],
    [
      12.3634,
      268.249
    ],
    [
      11.1671,
      268.249
    ],
    [
      11.1671,
      0
    ],
    [
      -11.1671,
      0
    ],
    [
      -11.1671,
      268.249
    ],
    [
      -12.3634,
      268.249
    ],
    [
      -12.3635,
      284.986
    ],
    [
      -13.6717,
      285.741
    ],
    [
      -14.2509,
      291.926
    ],
    [
      -14.2011,
      291.999
    ],
    [
      -14.0375,
      292.06
    ],
    [
      -13.881552,
      292.087121
    ]
  ],
  "insertOutline": [
    [
      -16.2601,
      304.079
    ],
    [
      -16.2567,
      304.125
    ],
    [
      -16.2191,
      304.299
    ],
    [
      -16.145,
      304.461
    ],
    [
      -16.0385,
      304.602
    ],
    [
      -15.9049,
      304.715
    ],
    [
      -15.7504,
      304.796
    ],
    [
      -15.5826,
      304.841
    ],
    [
      -15.4092,
      304.846
    ],
    [
      -4.51941,
      303.893
    ],
    [
      -4.34457,
      303.856
    ],
    [
      -3.19656,
      303.453
    ],
    [
      -3.03599,
      303.376
    ],
    [
      -2.89805,
      303.263
    ],
    [
      -2.78992,
      303.119
    ],
    [
      -2.71731,
      302.953
    ],
    [
      -2.6843,
      302.773
    ],
    [
      -1.93355,
      291.575
    ],
    [
      -1.93178,
      291.529
    ],
    [
      -1.93261,
      291.483
    ],
    [
      -1.93605,
      291.437
    ],
    [
      -1.97366,
      291.262
    ],
    [
      -2.0477,
      291.101
    ],
    [
      -2.1542,
      290.96
    ],
    [
      -2.28786,
      290.846
    ],
    [
      -2.44229,
      290.765
    ],
    [
      -2.61018,
      290.721
    ],
    [
      -2.78352,
      290.716
    ],
    [
      -13.6733,
      291.668
    ],
    [
      -13.8482,
      291.705
    ],
    [
      -14.9962,
      292.108
    ],
    [
      -15.1568,
      292.185
    ],
    [
      -15.2947,
      292.299
    ],
    [
      -15.4028,
      292.442
    ],
    [
      -15.4754,
      292.608
    ],
    [
      -15.5084,
      292.789
    ],
    [
      -16.2592,
      303.987
    ],
    [
      -16.261,
      304.033
    ]
  ],
  "faceDownVisiblePath": [
    [
      -14.243189,
      291.843659
    ],
    [
      -14.9962,
      292.108
    ],
    [
      -15.1568,
      292.185
    ],
    [
      -15.2947,
      292.299
    ],
    [
      -15.4028,
      292.442
    ],
    [
      -15.4754,
      292.608
    ],
    [
      -15.5084,
      292.789
    ],
    [
      -16.2592,
      303.987
    ],
    [
      -16.261,
      304.033
    ],
    [
      -16.2601,
      304.079
    ],
    [
      -16.2567,
      304.125
    ],
    [
      -16.2191,
      304.299
    ],
    [
      -16.145,
      304.461
    ],
    [
      -16.0385,
      304.602
    ],
    [
      -15.9049,
      304.715
    ],
    [
      -15.7504,
      304.796
    ],
    [
      -15.5826,
      304.841
    ],
    [
      -15.4092,
      304.846
    ],
    [
      -4.51941,
      303.893
    ],
    [
      -4.34457,
      303.856
    ],
    [
      -3.227859,
      303.463987
    ]
  ]
});
