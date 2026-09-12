# Uniform and standalone repair03 completion

These changes follow the TypeScript inventory snapshot. The comparison oracle
is the frozen checkout at `22800e78` with its retained local changes, matching
the previous SRJ18 measurements. They do not establish parity with newer main.

## Uniform port distribution

The remaining step, filtering, redistribution and rebuild traversal now live
in source-corresponding Rust files. The TypeScript class and helper paths remain
as adapters. Tests cover public Maps, queue mutations, original input aliases,
getter reads, custom Map and input `find`/`some` methods, graphics and repeated
terminal steps. Rebuild invokes the actual array `map` methods with Rust
callbacks, preserving custom methods, array species and holes. Its callbacks
remain callable when retained by a custom method.

Two small TS callbacks invoke `find` on caller-owned arrays. A numeric callback
reads each obstacle's fields in source order; Rust performs the arithmetic.
Shallow materialization remains in TS to preserve symbols and nested metadata.
There is no full-scene snapshot, mutation-detection scan or TS solver backend.
See [file correspondence](../../rust/uniform-port-distribution/README.md).

This is a completion change, not a speedup to the remaining Uniform phase.
Three alternating measurements with the same current constructor, excluded
from timing, gave:

| SRJ18 board | Previous TS step/rebuild | Native step/rebuild |
| --- | ---: | ---: |
| 2 | 30.79 ms | 179.74 ms |
| 13 | 60.75 ms | 218.00 ms |

Every measured arm produced identical trace-node bytes and public step counts.
The added cost is about 149–157 ms on these boards. Rejected implementations
cost seconds: repeated per-field crossings, then full-input projection. Reusing
the obstacle scalar buffer also increased isolated times to 202/236 ms, so it
was reverted; the reentrant-getter regression remains. The retained version
removes the larger costs without changing the algorithm.

## Standalone repair03

`lib/bindings/repair/GlobalDrcForceImproveSolver.ts` now extends `BaseSolver`
directly. Original field defaults, constructor, parameter reconstruction,
snapshot callbacks and visualization glue replace inheritance from the TS
search class. The existing Rust search implementation is unchanged.

The public standalone export, Pipeline9 regional safe-layer caller, and direct
callers in Pipelines4/6/7/8 now use that adapter. Pipeline9's main standalone
stage already did. A small dependency patch extracts the shared visualizer
registry, so the original registration function still controls both classes.
No dependency installation was performed.

The native class remains a distinct constructor. Code importing the repository
export can use its normal `instanceof` checks; it is no longer an instance of
the original dependency's separate class through inheritance.

The generic branch portfolio remains outside this change and can still run
the original standalone solver internally. TS diagnostic/evaluator helpers
and the default public DRC engine object remain available; this does not remove
the entire repair03 dependency.

## Validation

- Release WASM build and embedding, repository type check, and package
  JavaScript/declaration build passed.
- Uniform frozen-reference oracle passed constructor/every-step state,
  ordering, output aliases, nonfinite numbers, signed zero, public mutations,
  getter read logs, reentrant obstacle getters, custom Maps, custom
  `find`/`some`/`map` behavior, retained map callbacks, array species and holes.
- Six standalone repair integration scripts passed, including native route
  bytes, callbacks, mutations, constructor timing, public export identity,
  visualizer registration and original thrown errors.
- Two focused repository tests and the native Uniform constructor test passed.
  Cargo's initial registry lookup failed due unavailable DNS; the offline run
  passed using installed dependencies.
- Three complete SRJ18 runs, including the final retained source, matched all
  16 outcomes, diagnostics and routing work.
  All 13 successful boards' trace files compared byte for byte. Boards 6, 14
  and 15 retained the same failures as the frozen reference.

## Whole-board timing

Local SRJ18 runs used concurrency 4, effort 1 and a 600-second sample timeout.
Times below describe the 13 successful boards. These initial runs were
serialized in the order shown, using identical compiled WASM bytes. They
precede the final array `map` compatibility correction:

| Run | Mean | P50 | P95 |
| --- | ---: | ---: | ---: |
| Current, first run | 33.323 s | 21.033 s | 80.254 s |
| Control | 30.005 s | 20.627 s | 72.676 s |
| Current, confirmation | 31.121 s | 20.398 s | 74.956 s |

The control kept the current constructor and all other native code, replacing
only Uniform's step/rebuild with the frozen TS methods and the regional B01
standalone import with its original TS class. It also matched every outcome
and successful trace byte. The control source is a separate temporary copy;
there is no production backend switch.

The confirmation's mean was 1.116 s slower than the control: 0.231 s in Uniform,
0.181 s in the entire joint repair stage, and 0.704 s in other phases/overhead.
Regional B01 does not have its own timer, so that stage-wide delta cannot be
attributed to the changed caller. The two identical current runs differed by
2.202 s. These measurements show a repeatable Uniform cost, but do not isolate
a causal whole-board regression of 1.116 s. No additional speedup is claimed.

After the final `map` correction, a fresh release build and complete dataset
run again matched all 16 outcomes and all 13 successful trace files. This final
run averaged **31.476 s**, with P50 **20.657 s** and P95 **75.320 s**. Uniform
averaged 277.01 ms versus the control's 34.27 ms, a 242.74 ms stage difference.
The final module differs from the initial runs; its binaries and hashes are
saved under `srj18-final/`. The final package build, type check and focused tests
also passed. The control's embedded module bytes were checked against its
archived binaries.

No formatting, linting, commits or pushes were performed. Detailed build logs,
isolated timings and benchmark artifacts are under
`/private/tmp/rust-migration/module-completion/`.
