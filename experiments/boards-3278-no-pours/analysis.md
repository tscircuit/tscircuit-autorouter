# Latest board analysis

Frozen runtime: tscircuit **0.0.3278**, core **0.0.2459**, capacity-autorouter **0.0.1153**, fanout-solver **0.0.103**. The prior integrations are included. All 19 original TSX boards ran with default routing, without copper pours or plane-specific handling. Original TSX/render/observer hashes are in `source-integrity.json`.

Blacksmith Ubuntu 24.04 ARM, Bun 1.4.3, 32 vCPUs, 19 concurrent boards, 600-second wall budget each. The paired run uses the baseline's exact frozen lockfile. The only changed runtime code is the source-equivalent tiny-hypergraph fix; original and patched bundle hashes and AST role assertions are recorded in the patcher and runtime manifests. Graph routing exists only in the main entry; Bun/Node worker bundles remain byte-identical.

| Result | Latest release | With fix |
| --- | ---: | ---: |
| Fully routed boards | 0/19 | 0/19 |
| Settled with routing errors | 17 | 17 |
| Hit 600-second limit | 2 | 2 |
| Emitted board copper and error counts | baseline | identical in all 17 |
| Captured 75-route graph completed routes | 75/75 | 75/75 |
| Impossible crossings in its known single-layer regions | 26 | 0 |
| Anonymous circuit fragment crossings | 1 | 0 |

## Diagnosis and choice

The baseline first blocking stages were high-density routing (7 variants), fanout (6), graph routing (4), and bus solving (2 budget cases). Native fanout counts remain 79/91, 83/95, 123/174, 13/32, 8/32, and 139/273 for the six circuit families. The latest release preserves exact copper in all 16 cases comparable to the prior release; all 187 common captured inputs are identical.

The most useful small correctness fix found is in tiny-hypergraph's greedy finishing pass. Its zero-added-cost `computeG` override also discards Infinity from the existing hard crossing check. Separately, the core, owned-frontier, and dense-workspace goal shortcuts can skip checking the final segment. Together these let a supposedly completed graph cross immutable copper inside a region restricted to one layer. Such a regional plan cannot be physically routed downstream. The fix preserves finite greedy ordering and forwards nonfinite costs, and checks goal hops at the three shortcut sites. It adds no search strategy, heuristic, or budget.

Replaying the actual 75-route graph removes 26 impossible intersections across 22 single-layer regions, completes all 75 routes, and preserves fixed copper. A reduced, anonymous fragment retains 18 original regions and 19 original ports, including a legal detour present in the captured result. It retains the union of the observed before/after paths and fixed copper, seals the cut boundary, renames IDs, and translates the coordinate origin; retained geometry is unchanged. The fragment and isolated goal hop have normal native SVG snapshots on the repro branches, updated at the same paths by the fix.

This does **not** complete an additional board yet. All 17 final emitted boards retain identical copper and error counts. Two error messages and some internal plans change. One variant previously blocked in high-density routing now exhausts graph routing; this is recorded below and is not described as identical internal behavior. Two bus budget cases remain unresolved. Contended wall times do not establish a performance improvement or a blanket absence of regressions.

Remaining major issues are incomplete native fanout, graph search exhaustion under the refined fixed-copper topology, unresolved regional high-density routes, and bus lane search budgets. The initial graph plan can include invalid through-via sites; mesh refinement removes those sites. Accepting that earlier plan as a fallback would preserve invalid copper geometry and is not a fix.

## Every board

Copper counts include the emitted partial/preloaded output; they do not mean successful board routing.

| Variant | Before / after emitted traces, vias | Before blocker | After blocker |
| --- | --- | --- | --- |
| butterstick-local | budget / budget | bus budget | bus budget |
| butterstick-native | 0, 0 / 0, 0 | fanout | fanout |
| butterstick-spaced | budget / budget | bus budget | bus budget |
| glider-local | 53, 97 / 53, 97 | high-density | high-density |
| glider-native | 0, 0 / 0, 0 | fanout | fanout |
| glider-spaced | 53, 92 / 53, 92 | graph | graph |
| h616-default-order-local | 16, 32 / 16, 32 | graph | graph |
| h616-local | 16, 32 / 16, 32 | graph | graph |
| h616-native | 0, 0 / 0, 0 | fanout | fanout |
| h616-spaced | 16, 32 / 16, 32 | graph | graph |
| icepi-local | 16, 30 / 16, 30 | high-density | high-density |
| icepi-native | 0, 0 / 0, 0 | fanout | fanout |
| icepi-spaced | 52, 98 / 52, 98 | high-density | graph |
| imx6-local | 17, 30 / 17, 30 | high-density | high-density |
| imx6-native | 0, 0 / 0, 0 | fanout | fanout |
| imx6-spaced | 17, 30 / 17, 30 | high-density | high-density |
| orangecrab-local | 52, 97 / 52, 97 | high-density | high-density |
| orangecrab-native | 0, 0 / 0, 0 | fanout | fanout |
| orangecrab-spaced | 52, 103 / 52, 103 | high-density | high-density |

## Validation and links

- Baseline: https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45016417632
- Paired fix run: https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45021198099
- Source repro: https://github.com/tscircuit/tiny-hypergraph/pull/338
- Source fix: https://github.com/tscircuit/tiny-hypergraph/pull/339
- Autorouter repro: https://github.com/tscircuit/tscircuit-autorouter/pull/4111
- Autorouter integration: https://github.com/tscircuit/tscircuit-autorouter/pull/4112
- Local checks cover fixed-copper preservation, greedy/final acceptance, frontier parity, serial/worker prepared routing, focused SVGs, and source/repro typechecking. Autorouter production build, integration/repro typecheck, runtime-worker parity, and focused integration checks pass. Source full CI tests pass; full autorouter CI shards are still running.

The baseline and fixed artifact digests, runtime hashes, full per-board results, and common input comparisons are committed alongside this report. No tscircuit main-package PR was created.
