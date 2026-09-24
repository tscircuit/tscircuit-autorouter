# MST data-flow validation

Audited revision: `eb7e607ee793985a65994a768e5f1edb84d97d5b`.
Scope: `buildMinimumSpanningTree` and its use by `NetToPointPairsSolver`.
The findings below describe the original revision. The fix replaces the sparse
KD-tree/Kruskal path with exact dense Prim, preserving terminal identity by input
reference and validating extra-edge provenance. It runs in O(n² + e) time and
O(n + e) auxiliary space for n terminals and e extra edges. This trades away the
sparse candidate heuristic's speed on large nets to guarantee complete candidate
coverage. No performance benchmark has been run.

Distinct coincident terminals remain distinct vertices. Repeated references to
the same input object are rejected as ambiguous, and extra-edge endpoints must
refer to input objects. Output endpoints preserve the original objects and
metadata; caller arrays and points are not mutated. Non-finite coordinates,
weights, and computed distances fail explicitly. Initial-connectivity edges
remain available as undirected candidates with their supplied weights.

## Confirmed findings

1. **P1 — terminal identity is lost at the MST boundary.**
   `buildMinimumSpanningTree.ts:192` keys union-find solely by coordinates;
   line 279 also treats equal coordinates as self-edges. Upstream `getPointKey`
   preserves point IDs or layers, so the MST uses a weaker identity than its
   caller. With terminals `a=(0,0,top)`, `b=(0,0,bottom)`, `c=(1,0,top)`
   and no initial electrical connections, the solver emits only one edge.
   Only two of three terminals are reachable, yet it reports solved.
   A zero-weight edge between distinct terminals must not be discarded merely
   because its geometric length is zero. Preserve terminal identity; only an
   explicit initial-connectivity witness may justify contracting terminals.

2. **P1 — incomplete candidate data silently becomes a successful forest.**
   `buildMinimumSpanningTree.ts:272` fixes the neighbor count at 10.
   Eleven points at x=0..10 and eleven at x=1011..1021, all y=0, produce
   no cross-cluster candidate. The function returns 20 edges instead of 21
   at line 317, without a spanning check. `NetToPointPairsSolver.ts:76`
   eventually reports solved because its input queue is empty, although only
   11 of 22 terminals are reachable from the first terminal.
   This issue remains even with a correct nearest-neighbor search: fixed-k
   nearest-neighbor graphs are not guaranteed connected. Use a candidate
   construction with a spanning/minimality guarantee and reject incomplete
   output explicitly; an edge-count check alone would detect failure but
   would not repair candidate generation.

3. **P2 — KD-tree construction and traversal disagree on the split axis.**
   Construction uses x at even depths (line 23), while k-neighbor traversal
   uses y at even depths (line 133). Pruning against the wrong coordinate can
   discard closer candidates. A deterministic 64-point fixture, seed 1,
   produces a connected tree of weight 6672.322523444581, versus
   5316.590426306168 from independent complete-graph Prim: about 25.5% excess.
   A temporary source copy with both search-axis expressions changed to match
   construction produced 5316.5904263061675 on that fixture. This experiment
   isolates the axis error for this fixture; it does not establish correctness
   of the fixed-k approach in general. Match traversal axes to construction.

## Formal proofs and their limits

`MstDataFlow.lean` is checked with Lean 4.34.0 and only imports `Std`.
It contains no `sorry`, user axioms, or `native_decide`.

- `reach_preserves_cut`: a path cannot cross a partition that every edge preserves.
- `selected_edges_cannot_repair_cut`: selecting a subset of such candidates
  cannot repair missing connectivity, independently of the selection algorithm.
- `coordinate_key_loses_terminal_identity` and
  `coordinate_connectivity_cannot_reflect_identity`: coordinate projection
  identifies distinct terminals with different IDs and layers.
- `separated_clusters_are_unreachable`: an explicit 22-terminal instance of the
  cut obstruction. The TypeScript audit separately checks that actual output
  stays inside this partition.
