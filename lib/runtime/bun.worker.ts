import "./RoutingWorkerStartupSolver"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import { RegionDistancePreparationSolver } from "tiny-hypergraph/lib/prepared/RegionDistancePreparationSolver"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import "../solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSampleSolver"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSampleSolver"

// Register with the host runtime even when the dependency uses its own version.
SolverRuntime.registerSolver(RegionDistancePreparationSolver)
SolverRuntime.listen()
