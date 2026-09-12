# Autorouting DRC Rust port

Fresh file-by-file port of `high-density-repair03/lib/drc/AutoroutingDrcEngine.ts` and its geometry dependencies. The error checks, tolerances, spatial query order, alias resolution, and first/worst-contact aggregation follow the TypeScript implementation.

Source mapping:

- `src/check_via_trace_clearance.rs`: `@tscircuit/checks/lib/check-via-trace-clearance.ts`; the reference check, separate from the indexed engine.
- `src/autorouting_drc_engine.rs`: `high-density-repair03/lib/drc/AutoroutingDrcEngine.ts`.
- `src/math_utils/`: the imported bounds, line-intersection, and segment-distance modules from `@tscircuit/math-utils`.
- `src/transformation_matrix/`: the imported point application, composition, inverse, rotation, and translation modules from `transformation-matrix`.
- `src/get_via_layers.rs` and `src/map_z_to_layer_name.rs`: the corresponding `high-density-repair03/lib/utils` modules.

The WASM binding lives in `rust/autorouter-bindings`. It supplies host `Math.hypot`, `Math.sin`, and `Math.cos` so geometry uses the same floating-point rounding as TypeScript. The TS adapter retains one Rust engine and its static obstacle indexes across evaluations. Each evaluation replaces dynamic trace geometry, as in the source. The adapter transfers trace input as JSON with exact floating-point parsing, while the engine decodes connectivity into a typed map once and borrows IDs during comparisons.

Pipeline 9 uses the Rust evaluator directly. Its adapter initializes the embedded module synchronously; ordinary callers do not select a backend or fetch WASM. The adapter synchronizes connectivity when regional repair changes the map and restores shared error references in result arrays. Indexed repair candidate generation and evaluation also run in Rust; required reference validation remains at the existing TypeScript boundary.

Validation:

```sh
export TSCIRCUIT_TS_REFERENCE=/absolute/path/to/frozen-ts-checkout
bun rust/autorouter-bindings/integration/drc-parity.ts
bun rust/autorouter-bindings/integration/drc-parity.ts --trace-dir /path/to/benchmark-traces --samples 2,8,12
```

The parity harness compares complete serialized results, ordering, statistics, and repeated evaluations for both the raw binding and the adapter.

The frozen reference checkout needs its own installed dependencies. Parity checks do not establish a performance improvement.

The reference via/trace clearance loop now runs in Rust through
`lib/bindings/checkViaTraceClearance.ts`. Input projection and original readable
name/unit formatting remain in TS. Traversal, overlap suppression, pair-key
collisions and error ordering follow the dependency. Rust delays key allocation
for distant pairs and copies descriptors only when an error is retained.
Focused parity: `bun test tests/wasm-via-trace-clearance-parity.test.ts --timeout 9999999`.
