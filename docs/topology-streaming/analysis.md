Topology merging currently retains every artificial X/Y subdivision before
compacting. The striped reproduction has 320 source nodes and 960 final nodes,
but retains 51,840 intermediate regions. The fix retains 960, preserving the
exact final output SHA-256:
`be7c59ab60fa192e311bf848cb37780b98dfb5d6b44962fe6a312544062a555a`.

The fix joins matching horizontal regions as slabs arrive using the existing
merge key and tolerance. Stable spatial-index queries preserve original node
order and apply the original containment predicates. The logical atomic-region
statistic is unchanged. Fifteen topology regressions pass locally.

The full visual uses the failing 160-row input. A 16-row view makes individual
component regions visible; orange marks component topology. Both are native
completed solver output with labels omitted for legibility.

Only generated synthetic rectangles are included in this PR. The captured
board-derived topology input remains local and is not published here.

A related local all-fixed experiment exhausted memory before this change.
The current larger local experiment reached its 600-second diagnostic budget
without completing; no pinned board-size speedup is claimed. The paired
Blacksmith workflow runs 160-row and 640-row synthetic cases with identical
budgets, records exact output hashes and retained-region counts, and runs the
complete public canonical routing dataset separately. Hosted results must be
reported before merging. No merges are performed by this workflow.
