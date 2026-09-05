# Vendored STEP kernel runtime

This directory contains the exact single-threaded runtime from `libcascade@3.0.2`, used locally in a module Worker. No runtime file is fetched from a CDN.

The upstream 42,691,285-byte WASM is split into three files no larger than 16 MiB so every delivery surface can carry it. The Worker reassembles and SHA-256 verifies those bytes before instantiation; the unsplit WASM is deliberately not committed. `asset-manifest.json` records every source and derived hash.

The upstream Emscripten glue contained two runtime code-generation sites. `scripts/vendor_step_kernel.mjs` deterministically replaces them with Emscripten 6.0.5's official `DYNAMIC_EXECUTION=0` generic embind and emval fallbacks. The vendored glue contains neither `eval` nor `new Function`. This is a reviewable glue-only CSP patch; the WASM bytes are unchanged.

License and provenance records are retained beside the runtime. Open CASCADE Technology is distributed under LGPL-2.1 with the Open CASCADE exception. Review the included license texts, upstream manifests, replacement/relinking obligations, and `tools/cad-kernel/README.md` before distribution.

Reproduce from the registry with `node scripts/vendor_step_kernel.mjs`. Verify the committed assets without network access with `node scripts/vendor_step_kernel.mjs --check`.
