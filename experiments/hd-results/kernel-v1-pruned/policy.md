# Archived kernel v1: pruned frontier

This report measures `dde0df8db1a5bf30ec080d61de71309e2ceffd32` against baseline
`637b6c581128238f6c61227a1c15be423d24baca`. Normal compact A01 candidates used
contextual queue pruning on the original `S < 2^21` capacity domain. Larger
scenes selected original A01. This is historical experimental policy, not the
final all-storage default.

The strict renderer validated all 42 paired samples, both exact refs, resource
evidence and arithmetic before producing [results.md](results.md),
[per-sample.csv](per-sample.csv) and [diagnostics.json](diagnostics.json).
These one-pass results remain separate from later hybrid and storage-only runs.
