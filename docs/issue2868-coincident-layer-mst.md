# #2868: independent MST correctness defect — coincident XY on different layers

**Scope:** Fix incomplete MST expansion of source PCB terminals; **not a full fix for #2868**.

## Verified root cause

The MST's union-find used only `x,y` to identify graph nodes, and its KD-tree candidate generator skipped all coincident `x,y` points, even when two terminals were on separate copper layers. Without a pre-existing conductive via or trace, top and bottom pads at the same coordinates are distinct physical terminals. They must not be collapsed before autorouting. A point-pair net with more than two points could therefore emit one fewer required edge and leave a source terminal disconnected.

This was reproduced with a three-terminal six-layer regression: **baseline 1 emitted edge / expected 2**. Both new tests were red on original `c591de445efc25c305ac2967d3340cde7b6897c2`.

## Correctness change

- Retain the existing `DisjointSet` coordinate-only default for other call sites and tests.
- Allow a caller-specified key; in `NetToPointPairsSolver`, distinct `layer` values at the same `x,y` produce different MST nodes.
- Skip only the identical point reference when generating neighbor edges, rather than discarding distinct co-located candidates.
- The new edge is an **unrouted candidate**, never an automatic electrical preconnection.

## Exact attachment proof

Original SHA-256: `471334fad7b86e550ad1e5b9aae796665957512c78d6cc58f58fd2f8f11d28ca`.

The original 684-connection, six-layer board includes **13** net records with distinct top/bottom terminal IDs at identical coordinates: `source_net_212`–`source_net_218` and `source_net_220`–`source_net_225`. All have at least six terminals; none declares initial externally connected points, and the SRJ has no preloaded traces.

An original-input A/B examination of these 13 nets, with no other source data changed, found **11 nets missing at least one original PCB port in their emitted edges** on baseline. The candidate returns **zero missing source port IDs for all 13**. Baseline emits `n-2` edges instead of `n-1` for each affected net. This is a topology-stage result, **not** a routed-board DRC or connectivity certification.

Reproduce the source-derived audit with the original unmodified JSON:

```sh
SRJ_FILE=/absolute/path/scanner-full-board.simple-route.json bun scripts/repros/issue2868-audit-stacked-terminals.ts
```

The command validates the exact input hash before inspecting all nets with co-located, different-layer ports. It checks both missing IDs and components in the emitted point-pair graph. Use it on an unmodified main checkout as a negative control and on this branch as the positive control.

## Qualification boundary

This change does **not** establish that the known `source_net_144_mst491` GND path-search failure is resolved. The GND net is a separate plane-aware routing issue. The complete original board must still finish routing, pass strict and relaxed DRC, and pass physical pad/via/plane connectivity before #2868 can close. Existing independent performance PRs #3774 and #3775 should remain separate.
