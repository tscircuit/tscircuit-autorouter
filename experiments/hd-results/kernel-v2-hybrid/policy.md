# Archived kernel v2: pruned small grids and storage-only larger grids

This report measures `a62bd94a1e593446c913ca02c12abfb277d899ee` against baseline
`637b6c581128238f6c61227a1c15be423d24baca`. The exact owner-dependent capacity
bound expanded compact coverage; normal routing retained pruning for `S < 2^21`
and selected storage-only mode for newly eligible larger scenes. This is
historical experimental policy, not the final all-storage default.

The strict renderer validated all 42 paired samples, both exact refs, resource
evidence and arithmetic before producing [results.md](results.md),
[per-sample.csv](per-sample.csv) and [diagnostics.json](diagnostics.json).
Controlled single-node memory improvements do not replace this cohort's adverse
maximum-RSS observations. Later storage-only measurements remain separate.
