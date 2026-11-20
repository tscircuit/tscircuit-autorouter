# Minimal fanout fixes

Restarted from main and retained 112 added / 21 removed production lines across six existing files, with no new production modules. The previous fixes added 997 lines: an 88.8% reduction. #318 fixes requested widths and terminal plane contact; #305 changes termination priority in one existing pass; #322 infers boundary headings and retries free headings.

The final board and guard runs execute `0f04f023a159bdb9835024f8265dcc5d00031758`. Final PR head `eaa81e3f09ef09348c03d526e096e609de869312` has the identical production tree; later edits update only regression assertions and generated snapshots. The larger repair/CSP implementation is removed. A 19-line neighbor expansion lost two completed guard cases; its order-preserving 41-line replacement restored them but added no completed cases, so it is also removed.

| Original full TSX board | Main valid partials | Lean valid partials | Main / lean drills |
| --- | ---: | ---: | ---: |
| orangecrab | 104/273 | 141/273 | 113 / 124 |
| h616 | 32/174 | 107/174 | 74 / 88 |
| butterstick | 29/91 | 60/91 | 59 / 57 |
| glider | 60/95 | 72/95 | 53 / 63 |
| imx6 | 2/32 | 9/32 | 7 / 7 |
| icepi | 5/32 | 9/32 | 7 / 8 |
| **Total** | **232/697** | **398/697 (+71.6%)** | **313 / 347** |

These are uncommitted partial fanout requests, not connected electrical nets or completed boards. Each accepted partial passes copper DRC, requested width and modeled plane-contact checks. Main produced 347 raw partials, of which 232 passed. Raw partials rise 347→398 (+14.7%); valid partials rise 232→398 (+71.6%), including corrections to previously invalid widths and plane contact. Drill counts include every diagnostic partial, including invalid main partials. All 398 lean partials pass; no excluded OrangeCrab plane landing.

Both revisions run sequentially on the same Blacksmith worker for each board, from identical TSX and physical inputs, with a 600-second routing budget. Routes and vias are removed before routing. The configured order is fanout → bus lanes → remaining nets. **0/6 boards complete fanout**; routing never reaches the bus lanes phase. All six physical circuit, captured input and raw PCB SVG hashes match before/after. No copper is committed, so PCB SVGs remain unchanged.

| Check | Before | Lean |
| --- | ---: | ---: |
| Frozen guard completions | 30/72 | 30/72; all 30 SVGs identical |
| Isolated boundary requests | 235/300 | 276/300 (+17.4%) |
| Isolated boundary drills | 180 | 177 (−1.7%) |
| Boundary requests vs old large stack | 276/300 | same 276 requests |
| Boundary drills vs old large stack | 181 | 177 (−2.2%) |

The full 72-case guard runs before/after on one Blacksmith worker at concurrency 16 with 120-second case deadlines. Completed-case mean vias is 148.5 on both. Completed-case P50 is 43,451→42,271 ms (−2.7%); P95 is 92,657→91,723 ms (−1.0%); mean is 48,626→48,424 ms (−0.4%) in this paired run. Percentiles use nearest rank among completed cases.

The isolated boundary cohort retains every original obstacle, resolves request widths on both sides and clears bus guidance to isolate heading behavior. It is a separate single-request test, not a joint board completion rate. Inference alone gives 235→247 (13 gains, one loss); free-heading recovery gives 247→276 (29 gains, no losses). Explicit guidance remains fixed. A final paired verification of the ownership guards preserves all 276 accepted request sets, copper hashes and 177 drills across all six boards. All 12 full-board diagnostic output objects also remain identical to the preceding lean source.

**Tradeoff versus the previous large stack:** 416→398 valid full-board diagnostic partials (−4.3%) and 343→347 drills (+1.2%), with the same 0/6 completed boards and 30 completed guard cases. The lean version gives up those 18 partials for 88.8% fewer added production lines. It does not reproduce every old partial-route result.

The existing pour check filters transit layers and irrelevant distances before ownership queries. It still checks remote target-plane pours until same-net model existence is known, and retains the existing alias-only ownership fallback. This avoids a cold full-index scan in the native diagnostic: the initial implementation read 740,814 alias elements; the final one reads 930. The main diagnostic read 132 for its original segment-only checks; the new plane checks add 798 reads. The SVG changes only that diagnostic count and the requested stroke width, with identical copper. No new module, cache or lookup framework.

The existing SRJ19 sample002 now solves all 15 fanout requests in one attempt instead of 17, with 12 vias in both versions. An independent macOS audit under both the 17- and 256-combination settings reports zero DRC issues and identical emitted copper. Its existing PCB and debugger snapshots are generated with the repository’s locked dependencies on macOS. The regression test checks success within its configured budget instead of requiring all 17 attempts. The other five related SRJ19 regression tests pass unchanged.

Width resolution covers the common ordinary routing entry. Custom staged/crossbar/source-origin/peripheral/single-layer builders are outside this fix. The boundary contact tolerance is core’s 0.0001 mm automatic inset plus 1e-9 mm roundoff, independent of trace width.

The native boundary unit repro reuses the existing capture with a 344-obstacle, 0.425 mm clearance halo; it adds no duplicate full-board blob. Equivalence evidence compares prepared requests, routed copper and drawing, and checks the accepted trace against all 2,038 original obstacles. All benchmarks use full inputs.

[Fresh paired boards](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44649632465) · [Final full guard](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44649632981) · [Inference cohort](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44634478771) · [Free-heading cohort](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44637145873)

[Final boundary equivalence](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44649632458) · [Formatting and all type modes on all five heads](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44649632430). All five final PR heads pass formatting and every typecheck mode. All 40 macOS shards and all five aggregate test checks pass; exact heads, run IDs and job results are in final-checks.json.gz.

The archive contains each variant’s metadata, uncommitted output patch, physical audit and PCB SVG. Restore an output using reconstruct-output.py and the corresponding original captured fanout input from the linked immutable input archive. The patch verifies the decompressed input hash and retained obstacle count. Source pins, final PR pins, raw reports and hashes are included.
