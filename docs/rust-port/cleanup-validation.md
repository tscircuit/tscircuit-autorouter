# Experiment cleanup validation

Prepared on branch `rust-experiment`. This records local validation of the
existing migration plus cleanup, rather than a new upstream-main comparison.

## Cleanup

- Removed ten unused production TS geometry/via helpers (1,170 lines) and
  unused facade imports. The crossing parity fixture now reads its section
  builder from the frozen reference. Helpers used by a root test and legacy
  debugger fixture remain.
- Removed unused Rust imports. Preserved source-corresponding functions and
  diagnostic fields even where they currently produce dead-code warnings.
- Gated the Uniform live-value binding to WASM, matching its source crate.
  This fixes native test compilation without changing the WASM execution path.
- Removed machine-specific capture paths from parity harnesses; optional
  inputs are explicit and mismatch artifacts use a fresh temporary directory.
- Added a current experiment overview, clarified historical reference scope,
  committed historical timing records, and brought the source-map inventory
  to all 275 handwritten Rust files. Unverified correspondences remain marked
  as candidates; inventory completeness is not a provenance proof.

## Passed

- Full package build: both release WASM modules, generated/embedded bindings,
  JavaScript bundle and declarations. Rust tooling matches CI; wasm-bindgen
  0.2.128 was selected with `WASM_BINDGEN`.
- Full repository TypeScript typecheck.
- Twelve focused root tests, 576 expectation calls, including all modified
  preloaded-occupancy/lifecycle tests, boundary tolerance and reference DRC.
- Autorouter private adapter build/test: one test passed.
- Hypergraph private adapter build/test: eleven tests passed.
- Native `cargo test --locked --all-targets` for all thirteen crates:
  36 tests passed, plus example compilation. Crates without tests compiled.
- Eight frozen-reference harnesses: simple specialized solvers; via removal/
  merging; crossing reduction; trace orchestration; Uniform public collection
  behavior; standalone repair; high-density resource lifetime; and trace
  continuity on focused cases and all sixteen SRJ18 inputs/routed outputs.
- Fresh-process import of the built package routed SRJ18 board 1 with automatic
  embedded WASM initialization and byte-identical frozen reference traces.
- Source-map paths have no missing, stale or duplicate Rust entries. Generated
  modules, compiler output and temporary experiment captures remain outside Git.

Logs and the pre-cleanup source backup were retained locally under
`/private/tmp/rust-cleanup/`. No formatting or linting was run.

## Limits

The complete repository test matrix has not been run in this cleanup; CI is
still required. No new benchmark or parity claim against newer upstream main
was made. Existing source-provenance and migration-scope limitations are
described in the [overview](README.md) and linked records.
