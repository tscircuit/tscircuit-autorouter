# Upstream reconciliation ledger

Reference: `tscircuit/tscircuit-autorouter@109c67baebc709be95fb37df1fdac9b3b74624c5` (main when agreed).
Port merge base: `22587834e911b6ea52b5456b3a149f2001e7a86f`.

This ledger identifies upstream changes, not confirmed defects in the Rust port. Do not mix behavioral reconciliation into rename-only changes.

## Changes since the merge base

- `018f1fb2` / #2514: restores A13 routing performance while preserving DRC clearance. Adds A13 candidate wrappers, board geometry plumbing, and changes portfolio selection and regional DRC repair.
- `4af18519` / #2494: removes the 180-connection cutoff for the duplicate-congested-port prepass in TinyHypergraphPortPointPathingSolver.
- `629bb718` and `109c67ba`: release version changes.

The pinned reference is not behaviorally interchangeable with the port merge base. Before claiming full parity with main, audit these changes against the current port, including any already incorporated independently. The naming pass can proceed without changing these algorithms.

## Changed repository source paths

- `lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensitySolver.ts`
- `lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes.ts`
- `lib/autorouter-pipelines/AutoroutingPipeline9_Networked/solvePipeline9NetworkedHighDensityNode.ts`
- `lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts`
- `lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver.ts`
- `lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver.ts`
- `lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs.ts`
- `lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearanceProjection.ts`
- `lib/solvers/HighDensitySolver/HighDensitySolver.ts`
- `lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver.ts`
- `lib/solvers/HyperHighDensitySolver/HighDensitySolverA13WithBoundaryClearance.ts`
- `lib/solvers/HyperHighDensitySolver/HighDensitySolverA13WithDrcValidation.ts`
- `lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver.ts`
- `lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver.ts`
- `lib/testing/evaluate-relaxed-drc.ts`
- `lib/types/high-density-board-geometry.ts`

## Dependency references

Use the pinned autorouter package manifest as the authority for direct dependency selection:

| Source | Pinned-main selection | Existing port evidence / remaining work |
| --- | --- | --- |
| `tiny-hypergraph` | `c1043b3043ddf0c4d841fe5a6d9a515165960911` | Rust includes main and poly families; verify provenance per module. |
| `tiny-hypergraph-poly` | `7b93b4c` | Keep separate from the main package even though both packages share a repository. |
| `@tscircuit/high-density-a01` | `9a3a3d` | Port README and private adapter use version 0.0.36; verify whether its source matches this commit. Do not assume equivalence from version alone. |
| `@tscircuit/high-density-a13` | `c6812cebd44b09f29f2fee929837b313b822f2ae` | New in main since the port base; candidate coverage needs reconciliation. |
| `high-density-repair03` | `5f6c9af547dbb70c8948227011e1769b5dfa16a5` | Port README cites the same commit; local installed files include an integration patch and are not a pristine reference. |
| Transitive geometry, indexing, connectivity, hashing libraries | Resolve from the independent reference environment | Record actual resolved versions and source paths before declaring parity reproducible. |

The reference checkout at `/tmp/autorouter-reference-109c67b` has source only. Its dependencies have not been installed. The temporary path is not a durable project configuration; the commit above is the durable reference.
