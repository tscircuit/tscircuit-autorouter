import "tiny-hypergraph/lib/DuplicateCongestedPortSolver"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import "tiny-hypergraph/lib/prepared/RegionDistancePreparationSolver"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import "../solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSampleSolver"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSampleSolver"

import "../solvers/PortPointPathingSolver/tinyhypergraph/TinyHyperGraphRouteSearchTaskRegistration"

SolverRuntime.listen()
