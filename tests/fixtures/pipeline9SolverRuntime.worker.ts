import "../../lib/runtime/RoutingWorkerStartupSolver"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import { RegionDistancePreparationSolver } from "tiny-hypergraph/lib/prepared/RegionDistancePreparationSolver"
import "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import "../../lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSampleSolver"
import "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSampleSolver"

// Register with the host runtime even when the dependency uses its own version.
SolverRuntime.registerSolver(RegionDistancePreparationSolver)
SolverRuntime.listen()
