# A64 DDR memory comparison

Raw reports, fixture hashes, source blob IDs and commands are recorded in
`a64-ddr-memory-comparison.json`. Measurements use Bun 1.4.3, separate processes
on the same machine, sequentially, without forced garbage collection.

| Workload | Baseline peak RSS | Fixed peak RSS | Local copper |
| --- | --- | --- | --- |
| 100,000 high-density steps, median of three runs | 743.4 MiB | 649.8 MiB | Identical |
| 2,284,662 full-pipeline steps, one run per revision | 4.685 GiB | 3.562 GiB | Identical |

Every run stops at its step budget with 79 local routes, the same high-density
statistics, and route SHA-256
`2aa31df365c4b80f8a143e4f65183c10864fce36916a95a63f0bb43d1c61fff6`.
The three short runs alternate baseline and fixed revisions; the full-prefix
baseline runs before the fixed revision. Runtime medians for the short runs
are 7.775 s and 7.785 s, so these observations do not establish a speedup.
RSS includes allocator and garbage-collection variability; the full-prefix
figures are a single pair, not a distribution or a complete-board result.

At the high-density checkpoint the baseline retains 225 portfolio candidates,
two retired growth portfolios, 152 failed route searches and 628,114 debug
exploration points. The fixed revision retains 75 active candidates and none
of those retired portfolios, failed route histories or debug points.
Completed topology merging retains 515,892 atomic regions in the baseline and
zero after the fix, while preserving its exact final output.

These changes fix the demonstrated retention paths. A separate full-board run
still crossed the conservative 4 GiB stopping threshold after advancing two
more outer steps. Full DDR completion and all remaining large-board memory
use are not established by this comparison.
