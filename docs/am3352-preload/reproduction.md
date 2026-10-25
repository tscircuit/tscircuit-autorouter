# AM3352 fixed-copper preload latency

After successfully routing all 46 DDR signals, a native AM3352 build passes 58 fixed traces into a three-port reset-net phase. The exact prepared preload stage contains 29,725 copper primitives, 33,500 capacity boundaries, and 70,963 ports. The current stage tests every primitive against every boundary: 995,787,500 exact distance comparisons.

On capacity-autorouter 0.0.1006, the full reset attempt fails its B01 search in 166.85 seconds; 157.55 seconds are spent preloading fixed copper. Net/trace/port aliases correctly resolve to the same net. Separately, a fresh native handoff-based autorouting phase generates a legal reset tree in 67.84 seconds. Its successful, inspected visual is included as a diagnostic witness, not as a completed whole board.

Run the isolated stage:

    bun scripts/benchmarks/am3352-preload-stage.ts /tmp/preload.json

The local source-stage baseline takes 188.214 seconds and produces 1,712 assignments on 1,648 ports without changing topology. Complete boundary/port output SHA-256:

    972aac01ef37571ba7be42ec0db9c4abc817ab8f50430e0aeb6176e723acebde

The paired Blacksmith workflow runs the base and prospective merged head class sequentially against this identical captured input, compares the complete output hash, and uploads timing/assignment reports. This reproduction changes no production solver behavior. It measures one stage; it makes no claim that the default reset search or the whole board is solved.

Fixture provenance and hashes are beside the compressed input. To render the successful routing witness:

    bun scripts/benchmarks/render-am3352-reset-witness.ts

The saved witness is generated diagnostic evidence. It is never loaded into the AM3352 board project as routed copper.

## Indexed-stage result

The spatial index queries primitive bounds expanded by the existing 1e-6 mm
geometric tolerance. Candidates are sorted back to their original boundary order;
the original exact-distance, layer, and closest-port checks still make every
assignment. Empty boundary graphs remain valid.

A local source-stage comparison measures **188.214 → 0.563 seconds**, with the
complete 33,500-boundary / 70,963-port output byte-identical, including all 1,712
assignments. The compiled package also completes the full pipeline through preload
in 6.108 seconds with that identical output. Four focused tests pass, covering the
real AM3352 output fingerprint, tolerance contacts, full-stack via layers, empty
graphs, and existing port/topology behavior. No time bounds are asserted in tests.

These results address preload latency. The subsequent B01 reset search still
fails on 0.0.1006; the independently generated routing witness establishes a legal
route, and the fresh AM3352 project uses a native handoff-aware support-net phase.
Broader solve-rate and Blacksmith results must be reported before merge.

Blacksmith ARM paired run 40146477157 on head 2ed844a2 measured
**212.099 -> 0.775 seconds**, with identical full output SHA and 1,712
assignments. The index is also skipped when no fixed-copper primitives exist,
so single-phase inputs do not pay to build an unused boundary index.
