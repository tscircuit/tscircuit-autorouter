# A64 DDR regional routing memory reproduction

The source is OLIMEX A64-OLinuXino revision H, copyright OLIMEX Ltd., licensed
CC-BY-SA-3.0-US. Its original KiCad PCB is available at
[OLIMEX/OLINUXINO, commit b48543c9](https://github.com/OLIMEX/OLINUXINO/blob/b48543c9674439c97a5bfa2024830f22a94d7a35/HARDWARE/A64-OLinuXino/1.%20Latest%20hardware%20revision/A64-OLinuXino%20hardware%20revision%20H/A64-OlinuXino_Rev_H.kicad_pcb).
Source-board SHA-256:
`3acf7af7d39d54ba87343845d78851b0245a6290841cb463c42c7e41696404f4`.

The full input retains the original CPU/RAM placement, all 2,122 source copper
pad obstacles, six copper layers, 75 DDR signal nets and 184 terminals. Existing
tracks, vias and zones were removed. Noncircular pads use rectangle proxies and
the board uses its edge bounding box. Source signal-layer roles are retained as
bus restrictions; no timing or impedance constraints were invented. This is a
DDR signal-routing workload, not an electrically qualified whole board.

The high-density checkpoint was captured from an uncached, effort-1 Pipeline 9
run at autorouter `637b6c581128238f6c61227a1c15be423d24baca`, Bun 1.4.3. It
preserves all 2,133 preprocessed obstacles, node order, ownership groups, failure
probabilities, physical rules and layer policy. The eleven additional obstacles
come from pipeline preprocessing; no source pad is removed.

The regional checkpoint is the actual fallback request for
`new-cmn_55-603__sub_0_0`, reached after 16,856 high-density steps. It has 18
terminals belonging to nine local route requests. All board obstacles and
ownership groups are retained. ConnectivityMap and Map records are serialized
as plain records, and the empty movable-preload Set as an empty array; the loader
restores their original runtime types. No search state or routed answer is saved.

The topology checkpoint is the actual five-group input to the merging stage.
It contains 20,586 input nodes. Baseline merging creates 515,892 atomic regions
and 36,786 final nodes, then keeps the construction-only regions alive after
completion. The topology regression checks the exact final-output hash before
asserting that the construction workspace has been released.

Decompressed fixture SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `a64-full-ddr-memory.srj.json.gz` | `9d3e7417f6b1b1711ffc642c02fda5333cb33861d08bb1cc91228846bb751848` |
| `a64-ddr-high-density-memory.json.gz` | `fed69f08584352af00dfeb87fe88967336d4f6dbc7cf3bdfba47fd39954c1b46` |
| `a64-ddr-regional-memory.json.gz` | `fa6404132520a34c16fcbe168b9914e685a02038872dc3fb7bb48ccff23b143a` |
| `a64-ddr-topology-memory.json.gz` | `d9963fdce4e1ffa3979dd134c36e6092ce889880439fdfe4bc18e15fe2205909` |

The expected-failure tests isolate the causal retention paths without making
CI allocate several GiB: production regional routing enables search debug
capture, grow/shrink retains retired portfolios despite an explicit opt-out,
and topology merging retains its completed construction workspace.
Run them with:

```sh
bun test tests/repro/pipeline9-a64-ddr-regional-debug-memory.test.ts tests/repro/pipeline9-a64-ddr-growth-retention.test.ts tests/repro/pipeline9-a64-ddr-topology-memory.test.ts --timeout 9999999
```

For fresh memory measurements with identical search work, run each revision in
a separate process, sequentially, on the same machine:

```sh
bun scripts/repro-a64-ddr-memory.ts --max-steps 100000 --report /tmp/a64-hd-memory.json
bun scripts/repro-a64-ddr-memory.ts --full --max-steps 10000000 --max-rss-mib 4096 --report /tmp/a64-full-memory.json
```

The runner records peak RSS, retained portfolios, failed route searches, debug
exploration points, local copper and its SHA-256. Resource stops exit with code
2 and are never reported as solved. RSS observations exclude an artificial
forced-GC call. Local route segments and their hashes are comparison evidence,
not complete DDR acceptance or a claim of final DRC/timing closure.
