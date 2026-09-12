# TypeScript migration inventory

Read-only source audit, 2026-09-11. Pipeline9/SRJ18 is the primary execution path
considered below; other exported pipelines and public classes are called out.
No implementations were changed or removed by this audit.

This snapshot precedes the Uniform and standalone repair03 completion work.
See [module completion](module-completion.md) for those subsequent changes;
the line counts below remain the original audit measurements.

The `rust-experiment` cleanup also removed ten of the twelve helper candidates
listed below (1,170 lines), after removing unused facade imports. The retained
`calculateSideTraversal.ts` is used by a boundary-tolerance test, and
`calculate45DegreePaths.ts` is used by a legacy debugger fixture. See the
[current overview](README.md) for scope and validation.

Counts are physical source lines including blanks, comments, type declarations,
and diagnostics. They are not executable-line coverage, CPU percentages, or
bundle sizes. Installed dependency source is counted separately from repository
source, so the category totals must not be added together.

## Still used

After erasing type-only/unused imports in memory, the Pipeline9 entry point has
a runtime import closure of **242 handwritten TS/TSX modules, 45,594 lines**.
This is a module-level upper bound: a reachable file can contain conditional,
diagnostic, or unused methods. Generated bindings/payloads, declaration files,
and node_modules source are excluded. All exports from lib/index.ts expand this
to **359 modules, 87,708 lines**. The complete lib tree contains 109,387
handwritten TS/TSX lines, including debugger UI and other pipelines.

| Active TS responsibility | Examples |
| --- | --- |
| Pipeline orchestration and routing preparation | preprocessing, components, escape vias, topology planning/merging, mesh edges, net pairs, port generation, preloaded trace graph |
| Tiny integration | the 1,710-line TinyHypergraphPortPointPathingSolver prepares graph/preloaded state and integrates native search output |
| High-density integration and remaining candidates | Pipeline9HighDensitySolver, B01, regional orchestration; main A01/A03/general/specialized engines run in Rust |
| Repair outside the native main portfolio | repair01, repair02, repair04 projection/regional passes, clearance precision, terminal escapes and the original repair03 safe-layer branch |
| Other postprocessing | stitching, trace width, actual length matching, power-trace expansion |
| Partial ports | UniformPortDistribution constructor/grouping is native; redistribution/step remains TS. Length matching's obstacle-ID expansion is native; the length solver remains TS. |
| Interface and observability | TS classes, object/Map identity, mutable input tracking, cache providers, callbacks, diagnostics and graphics |

Dedicated non-generated lib/bindings support is **3,415 lines in 25 files**.
Public high-density and trace-simplification files separately retain 3,583 lines
of facade/cache/lifecycle/diagnostic code after replacement. Both sets are
already included in the repository/module-closure counts, not additions to them.
The private binding-package ts directories contain another 639 lines in total;
only 422 of those lie in the Pipeline9 runtime import closure.

Some native adapters intentionally use original TS classes for constructors,
public diagnostic objects, and snapshot/evaluator methods. For example,
GlobalDrcForceImproveSolver subclasses the dependency class and calls its
snapshot methods while replacing the main search step.

## Retained but bypassed by the native paths

| Retained source | Approximate amount | Scope |
| --- | ---: | --- |
| Installed tiny-hypergraph source corresponding to mapped Rust files |15,194 lines /39 files|No current repository production runtime import of the original main package; source remains installed. Includes variants/helpers, not just the SRJ18 core.|
| Installed A01/A03 and their mapped helpers |4,125 lines /6 files|Original package remains installed and used by the binding parity test; production uses Rust. Other unported files in that package are excluded from this count.|
| Old standalone repository geometry/via helpers |1,618 lines /12 files|Outside both Pipeline9 and lib/index.ts runtime import closures; bounded cleanup-candidate list below. Deep-import/debug/test compatibility is a separate concern.|
| Original repair03 main step and portfolio class |about 1,020 +618 lines|Bypassed by the native main Pipeline9 portfolio, but still available/used via other callers; not globally dead.|
| Two old private broad-pass bodies in patched solverHelpers |about 146 lines|No remaining callers in that mixed helper file. The rest of the file is not all dead.|
| Original continuity checker |401 lines; about 1,100 with its relevant helper closure|getDrcErrors now uses the Rust adapter. Shared package geometry/connectivity helpers still have other consumers.|
| Original length-matching obstacle alias loop |about 30-line source closure|Main app supplies the native callback; dependency default remains for other callers. Rest of length matching is active.|

