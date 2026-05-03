# Wild Trace Jump Fix (Issue #743)

This fix was ported from the archived `tscircuit/autorouting` repository (issue #92).

## Context

The `MultilayerIjump` autorouter in the archived repo had a bug where trace segments
would "jump" wildly across the board. The fix was:

```ts
if (travelDir.wallDistance === Infinity) {
  // Only jump toward the goal if the goal is actually in this direction.
  if (isGoalInTravelDir && goalDistAlongTravelDir > 0) {
    travelDirs3.push({ ...travelDir, travelDistance: goalDistAlongTravelDir })
  }
}
```

## Fix Location

- Original fix: `tscircuit/autorouting` algos/multi-layer-ijump/MultilayerIjump.ts
- Fix branch: https://github.com/fancierbread7-ctrl/autorouting/tree/fix/remove-wild-trace-jumps

## Note

The `tscircuit-autorouter` (capacity-based) uses a different algorithm architecture
and does not have the same `wallDistance/travelDirs` pattern. If similar wild trace
issues appear in this repo, check the capacity pathing solver for unconstrained
goal-direction jumps.
