import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import "tiny-hypergraph/lib/prepared/RegionDistancePreparationSolver"
import "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InitialDrcSolver"
import "../../lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSampleSolver"
import "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSampleSolver"

SolverRuntime.listen()
