import "tiny-hypergraph/lib/parallel-selective-rerip-tiny-hypergraph-solver"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import "../../lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSampleSolver"
import "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSampleSolver"

SolverRuntime.listen()
