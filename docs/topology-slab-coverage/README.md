# Repeated coverage work during topology merging

The AM3352 support phase reaches a dense fixed-copper mesh after accepting all
46 DDR signals. Its next setup stage spends minutes merging overlapping
component and global topology. This reproduction reuses the generated striped
fixture: it contains no captured board data.

Every artificial X/Y cell currently re-queries the full rectangle index and
recomputes layer topology even when its covering source nodes are unchanged.
The regression bounds point-coverage queries by X slab count while preserving
the same completed native mesh and input. The stacked fix sweeps Y coverage and
reuses topology from adjacent slabs, without changing geometry or routing rules.
