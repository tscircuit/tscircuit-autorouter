# Minimal fanout fixes

Restarted from main and retained 104 added / 21 removed production lines across six existing files, with no new production modules. The previous fixes added 997 lines: an 89.6% reduction. #318 fixes requested widths and terminal plane contact; #305 changes termination priority in one existing pass; #322 infers boundary headings and retries free headings.

The larger repair/CSP implementation is removed. A 19-line neighbor expansion lost two completed guard cases; its order-preserving 41-line replacement restored them but added no completed cases, so it is also removed.

| Original full TSX board | Main valid partials | Lean valid partials | Main / lean drills |
| --- | ---: | ---: | ---: |
| orangecrab | 104/273 | 141/273 | 113 / 124 |
| h616 | 32/174 | 107/174 | 74 / 88 |
| butterstick | 29/91 | 60/91 | 59 / 57 |
| glider | 60/95 | 72/95 | 53 / 63 |
| imx6 | 2/32 | 9/32 | 7 / 7 |
| icepi | 5/32 | 9/32 | 7 / 8 |
| **Total** | **232/697** | **398/697 (+71.6%)** | **313 / 347** |

These are uncommitted partial fanout requests, not connected electrical nets or completed boards. Each accepted partial passes copper DRC, requested width and modeled plane-contact checks. Main produced 347 raw partials, of which 232 passed. All 398 lean partials pass; no excluded OrangeCrab plane landing.

Both revisions run sequentially on the same Blacksmith worker for each board, from identical TSX and physical inputs, with a 600-second routing budget. Routes and vias are removed before routing. The configured order is fanout → bus lanes → remaining nets. **0/6 boards completes fanout**; bus lanes never starts. All six physical circuit, captured input and raw PCB SVG hashes match before/after. No copper is committed, so PCB SVGs remain unchanged.

| Check | Before | Lean |
| --- | ---: | ---: |
| Frozen guard completions | 30/72 | 30/72; all 30 SVGs identical |
| Isolated boundary requests | 235/300 | 276/300 (+17.4%) |
| Isolated boundary drills | 180 | 177 (−1.7%) |
| Boundary requests vs old large stack | 276/300 | same 276 requests |
| Boundary drills vs old large stack | 181 | 177 (−2.2%) |

The full 72-case guard runs before/after on one Blacksmith worker at concurrency 16 with 120-second case deadlines. Completed-case mean vias is 148.5 on both. Timings are mixed/slightly slower; no speedup is claimed. Exact nearest-rank P50/P95/mean are in analysis.json.

The isolated boundary cohort retains every original obstacle, resolves request widths on both sides and clears bus guidance to isolate heading behavior. It is a separate single-request test, not a joint board completion rate. Inference alone gives 235→247 (13 gains, one loss); free-heading recovery gives 247→276 (29 gains, no losses). Explicit guidance remains fixed. The heading benchmark source differs from the selected source only in a plane path generator unused by these boundary requests.

**Tradeoff versus the previous large stack:** 416→398 valid full-board diagnostic partials (−4.3%) and 343→347 drills (+1.2%), with the same 0/6 completed boards and 30 completed guard cases. The lean version sacrifices those 18 partials to remove almost 90% of added production code. It does not reproduce every old partial-route result.

Width resolution covers the common ordinary routing entry. Custom staged/crossbar/source-origin/peripheral/single-layer builders are outside this fix. The boundary contact tolerance is core’s 0.0001 mm automatic inset plus 1e-9 mm roundoff, independent of trace width.

The native boundary unit repro reuses the existing capture with a 344-obstacle, 0.425 mm clearance halo; it adds no duplicate full-board blob. Equivalence evidence compares prepared requests, routed copper and drawing, and checks the accepted trace against all 2,038 original obstacles. All benchmarks use full inputs.

[Fresh paired boards](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44640940791) · [Final full guard and rejected optional candidates](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44640940918) · [Inference cohort](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44634478771) · [Free-heading cohort](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/44637145873)

The archive contains each variant’s metadata, uncommitted output patch, physical audit and PCB SVG. Restore an output using reconstruct-output.py and the corresponding original captured fanout input from the linked immutable input archive. The patch verifies the decompressed input hash and retained obstacle count. Source pins, final PR pins, raw reports and hashes are included.
