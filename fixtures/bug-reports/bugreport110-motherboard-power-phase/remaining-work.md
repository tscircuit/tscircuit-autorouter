# Remaining routing work after #3345

Investigated merged autorouter `6467a41` with its exact pinned expander. CPU profiles
are diagnostic only; timing comparisons below have profiling disabled.

## Findings

- Expansion queries returned 129,982,687 candidate obstacles; 82,097,138 (63%)
  belonged to other layers and were immediately discarded.
- Of 94,902 grid endpoint checks, 85,829 repeated the same query against the same
  index. This remains a potential optimization, not a claimed speedup.
- 8,568 grid attempts failed an endpoint check after allocating arrays for
  11,252,678 cells in total. Avoiding these allocations remains future work.
- An inert-force hypothesis was rejected: 469,922 force steps involved
  457,566,376 endpoint interactions, but none had no movable recipient. Do not
  remove force work on that assumption for this fixture.
- The profile still shows substantial high-density A01 search, polyline forces,
  and DRC query/cache work. Existing force/DRC PRs were checked for overlapping
  work; this change is confined to power-expander spatial lookup.

## Implemented change

Boolean collision queries lazily build an index for the requested layer. Each
index retains the original exact shapes and object metadata, and includes
through-vias on every occupied layer. Collision-list queries keep their original
global order; physical-contact and drill queries remain unchanged.

## Unprofiled expansion comparison

Same captured constructor input and options, Bun 1.4.2/macOS arm64, fresh processes,
run sequentially in ABBA order. Construction is included; input parsing, output
serialization and hashing are excluded. No cache or worker runtime.

| Run | Expansion time | Iterations |
| --- | ---: | ---: |
| Baseline 1 | 24.206 s | 7,751,939 |
| Layer index 1 | 21.942 s | 7,751,939 |
| Layer index 2 | 21.921 s | 7,751,939 |
| Baseline 2 | 24.321 s | 7,751,939 |

Mean stage time falls 9.6%, about 2.3 seconds. This is not a 9.6% whole-pipeline
speedup. Output is byte-identical in every run:
`ee0a362ad54e04076ab2d019c44a18ce842c640f4b14065d67bd6b9bbf07054a`.
Peak RSS varies between 2.21 and 2.46 GiB across these runs, so no memory improvement
is claimed. Raw measurements are in `remaining-work-results.json`.

## Repeat

Run `profile-full-route.ts` to capture `<label>.expansion-input.json` in the output
directory. Run `benchmark-expansion.ts <captured-input>` in fresh processes;
`EXPANDER_MODULE` optionally selects an absolute path to another revision's
`src/index.ts`. `EXPANSION_BENCHMARK_OUTPUT` saves results as JSON.

`inspect-expansion-work.ts <captured-input>` counts candidate/endpoint work.
`inspect-force-work.ts` counts force recipients through the high-density stage.
These probes deliberately instrument work; never use their elapsed time for
performance comparisons. They restore prototype methods when finished.

All 92 existing expander tests pass without snapshot updates. The additional
layer differential test covers 5,605 assertions. The original motherboard DRC
findings remain outside this optimization's scope. Dataset 18 is a pipeline
control but scarcely exercises power expansion; the captured expansion replay
provides direct coverage.
