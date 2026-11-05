# Experiment: combine concrete routes across priority search contexts

The current priority-DAG policy preserves a path only when all its native
ancestor/cost contexts still match. That is appropriate for retaining an exact
native search result. It also discards useful geometric alternatives when a new
ordering changes a descendant's context. This experiment retains those paths as
**proposals** and asks whether one physically compatible path per task can be
selected before more native searches are needed.

This is a bounded local route-choice CSP shared by the priority families in one
`PortfolioSingleIntraNodeSolver`, rather than an additional total-order family.
It does not modify A01/A03/A13 or the B01 fixed-route branch. It selects physical
scale1 proposals only: grown native coordinates must not be compared to the
unscaled board obstacles or outline. The existing DAG handles growth unchanged.
Initial ordinary
Pipeline 9 high-density routing enables the existing priority policy, so the
experiment is active there without an external hook. Existing non-priority
callers are unaffected. `enableWitnessCompatibility: false` on the portfolio
disables the experiment for a local ablation.

## Implementation

- Keep up to six immutable, exact geometric witnesses per native star task.
  Keep the initial independent path and the five most recent alternatives.
  Exact coordinate signatures include per-vertex fields and via positions;
  route identity, widths and ownership are checked separately. There is no
  coordinate rounding or net-name substitution. This is geometric
  diversity, not a formal homotopy classifier.
- Existing conflict-driven native searches supply alternatives only when their
  contexts require them. A shared catalog survives changes of priority state
  and family hyperparameters; it does not cross a portfolio/growth scale.
- Cache exact pair compatibility by immutable witness identity. Check copper
  width/clearance, full layer-dependent via barrels and owner-independent drill
  spacing. Same-net copper sharing cannot hide two distinct overlapping holes.
  Weak cache keys let evicted witness histories be collected.
- Choose one witness per task using deterministic MRV backtracking with at most
  `min(20000, max(512, 16 * taskCount²))` domain visits per catalog revision.
  A learned pair exclusion names only those two concrete paths. Catalog failure
  or a visit cap is UNKNOWN about physical routing; the existing native policy
  continues generating alternatives under its existing explicit allowance.
- Skip the CSP when the catalog merely contains one complete ordinary context.
  This avoids paying a second validation pass on easy native winners.
  Incomplete catalogs and unchanged revisions also cost only a fast check.
- Independently validate a selected combination against **all** other selected
  copper using the native physical checker, internal drill spacing, the board
  outline when supplied, and board/fixed obstacles using the existing circuit
  DRC plus exact generic/rotated-obstacle checker. No unselected path is treated
  as real copper. No outside task is dropped from the final context.
- Reject an invalid complete assignment as a combination no-good. It is never
  marked solved, and at most one final-check attempt occurs per new witness so
  invalid combinations cannot starve native generation. Only explicit search
  budget exceptions are converted to UNKNOWN; invariant exceptions propagate.

This deliberately permits a path from a changed cost context to be reused after
physical validation. It is not an exact memoization of what the native heuristic
would have returned in that context, and it changes search/budget policy.
Catalog setup, signature/copy work, domain visits, pair geometry and final
validation receive charges within the existing removed-native-family allowance.
Cache hits can make more useful work fit that allowance. The old work unit is
not a calibrated CPU clock, so whole-board elapsed time remains decisive.

## Measurements and falsification

Root's benchmark compares this branch with the unchanged control on all sixteen
dataset18 and twenty-six dataset24 samples, Pipeline 9, effort 1, one routing
thread/sample, fresh processes and the same per-sample timeout. Inspect both
initial-HD stage performance and complete-board completion, relaxed DRC, vias,
wire length, memory and later repair. A later or upstream solver failure does
not invalidate a measured route-choice gain; it limits its end-to-end value.
The full benchmark report is added separately after those runs.

All counters below aggregate into Pipeline 9's existing
`benchmarkDiagnosticCounters` through `priorityDiagnostics`, including retired
nodes, without enabling detailed per-operation priority instrumentation:

- `witnessCatalogInstances`, `witnessCatalogPaths`,
  `witnessCatalogStoredVertices`, `witnessCatalogDuplicatePaths`,
  `witnessCatalogEvictions`.
- `witnessCompatibilityPairQueries`, `witnessCompatibilityPairEvaluations`,
  `witnessCompatibilityPairCacheHits`,
  `witnessCompatibilityLearnedPairExclusions`.
- `witnessCompatibilitySelections`, `witnessCompatibilitySelectionVisits`,
  `witnessCompatibilitySelectionMicroseconds`,
  `witnessCompatibilitySelectionCaps`,
  `witnessCompatibilityPoolExhaustions`, `witnessCompatibilityAssignments`.
- `witnessCompatibilityAcceptedAssignments` and separately
  `witnessCompatibilityCrossContextAssignments`, followed by
  `witnessCompatibilityRejectedAssignments` and board-validation issue/time
  counters. An accepted assignment need not become the portfolio winner;
  other families are still scheduled by the existing supervisor.

The focused crossing fixture demonstrates one accepted mixed-context
assignment with zero independent board-check issues. A second generator can use
the same catalog without redoing the original native searches. The adversarial
catalog fixture combines paths from two individually incompatible contexts;
it requires backtracking instead of merely accepting the newest paths. Other
tests cover through-via intermediate copper, same-owner drill conflicts,
unchanged fixed obstacles, explicit caps, output isolation and the easy-case
gate. These tests establish mechanics and constraints, not dataset speedup.

```sh
source /workspace/.tools/autorouter-env.sh
bun test tests/solvers/witness-compatibility-*.test.ts \
  tests/solvers/priority-dag-*.test.ts --timeout 9999999
./benchmark.sh --pipeline 9 --dataset 18 --effort 1 --threads 1 --concurrency 2
./benchmark.sh --pipeline 9 --dataset 24 --effort 1 --threads 1 --concurrency 2
```

## Risks and limits

The measured hard grown-node graphs can contain fourteen or seventeen connected
nets. There is no assumption of small independent conflict cores here; the
master handles the whole bounded local task set, and its search can cap out.
Six witnesses can miss the necessary route, and native alternative generation
can dominate any saved combinations. The native branch was a small CPU share
in one measured dataset18 circuit, so a correct route-choice mechanism can
still have a low wall-time ceiling. Exact signatures, catalog copies and
validation can cost more than avoided search; the counters make this visible.

Grown attempts do not use the compatibility catalog or board acceptance, and
inverse growth can still create physical conflicts. This experiment does not implement the
separate physical-legalization proposal, and final board DRC remains required.
It never interprets pool exhaustion as a proof that the PCB is unroutable.

The session lifetime is one portfolio over one immutable physical node,
allowed-layer set, obstacle list and board outline. It must not be reused after
caller edits or across nodes/growth attempts. `contextKey` checks task identity,
ownership and pair rules; it does not fingerprint bounds, allowed layers, fixed
obstacles or the outline. Final-check combination no-goods depend on that full
scene. Current integration creates the session as a private per-portfolio field,
so it cannot transfer those exclusions to another scene. The catalog accepts
the native Single solver's ordinary wire/via paths; jumper routes and nested
through-obstacle metadata are outside its supported input slice.
