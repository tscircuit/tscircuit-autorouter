# Four experimental search policies

`policies.ts` installs a reversible, process-local policy around the existing
portfolio. It does not change the checked-in routing algorithms or dependencies.
Use one policy per process, construct/step the measured solvers after installation,
then call `restore()`. Nested installations throw. Solver errors are not caught.

```ts
const policy = installPolicy("bounded-growth")
try {
  solver.solve()
  // Save policy.metadata, policy.events, solver output and downstream DRC results.
} finally {
  policy.restore()
}
```

An optional `shouldApply(solver)` predicate scopes an experiment. When a portfolio
belongs to a grow/shrink solver, the predicate receives that grow/shrink solver;
otherwise it receives the portfolio. No node ID or sample ID appears in policy
logic. Without a predicate, every portfolio encountered during the run is eligible.

| Policy | Concrete change | What it tests | Main risk |
| --- | --- | --- | --- |
| `bounded-growth` | Stop an unsolved scale at 2,000,000 aggregate inner iterations. The last batch can exceed the threshold by at most 99 iterations. | Whether exhausting all candidates at a tight scale is wasted work. | A promising tight-scale candidate may be stopped before completing; the next scale can produce different copper after shrink-back. |
| `coarse-first` | Give the existing coarse-grid/high-via-penalty candidate up to 50,000 inner iterations before normal fitness scheduling. | Whether the known successful candidate is being unnecessarily delayed. | Other candidates wait, so this can slow nodes whose coarse candidate does not solve. It cannot avoid the total work needed to exhaust a failing scale. |
| `stagnation-growth` | At 64-step checkpoints, track the greatest committed connection count achieved by any candidate. After 1,000,000 aggregate inner iterations, stop a scale when 500,000 iterations pass without a new high-water mark. | Whether connection progress gives a better growth trigger than exhaustive failure. | A* can explore useful alternatives, or rip and rebuild routes, without increasing its completed count. Checks observe progress every approximately 6,400 inner steps. |
| `reduced-breadth` | Keep ordinary grid seeds 0–1, extra grid seeds 100–103, and A01 seeds 0–1. | Whether broad ordering diversity pays for its cost on this sample. | Pruned orderings can be the only ones that solve another node, or that solve at a smaller scale. |

Baseline uses the unchanged portfolio: 70 initial candidates and up to five extra
A01 orderings. Reduced breadth generates 26 initial candidates and at most one extra
A01 ordering. All solver families, cell-size choices, width, via diameter, margins,
original candidate budgets, and growth/shrink geometry are otherwise unchanged.

The budget and stagnation policies explicitly mark the current portfolio as failed
with an explanatory error. The existing grow/shrink search then advances its scale.
They never mark incomplete routes solved. Exhausting all scales still fails through
the existing failure path. Successful portfolio output still passes through the
existing `onSolve`, shrink-back and optional solution validator.

## Evidence and interpretation

Events record scale start/end, total inner work, completed connection count,
portfolio terminal state, and the reason for stopping. Scale event `solved` means
the portfolio completed; the enclosing solver may still reject it in its existing
solution validator. The event elapsed time is diagnostic instrumentation and
includes everything between portfolio creation and its final step. Benchmark the
outer measured operation separately, using the same instrumentation for every arm.

A01 and A03 completion counts use their committed `solvedConnectionsMap`, not their
provisional route array. Grid candidates use their completed `solvedRoutes`. A plateau
is a work heuristic, not proof that routing is impossible.

The experiment changes **search effort and ordering**, not clearance requirements.
Faster node completion does not establish board correctness: compare final route
geometry, full-sample completion, and downstream DRC errors. Growth scales coordinate
space but leaves copper widths unchanged; shrink-back can therefore change the work
left for downstream repair.

`policies.test.ts` contains one focused test using stub candidates to check exact
budget behavior, stagnation bookkeeping, coarse-candidate priority, pruning,
scope exclusion, and idempotent restoration. It does not time routing or run a
benchmark. Comparative benchmark runs belong on Blacksmith per repository policy.
