# Reference via/trace clearance optimization

## Change

The indexed Rust DRC evaluator does not have the reference evaluator's exact
semantics. Instead of substituting it, this pass directly ports
`@tscircuit/checks` 0.0.163's `lib/check-via-trace-clearance.ts` into
`rust/drc/src/check_via_trace_clearance.rs`. `getDrcErrors` now uses that port
through `lib/bindings/checkViaTraceClearance.ts`. Its API is unchanged.

The native loop preserves via/segment order, epsilon, asymmetric connectivity,
concatenated pair-key collisions, permanent overlap suppression, strict minimum
gap replacement and result order. Geometry helpers were checked against the
source arithmetic. TS retains input projection, readable names and unit
formatting. The wire representation preserves nonfinite numbers, negative zero,
lone surrogate IDs/layers and non-string prototype identities in connectivity.

The initial literal implementation was slower than TS. The retained version
delays pair-key allocation until a pair could affect results, clones descriptors
only when retained, and hoists per-trace metadata out of the segment loop. It
does not change the routing or clearance algorithms.

The separate trace-watch partition experiment was rejected. It did not
reliably improve deferred scans, which inspect caller-owned arrays and maps.
Skipping those checks would break mutations between public steps/callbacks.
No trace-simplification production changes were retained.

## Measurements

Local, sequential, fresh Bun process per whole-board solve, Pipeline9 effort 1.
The baseline is a snapshot of the latest code immediately before this pass;
it is not upstream main. Module initialization occurs before timing. These
whole-board runs exclude CPU sampling. One run per arm per board means the
small aggregate difference is only indicative.

| SRJ18 board | Before | After | Time reduction |
|---|---:|---:|---:|
| 2 | 64.07s | 62.82s | +1.96% |
| 12 | 45.79s | 46.02s | -0.49% |
| 13 | 55.13s | 51.94s | +5.79% |

Total: 164.99s → 160.77s, 2.56% less elapsed time.
Unchanged stages also varied, so this does not establish that the entire
observed difference was caused by the patch. Board 12's small total regression
occurred alongside timing changes in unchanged pathing/routing/simplification.

Isolated end-to-end reference clearance calls include TS projection and error
formatting. Medians of four timed runs per arm, alternating order after warmup,
on each board's stored routed-output circuit:

| Board | TS reference | Rust adapter | Speedup |
|---|---:|---:|---:|
| 2 | 195.77ms | 42.60ms | 4.60x |
| 12 | 69.81ms | 18.65ms | 3.74x |
| 13 | 29.63ms | 9.66ms | 3.07x |

These microtimings are not whole-board speedups. The corpus contains 13 stored
routed outputs; boards 6, 14 and 15 use original inputs because frozen routed
output files are absent. All 16 cases match complete ordered error objects and
serialized bytes, with unchanged inputs.

## Validation

- Release WASM build and embedded module generation passed, using installed
  wasm-bindgen 0.2.128. No dependency installation or formatting.
- Full TypeScript typecheck passed.
- Six focused tests passed (506 expectation calls), covering ordered errors,
  epsilon edges, overlap suppression, pair-key collisions, prototype IDs,
  lone-surrogate IDs/layers, missing/null/undefined widths, nonfinite scalars,
  zero-length segments, through-pad centers, asymmetric connectivity, and
  100 seeded randomized circuits, plus existing DRC integration cases.
- The final strengthened parity test additionally uses Node strict deep
  equality to check numeric distinctions such as signed zero.
- Boards 2, 12 and 13 solved with exactly the same iteration counts and trace
  bytes as both the pre-change snapshot and the frozen migration reference.

Artifacts, raw timings, hashes, runners, baseline source/modules and trace bytes:
`/private/tmp/rust-migration/drc-boundary-pass/`.

The native clearance improvement is substantial within its small budget. Larger
whole-board gains still require native high-density routing improvements or the
remaining repair01 force-improvement port. Nothing was committed in this pass.