The installed package source counts do not mean those TS sources ship as a
second runtime backend. Likewise, a TS helper with a Rust counterpart may still
serve another stage or diagnostic object and cannot be assumed unused.

The 12 repository candidates are:

- lib/utils/calculatePointsAtDistance.ts
- lib/utils/findClosestPointToABCWithinBounds.ts
- lib/utils/findPointToGetAroundCircle.ts
- lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/findCircleLineIntersections.ts
- lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/calculateDumbbellPoints.ts
- lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/computeTurnDirection.ts
- lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/calculateSideTraversal.ts
- lib/utils/calculate45DegreePaths.ts
- lib/solvers/UselessViaRemovalSolver/break-route-into-sections.ts
- lib/solvers/UselessViaRemovalSolver/can-endpoint-connect-on-layer.ts
- lib/solvers/UselessViaRemovalSolver/can-section-move-to-layer.ts
- lib/solvers/UselessViaRemovalSolver/create-obstacle-detour-path-validator.ts

Examples that are retained **and still useful** include computeDumbbellPaths
(debugger), HighDensityRouteSpatialIndex (trace width and diagnostics),
SegmentTree (public diagnostic object reconstruction), and shared geometry and
ConnectivityMap mutation methods.

## Removed implementations, replaced with Rust

The large removals mostly happened inside the original TS file paths. Keeping
the public class file does not keep its old algorithm.

| Family | Original TS | Current TS | Net reduction |
| --- | ---: | ---: | ---: |
| High-density/general/specialized/orchestration,16 files |8,705|2,337|6,368|
| Trace simplification/via reduction/merging,9 files |5,282|1,246|4,036|
| Combined |13,987|3,583|10,404|

Counts compare the frozen TypeScript checkout with the current files. The
remaining TS is not a duplicate of the removed routing kernels: it supplies
public interfaces, wrappers, cache handling, lifecycle and diagnostics. These
are file-size/net-reduction counts, not a count of pure algorithm statements.
Separate binding support is reported above, so this is not the total repository
net shrinkage.

Examples: MultiHeadPolyLineIntraNodeSolver went from 1,371 to 54 lines;
CrossingViaReductionSolver from 1,430 to 93; SingleSimplifiedPathSolver5_Deg45
from 1,023 to 116; ViaPossibilitiesSolver2 from 462 to 61.

Only 14 frozen lib paths are wholly absent, totaling 1,176 original lines. Most
are relocated/renamed Rust adapters or removed backend switches, plus the
36-line stable-assignment Tiny subclass. Those missing-path numbers are not
1,176 lines of independently deleted routing algorithms.

## Remaining integration distinctions

- lib/index.ts:89 still re-exports the original repair03 GlobalDrcForceImproveSolver
  and GlobalDrcBranchPortfolioSolver classes.
- applyPipeline9RegionalB01Repairs.ts:806 constructs the original TS repair03
  GlobalDrcForceImproveSolver for safe-layer repair. The main native portfolio
  does not make this branch native automatically.
- Pipeline6 still imports and executes tiny-hypergraph-poly. The presence of
  poly-related Rust source does not mean every exported poly pipeline is wired
  to it.

Consequently, 'ported for the main Pipeline9 path' and 'no TS implementation
can execute anywhere in the package' are different states in this workspace.

## Audit artifacts

Detailed manifests/scripts are in /private/tmp/rust-migration/ts-inventory/:
import-graph.json, import-graph.mjs, active-pipeline9.md,
retained-but-bypassed.md, replaced-facades.md and replaced-facades.json.
The source-map JSON was used as a candidate index, then supplemented with
current imports and newer ports; its filename matches alone are not proof of
behavioral equivalence.
