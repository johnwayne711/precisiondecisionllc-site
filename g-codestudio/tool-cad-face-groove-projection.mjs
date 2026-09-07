// Source-registered display only: A4ENN160305 with exact-name A4G0300M03P02GMP.
// Source mesh accuracy is unqualified; STEP declares 0.0508 mm model uncertainty.
// No cutting, stock removal, bore clearance or physical qualification is authorized.
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const A4ENN160305_CAD_PROJECTION = deepFreeze({
  "id": "kennametal-a4enn160305-a4g0300m03p02gmp-named-frame-display-v1",
  "units": "mm",
  "coordinateOrder": [
    "model-x",
    "negative-model-z"
  ],
  "modelCrp": [
    30.8,
    25.4,
    -152.4
  ],
  "holderOutline": [
    [
      0,
      0
    ],
    [
      0,
      152.15
    ],
    [
      25.4,
      152.15
    ],
    [
      25.4,
      0
    ]
  ],
  "insertOutline": [
    [
      10.9028,
      149.597618
    ],
    [
      10.9017,
      149.703844
    ],
    [
      10.8949,
      149.799993
    ],
    [
      10.8949,
      152.000315
    ],
    [
      10.9018,
      152.096545
    ],
    [
      10.9028,
      152.202695
    ],
    [
      10.9122,
      152.265525
    ],
    [
      10.9411,
      152.321595
    ],
    [
      10.9864,
      152.365445
    ],
    [
      11.0439,
      152.392715
    ],
    [
      11.108,
      152.400405
    ],
    [
      14.2838,
      152.275615
    ],
    [
      14.4975,
      152.290635
    ],
    [
      14.5176,
      152.289845
    ],
    [
      14.6198,
      152.187655
    ],
    [
      27.07516,
      152.187655
    ],
    [
      27.17735,
      152.289845
    ],
    [
      27.19746,
      152.290635
    ],
    [
      27.41109,
      152.275615
    ],
    [
      30.586949,
      152.400405
    ],
    [
      30.651173,
      152.392675
    ],
    [
      30.708634,
      152.365335
    ],
    [
      30.753944,
      152.321445
    ],
    [
      30.782778,
      152.265375
    ],
    [
      30.792085,
      152.202695
    ],
    [
      30.793175,
      152.096465
    ],
    [
      30.8,
      152.000315
    ],
    [
      30.8,
      149.799993
    ],
    [
      30.793168,
      149.703762
    ],
    [
      30.792085,
      149.597618
    ],
    [
      30.782728,
      149.534789
    ],
    [
      30.753832,
      149.478711
    ],
    [
      30.708475,
      149.434864
    ],
    [
      30.651031,
      149.407591
    ],
    [
      30.586949,
      149.399903
    ],
    [
      27.41109,
      149.5247
    ],
    [
      27.19746,
      149.509679
    ],
    [
      27.17735,
      149.510469
    ],
    [
      27.07516,
      149.612655
    ],
    [
      14.6198,
      149.612655
    ],
    [
      14.5176,
      149.510469
    ],
    [
      14.4975,
      149.509679
    ],
    [
      14.2838,
      149.5247
    ],
    [
      11.108,
      149.399903
    ],
    [
      11.0437,
      149.407636
    ],
    [
      10.9863,
      149.434973
    ],
    [
      10.941,
      149.478863
    ],
    [
      10.9121,
      149.534936
    ]
  ],
  "projectionGrid": 0,
  "holderSimplificationTolerance": 0.001,
  "insertSimplificationTolerance": 0.001,
  "sourceTessellationErrorBoundMm": null,
  "sourceModelUncertaintyMm": 0.0508,
  "source": {
    "stepUrl": "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/zip-g/A4ENN160305_GTM.stp",
    "stepSha256": "778a09caf9564c2722fca58c4ed6f7831b47b8e3c5cae70b95ec907661c37778",
    "manifestUrl": "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/json/A4ENN160305_GTM/A4ENN160305_GTM.json",
    "manifestSha256": "1bd6963830c9a22e2c3d7bedc8f1ca7f61c4a09ad121ec14a823294709abaa6e",
    "holderMeshUrl": "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/json/A4ENN160305_GTM/NOCUT_2414139_0.json",
    "holderMeshSha256": "4e2f4e09897115362423ffb77fec82a60f6dcabdba1fef1f1a3843bd6278bd66",
    "insertStepUrl": "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/zip-g/A4G0300M03P02GMP_GTM.stp",
    "insertStepSha256": "dcf0547d70816736a8667ee726690eff9a6bda0151e45ac8900cccda69c9f49e",
    "insertMeshUrl": "https://dpk3n3gg92jwt.cloudfront.net/domains/kennametal/json/A4G0300M03P02GMP_GTM/A4G0300M03P02GMP_GTM.json",
    "insertMeshSha256": "3b967883a67da8594a22eada1be069b5d236e38bc4fc12c6a8f4ae5c01f0d755"
  }
});
