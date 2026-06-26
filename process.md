# Performance Process

## Inputs

- Dataset: `dataset01`
- Run location: `local`
- Baseline pipeline: `7` (`AutoroutingPipelineSolver7_MultiGraph`)
- Candidate pipeline: `8` (`AutoroutingPipelineSolver8`)
- Constraint notes: local benchmark runs serialized, use half of available CPUs, no fallback logic for solver-internal invalid state.

## Baseline

Command:

```bash
./benchmark.sh --pipeline 7 --dataset dataset01 --concurrency 6
```

Raw results:

- Completed: `97.6%` (`83/85`)
- Relaxed DRC Pass: `87.1%`
- P50: `2529.965462ms`
- P95: `11668.458499799997ms`
- Avg Via: `50.55421686746988`
- Avg solved time: `3953.0924382891567ms`
- Timed out: `0/85`
- Artifact copies: `benchmark-result.pipeline7.dataset01.json`, `benchmark-result.pipeline7.dataset01.txt`

## Candidate: Pipeline8 Rust WASM Port Point Pathing

Commands:

```bash
cargo build --manifest-path rust/port-point-pathing-wasm/Cargo.toml --target wasm32-unknown-unknown --release
cp rust/port-point-pathing-wasm/target/wasm32-unknown-unknown/release/port_point_pathing_wasm.wasm lib/solvers/PortPointPathingSolver/rust-wasm/port_point_pathing_wasm.wasm
bun run build
./benchmark.sh --pipeline 8 --dataset dataset01 --concurrency 6
```

Raw results:

- Initial completed: `98.8%` (`84/85`)
- Initial relaxed DRC Pass: `14.1%`
- Initial P50: `2026.7861605000003ms`
- Initial P95: `13019.967164149992ms`
- Initial Avg Via: `55.464285714285715`
- Initial Avg solved time: `4273.897862761906ms`
- Timed out: `0/85`
- Initial failure: sample 52, `RustWasmPortPointPathingSolver: no region path for connection "source_net_7" from "cmn_192" to "cmn_267"`
- Artifact copies: `benchmark-result.pipeline8.dataset01.json`, `benchmark-result.pipeline8.dataset01.txt`

Latest local full-dataset result after completing the Rust quality and runtime work:

- Completed: `100.0%` (`85/85`)
- Relaxed DRC Pass: `84.7%`
- P50: `1916.9709250000014ms`
- P95: `10443.044104199998ms`
- Avg Via: `46.811764705882354`
- Timed out: `0/85`
- Top remaining DRC buckets: `trace_plated_hole_clearance`, `trace_plated_hole_accidental_contact`, `trace_smtpad_clearance`, `pcb_trace_error`, `trace_smtpad_accidental_contact`.
- Artifact copies: `benchmark-result.pipeline8.dataset01.json`, `benchmark-result.pipeline8.dataset01.txt`

Latest first-20 comparison:

- Pipeline7: `100.0%` completed, `95.0%` relaxed DRC, P50 `0.9s`, P95 `4.6s`, Avg Via `17.30`.
- Pipeline8 single-order gate: `100.0%` completed, `90.0%` relaxed DRC, P50 `0.9s`, P95 `4.5s`, Avg Via `17.00`.

Decision:

- Keep by workflow rule 1: `Completed %` improved from `97.6%` to `100.0%`.
- Tradeoffs: Relaxed DRC is close but still below Pipeline7 (`87.1% -> 84.7%`), P50 improved (`2529.965462ms -> 1916.9709250000014ms`), P95 improved (`11668.458499799997ms -> 10443.044104199998ms`), Avg Via improved (`50.55421686746988 -> 46.811764705882354`).
- Remaining work: reduce trace/plated-hole and trace/smtpad clearance failures without losing the `100.0%` completion rate or the P50/P95 win.

## Current Best Summary

- Pipeline8 keeps the main win: completion improves from `97.6%` to `100.0%`.
- Pipeline8 is faster on median runtime: P50 `1.92s` vs Pipeline7 `2.53s`.
- Pipeline8 is faster on tail runtime: P95 `10.44s` vs Pipeline7 `11.67s`.
- Pipeline8 still trails on relaxed DRC: `84.7%` vs Pipeline7 `87.1%`.
- Pipeline8 improves via count: `46.81` vs Pipeline7 `50.55`.
