import { enableRegionCostWorker } from "tiny-hypergraph/lib/index"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import "../solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSampleSolver"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSampleSolver"

enableRegionCostWorker()
SolverRuntime.listen()
