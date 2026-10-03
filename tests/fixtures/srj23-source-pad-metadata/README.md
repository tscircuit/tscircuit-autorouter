# SRJ23 authoritative pad facts

Public source: `dataset-srj23-partially-routed-subcircuits` revision `53fc559`,
`circuits/circuit007.tsx` and its imports. These are the physical pad rows of a
render with routing disabled, using the existing fixture alias
`tscircuit-for-pipeline9-fixtures` 0.0.2467, core 0.0.1861 and React 19.2.8.

The original dataset SRJ remains unchanged. The post-routing adapter requires
exact pad/port IDs, land geometry and layers to match these source facts. This
restores information omitted by the SRJ producer; it does not reconstruct KiCad
rules or certify the board for manufacture. No coordinates or IDs waive a rule.
