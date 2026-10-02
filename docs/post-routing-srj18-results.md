# SRJ18 saved-copper controls

This is a bounded standalone replay experiment on public SRJ18 revision
`100e8957ce789b5b288e14c476dc83f4efc5214b`, separately from the default
Pipeline9 tail integration and the small single-net PR benchmark profile.
It uses immutable saved copper from seed1, effort1, no-cache captures made on
`30ff695b` with uncommitted support changes. It does not establish fresh
current-head whole-pipeline performance.

## Full16 eligibility

Twelve saved baselines completed with zero native relaxed errors. The source-backed
physical model classifies seven as unsupported, four as invalid original boards,
and one as an original plated-traversal failure. Four captures were censored.
There are **zero directly eligible original baselines**. Unsupported, invalid,
failed and censored cases are excluded from the optimization denominator.
The relaxed native checker omits some physical checks, so its zero count does
not certify these originals. No source geometry, layer, owner or rule is waived.

| Sample | Original capture seconds | Physical status | First blocker |
| --- | ---: | --- | --- |
| 001 | 7.131 | unsupported | UnsupportedPostRoutingInputError: Authoritative source pads absent from SRJ: pcb_plated_hole_12 |
| 002 | 68.402 | censored | Baseline capture censored; no saved copper |
| 003 | 6.319 | failure | Error: Invalid physical plated traversal source_trace_0__source_net_0_mst2_0:5 |
| 004 | 31.393 | invalid_original | Foreign copper clearance source_trace_43__source_net_43_mst1_0:wire:8/hole:pcb_hole_1 |
| 005 | 5.097 | unsupported | UnsupportedPostRoutingInputError: Authoritative source pads absent from SRJ: pcb_plated_hole_62 |
| 006 | 63.824 | censored | Baseline capture censored; no saved copper |
| 007 | 8.390 | invalid_original | Foreign copper clearance source_trace_6__source_net_6_mst4_0:via:5/pad:322:0 |
| 008 | 34.300 | unsupported | UnsupportedPostRoutingInputError: Unsupported slotted drill 442 |
| 009 | 10.573 | unsupported | UnsupportedPostRoutingInputError: Unsupported pad geometry 159: source land shape polygon |
| 010 | 14.772 | unsupported | UnsupportedPostRoutingInputError: Unsupported slotted drill 381 |
| 011 | 12.463 | invalid_original | Foreign copper clearance source_trace_48__source_net_48_mst1_0:wire:1/hole:pcb_hole_0 |
| 012 | 47.850 | unsupported | UnsupportedPostRoutingInputError: Unsupported pad geometry 12: source land shape polygon |
| 013 | 31.807 | invalid_original | Drill spacing source_trace_47__source_net_47_mst6_0:via:10/source_trace_47__source_net_47_mst0_0:via:8 |
| 014 | 60.613 | censored | Baseline capture censored; no saved copper |
| 015 | 81.659 | censored | Baseline capture censored; no saved copper |
| 016 | 22.681 | unsupported | UnsupportedPostRoutingInputError: Unsupported pad geometry 45: source land shape polygon |

The original capture wall times sum to 507.274s. The nominal 60s
cooperative capture cap overran on synchronous steps (60.6–81.7s); those four
cases remain censored and were not rerouted for this comparison.

## Same-reference A/B/AB

Sample007 originally had 199 vias, 2520.204mm copper and 1186 bends. A
full-stack via intersects a foreign bottom pad. The optimizer refuses this
invalid original. An unpublished, explicit reroute of that defective net
created the separately identified **197-via / 2529.558mm / 1185-bend reference**.
That repair is not bundled here and is not counted as optimizer acceptance.

The fixture stores this public reference and each arm's changed-net copper
plus output order, allowing reconstruction without a solver job. The regression
checks input/source/output hashes, complete connectivity and both the continuous
physical validator and unchanged native relaxed checker. All four saved outputs
have zero physical diagnostics and zero native errors. Unaffected copper is exact.

| Arm | Vias | Copper mm | Bends | Wall seconds | Changed nets |
| --- | ---: | ---: | ---: | ---: | ---: |
| Reference | 197 | 2529.558 | 1185 | — | 0 |
| A | 156 | 2635.808 | 1073 | 46.531 | 9 |
| B | 155 | 2770.225 | 1130 | 48.906 | 9 |
| A+B | 168 | 2612.687 | 1157 | 47.945 | 5 |

A reduces vias by 20.8% with +4.2% copper; B by 21.3% with +9.5%; A+B by
14.7% with +3.3%. None dominates every metric. The uniform 0.1mm width gives
a width-times-length area proxy of 252.956/263.581/277.023/261.269mm²,
respectively. This proxy excludes caps, junction overlaps, lands and via annuli
and is **not** copper union area.

Each arm uses the same reference/input, plan order (16 nets sorted by via count),
0.25mm grid, via cost100, bend cost0.01, via-only objective, 1.5M expansions/3s
active search per selected net, and one new via per branch. A+B splits each net's
search budget in half. These are separate explicit atomic single-net calls;
validation is additional. The experimental total length allowance is 15% and
the bend allowance100/net, with up to16 changed nets. A45s selection budget is
checked between atomic calls; all arms stopped before all plans were attempted.
The hard outer watchdog is60s/3GiB, under the shared benchmark lock. Peak sampled
RSS was1.44/1.47/1.50GB for A/B/A+B. Partial valid output is distinguished from
unattempted/censored net plans; these numbers are not a complete sweep.

A prior155-via proposal had six native errors and is rejected. A prior
qualified172-via run had +2.7% copper; its log/hash survive but its copper artifact
was overwritten, so it is not used for the saved replay or image. Sample013's
separate reference attempt failed to reach one terminal (4.116s,0.95GB); it
released no valid reference and contributes no A/B/AB improvement.

Original input SHA: `6b18b4508d91ef3606e1a376f95fa7cd279b6b1e84f764aa462c5002b26f8737`.
Reference SHA: `3d8333c0da34ebe7bc62be5fa13dd281aa80c105474ae7c6fb5c78da6e0b7798`.
Output SHAs and exact replacements are in
[`sample007-saved-replay.json`](../tests/fixtures/srj18-post-routing/sample007-saved-replay.json).
Run `bun test tests/features/pipeline9-srj18-saved-post-routing.test.ts` to
reconstruct and validate the saved comparisons. This does not rerun the search
or assert universal improvement.
