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
