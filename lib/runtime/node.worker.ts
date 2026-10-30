import "../solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortfolioSolver"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionWorker"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ParallelRegionalTaskSolver"
import "../solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphSpatialWarmStartSolver"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import "tiny-hypergraph/lib/prepared/RegionDistancePreparationSolver"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import "../solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSampleSolver"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSampleSolver"

SolverRuntime.listen()
