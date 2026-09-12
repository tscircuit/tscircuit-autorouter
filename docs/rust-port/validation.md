# Naming migration validation

This records validation of the naming and organization change, not a claim that every port matches current upstream main.

This is a historical record. The three test failures below now pass after the
later test lifecycle updates. See [cleanup validation](cleanup-validation.md)
for the checks on the prepared `rust-experiment` branch.

## Passed locally

- Both Rust binding modules compiled and embedded with Rust 1.98.1 and wasm-bindgen 0.2.128. The default executable was 0.2.100; the matching installed executable was selected through `WASM_BINDGEN`.
- Repository `tsc --noEmit`.
- Package JavaScript build and TypeScript declaration build (`bun run build:ts`).
- Autorouter adapter build and A01/A03 step-by-step parity test: 1 passed.
- Hypergraph adapter build and package tests: 10 passed.
- Autorouter Rust unit tests: 3 passed.
- Specialized candidate identity parity, including retained nested objects and public insertion/neighbor identities: passed, including 48 step identity assertions.
- Orchestration resource lifetime: synchronous child frees and observed/custom winner retention passed.
- Hypergraph integration checks for parent stats, compact status across memory growth, exhaustion, and pipeline stepping: 4 passed, 320 assertions.
- Root terminal-port-identity and pipeline-error-propagation tests: 2 passed.
- Compared 190 Rust algorithm files with the source saved immediately before the naming migration. After removing import statements and normalizing renamed crate qualifiers, their bodies were identical. This includes the existing uncommitted performance work; it is not a whole-program semantic proof.

The specialized identity and hypergraph reference comparisons used the existing `/tmp/tscircuit-autorouter-ts-reference` checkout. That checkout reports commit `22800e78d093292efdc2259d3528aed59eec0c7e` and has local modifications. These are regression checks using the existing reference environment, not validation against `109c67b`. The A01/A03 package test compares against its installed TypeScript dependency.

## Pre-existing failures reproduced

Three root tests failed with undefined pipeline state:

- `tests/features/partial-rip-preloaded-trace-occupancy.test.ts`
- `tests/features/preloaded-port-duplication.test.ts`
- `tests/features/preloaded-fixed-segment-occupancy.test.ts`

The same three failures were reproduced using the saved pre-migration source and pre-migration generated modules. They access `solveGraph` before it is available or use `input` where the current pipeline exposes `inputProblem`. They were left unchanged to avoid a behavioral or test-contract change in the naming migration.

## Scope and limitations

- The agreed main reference is pinned at `109c67baebc709be95fb37df1fdac9b3b74624c5` in a separate source checkout. Its independent dependency installation remained at dependency resolution without further progress and was stopped. Main-reference parity has not been established.
- No full test suite, benchmark, formatting, or linting was run.
- Unresolved source mappings remain marked in `source-map.json`.
- Wire tags, cache metadata keys, source solver diagnostic names, and source-owned `NativeObstacleTree` names remain unchanged even where they include implementation terminology.
- Existing compiler warnings were not addressed as part of this migration.
