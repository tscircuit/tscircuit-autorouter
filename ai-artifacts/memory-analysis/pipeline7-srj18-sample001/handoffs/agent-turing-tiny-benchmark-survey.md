# Handoff: Turing

Latest findings:
- `tiny-hypergraph` has benchmark and profiling entrypoints, but no built-in memory benchmark or heap instrumentation.
- The most relevant script entrypoint is `scripts/benchmarking/port-point-pathing-section-pipeline.ts`, and it must be run with an explicit `--input` path.
- Running tiny-hypergraph scripts from `tscircuit-autorouter` is valid because the autorouter repo links the local `/home/ohmx/Documents/tiny-hypergraph` dependency.
- The benchmark wrappers in `tiny-hypergraph` use `process.cwd()`, so repo-local outputs land in the autorouter workspace when run from here.

References:
- [package.json](/home/ohmx/Documents/tiny-hypergraph/package.json:5)
- [scripts/benchmarking/port-point-pathing-section-pipeline.ts](/home/ohmx/Documents/tiny-hypergraph/scripts/benchmarking/port-point-pathing-section-pipeline.ts:10)
- [scripts/benchmarking/benchmark.ts](/home/ohmx/Documents/tiny-hypergraph/scripts/benchmarking/benchmark.ts:520)
- [package.json](/home/ohmx/Documents/tscircuit-autorouter/package.json:76)
