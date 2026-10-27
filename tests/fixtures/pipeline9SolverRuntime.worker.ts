import { enableRegionCostWorker } from "tiny-hypergraph/lib/index"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import "../../lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSampleSolver"
import "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSampleSolver"

enableRegionCostWorker()
SolverRuntime.listen()
