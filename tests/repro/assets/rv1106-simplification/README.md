# RV1106 post-repair simplification

Captured from Pipeline9 on commit e2f741c35a64a66df7b7b0d9a7aa27515d01ed3e, after joint DRC repair and before length matching and power expansion. The board is 50 × 50 mm with four copper layers and top-side components.

The clocks (11 traces), boot flash (21 traces), and remaining (36 connections) phases use the existing rv1106-final-vias phase fixture. All five phase views and the full routed board are snapshotted.

post-repair.json.gz contains the actual joint-repair constructor input, connectivity map, serialized mutation set, and 238 repaired HD routes. The test restores the captured output through the existing solver output method; it does not rerun upstream repair. Pipeline9 still runs its real registered length-matching and power-expansion stages.

Baseline: 6031 repaired-route points and 26 final relaxed DRC reports. This is a simplification boundary repro, not an end-to-end rerouting reproducibility claim. The separate #2521 CI geometry mismatch remains unresolved: https://github.com/tscircuit/tscircuit-autorouter/actions/runs/34468657497 .

After simplification: 4350 repaired-route points and 25 final relaxed DRC reports. Vias and terminals are unchanged; existing copper contacts are asserted. The cleanup runs inside the registered Pipeline9 joint repair stage, before length matching and power expansion. The same full-board snapshot is refreshed; the five phase snapshots remain unchanged.

The comparison images are rendered from the actual before/after full-board SVGs. Repaired-route bends (same-layer non-collinear triples, cross-product tolerance 1e-9) decrease from 3974 to 2673; XY length decreases from 2042.31 to 1976.50 mm. The drawings recolor inner layers and outline vias without changing geometry.