- `replace_edges_with_witnessed_paths`: replacing every removed edge with an
  explicit path preserves reachability. This is a sufficient contract for
  dropping initially connected edges, not a proof of the connectivity-map code.

The proofs model graph paths and exact integer-coordinate projection. They do
not execute or formally refine the TypeScript implementation. JavaScript number
formatting, floating-point distances, KD-tree implementation, union-find
implementation, minimum-weight optimality, and the full pipeline are not
formally verified. Runtime counterexamples connect the modeled failures to
actual solver behavior. Lean reports only the standard `propext` axiom for the
concrete cluster proof; the other printed theorem dependencies are empty.

## Reproduction

From the repository root:

```sh
bun validation/mst/reproduce.ts
bun test tests/solvers/net-to-point-pairs-root.test.ts tests/solvers/net-to-point-pairs-explicit-initial-connectivity.test.ts --timeout 9999999
```

The audit now asserts that the original counterexamples are fixed. It checks
input immutability and uses an independent ID-based reachability walk.
`baseline-results.txt` preserves the original failure observations; `results.txt`
records the fixed output. The new `tests/solvers/mst-*.test.ts` regressions also
use a complete-graph Kruskal oracle independent of the production Prim algorithm.
The Lean proofs explain the original obstructions and edge-replacement contract;
they do not constitute a full proof of the new Prim implementation.

With Lean installed, run from this directory (the adjacent `lean-toolchain`
pins the compiler):

```sh
lean MstDataFlow.lean
```

For this audit Lean was installed under `/tmp/mst-elan`, without changing shell
profiles, using the [official elan installer](https://lean-lang.org/install/manual/).
The exact verification command from this directory was:

```sh
ELAN_HOME=/tmp/mst-elan /tmp/mst-elan/bin/lean MstDataFlow.lean
```

The temporary installation is not required for subsequent runs; any elan
installation honoring `lean-toolchain` is sufficient.

## Fix validation

- Focused MST, point-pair, and merge-root tests: 10 passed across 9 files (179 assertions).
- Isolated strict TypeScript check of `buildMinimumSpanningTree.ts`: passed.
- `bun validation/mst/reproduce.ts`: passed; both disconnected examples now
  span all terminals and the 64-point case matches the reference weight.
- Lean 4.34.0: all proofs checked successfully.
- `bun run build`: blocked by unresolved local dependencies including
  `@tscircuit/trace-simplification-solver`, `@tscircuit/repair04`, and
  `@tscircuit/high-density-a13`, plus type errors in
  `PortfolioSingleIntraNodeSolver.ts`. Full build and full-suite validation
  are covered separately by GitHub CI on the PR.

Prim uses a stable coordinate orientation and weight ordering to retain the
previous downstream routing convention. Exact candidate coverage and terminal
identity can still change the selected tree. Fifteen snapshots that failed on
Linux CI were refreshed; passing snapshots were left unchanged.

CI exposed downstream data-flow problems now covered by focused regressions:
coincident stitch targets retain their layer identity; borrowed same-net branches
must be eligible for the requested terminal pair; through-hole via matching
accepts inner-layer route transitions inside the drill span; and an accepted
reference-clean repair resets the final DRC error count. Pipeline9 now materializes
same-layer coincident point pairs as direct zero-length paths, preserving both
terminal IDs through SRJ export instead of sending them through congestion
routing. Cross-layer coincident terminals still require routing. The SRJ18 integration
tests now check the valid routing/repair result without depending on the old MST
edge numbering or topology. The deterministic direct legal-layer retry test
continues to require an actual retry.

Linux validation includes the previously failing SRJ18 samples 2, 8, and 9, the
Game Boy board, DRC identity checks, and the affected snapshot tests. GitHub CI
build, formatting, and type checks have passed. Complete CI status is recorded
on [PR #2717](https://github.com/tscircuit/tscircuit-autorouter/pull/2717).
