# Hybrid transactional router Rust boundary

The repository did not contain an established Rust addon convention when this
experiment began. The hybrid router therefore uses one focused Rust crate at
`rust/hybrid-routing-core` and keeps all tscircuit-facing orchestration in
TypeScript.

## Profile evidence

An SRJ18 pipeline 7 CPU profile was captured before adding Rust. The material
algorithmic costs were high-density route stepping, exact DRC spatial-index
queries and inserts, neighbor expansion, point-to-segment distance predicates,
and dynamic-index construction. Rendering costs visible in the profile are not
part of the Rust boundary.

The Rust core consequently owns only:

- bounded multi-layer path search and its priority queue;
- deterministic neighbor ordering and route-cost comparison;
- compact spatial indexing for region-local immutable geometry;
- exact region-local segment, circle, via, and rotated-rectangle predicates;
- local incremental clearance checks and work counters.

Rule compilation, route-object ownership, topology planning, region formation,
scheduling, transactions, full-board validation, diagnostics, visualization,
and tscircuit data conversion remain in TypeScript.

## Packaging decision

The crate exposes one canonical versioned JSON request/response protocol through
two feature-gated adapters:

- `node`: a Node-API addon built with napi-rs for Bun/Node worker threads;
- `wasm`: a browser-capable WebAssembly module built with `wasm-bindgen`.

Both adapters call `execute_protocol` in the same crate. Neither adapter contains
algorithmic behavior. Runtime selection is explicit in TypeScript and a missing
or incompatible runtime is an error; there is no TypeScript search fallback.

The protocol uses millimetres, explicit layer names, explicit resource budgets,
and stable array ordering. It transfers only a region envelope, referenced
terminals, local immutable geometry, and a solver budget. Full-board state is not
part of a region job.

Native binaries and WASM artifacts are build products rather than checked-in
source. Release packaging will need a target matrix before this experimental
router can be made a default or published as a generally available runtime.

`scripts/verify-runtime-equivalence.ts` accepts the built native and generated
WASM JavaScript modules and executes both golden requests against each runtime.
It requires byte-identical canonical JSON output, including work counters.
