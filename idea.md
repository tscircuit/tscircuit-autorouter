# Dataset 01 topology-merging recovery ideas

## Preserve input-group target topology

- State: `in-progress`
- Hypothesis: Refine topology only where distinct topology groups interact, so
  RectDiff's intentional overlapping target regions remain connected exactly as
  they were before component topology merging.
- Risk: Shared-layer overlaps remain inside a source group, so the output
  invariant must distinguish pre-existing intra-group topology from newly
  introduced cross-group overlaps.

## Target-union semantics

- State: `tobedone`
- Hypothesis: Union adjacent atomic target-obstacle cells belonging to the same
  electrical target before Tiny filtering, ensuring the selected endpoint cell
  reaches the union boundary.
- Risk: Global RectDiff nodes currently do not consistently carry a target
  connection name, so net identity must be derived without guessing.

## Regression coverage

- State: `tobedone`
- Hypothesis: Add a focused overlap test where the connection point lies inside
  two same-layer target obstacles, plus dataset01 `circuit100` and no-component
  `circuit119` Pipeline 7 regressions.
- Risk: Full-route tests are slower than topology/graph invariant tests.
