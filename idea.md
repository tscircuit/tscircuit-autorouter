# Performance Ideas

## Rust WASM Port Point Pathing For Pipeline8

- state: `done`
- hypothesis: replacing the port point path assignment stage with a native WASM graph walk can reduce pathing overhead while preserving Pipeline7's surrounding topology, high-density, stitching, repair, and visualization stages.
- risk: a first-pass graph walk may preserve solve completion but worsen DRC or route quality because it does not yet implement tiny-hypergraph congestion optimization.
- result: kept because dataset01 completion improved from `97.6%` (`83/85`) on Pipeline7 to `100.0%` (`85/85`) on Pipeline8. DRC improved from the first Rust attempt (`14.1%`) to `37.6%`, but remains below Pipeline7's `87.1%`; P95 and via count still need follow-up work.

## Port More Tiny-Hypergraph Quality Features Into Rust

- state: `done`
- hypothesis: porting region intersection cost, rip-up/reroute, terminal regions as real graph nodes, obstacle reservations, and duplicate congested port prepass should recover DRC and P95 while keeping the completion gain.
- risk: stricter reservations can reduce completion unless rip-up and best-state retention are implemented together.
- result: kept. Pipeline8 now uses terminal-visible input nodes, region net reservations, hard cross-net same-layer rejection, deterministic best-state retention, and soft foreign-target traversal penalties. Full dataset improves to `100.0%` completion, `83.5%` DRC, and `46.55` Avg Via.

## Reduce Rust WASM Tail Runtime And Clearance Errors

- state: `done`
- hypothesis: adding obstacle-distance/clearance cost and avoiding unnecessary second-pass work can close the remaining full-dataset DRC gap while reducing P95.
- risk: making keepouts too strict can reintroduce no-path failures in dense component target clusters.
- result: kept by completion and runtime tradeoff. Disabling duplicate congested-port prepass, reducing reroute passes to one, and narrowing the retained order set to `easy-first` plus `id-descending` improved Pipeline8 from P50 `3.86s` / P95 `22.48s` / DRC `81.2%` / Avg Via `47.14` to P50 `2.3s` / P95 `13.9s` / DRC `83.5%` / Avg Via `46.55`, while preserving `100.0%` completion.

## Single-Order Rust Pathing Trial

- state: `done`
- hypothesis: evaluating only the `easy-first` routing order will roughly halve the Rust pathing work on multi-connection boards and may bring P95 below Pipeline7 if quality does not collapse.
- risk: the second `id-descending` order is selected on some dense tail boards, so dropping it can regress DRC, vias, or completion.
- result: kept. The full dataset stayed at `100.0%` completion, improved DRC from `83.5%` to `84.7%`, improved P50 from `2.3s` to `2.1s`, improved P95 from `13.9s` to `11.6s`, and kept Avg Via competitive at `46.81`.

## Exact-Output Runtime Cleanup

- state: `done`
- hypothesis: removing repeated port scans, doing hard same-layer rejection before soft conflict scoring, pre-indexing input-node port lists, and removing unused multi-attempt scoring will reduce JS/Rust overhead without changing routing decisions.
- risk: local timing noise can hide small wins, but output quality should remain unchanged because the route order and edge costs are unchanged.
- result: kept. Current code-matched full dataset result is `100.0%` completion, `84.7%` DRC, P50 `1.9s`, P95 `10.4s`, Avg Via `46.81`.
