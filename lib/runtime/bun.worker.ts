import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import "../solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSampleSolver"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSampleSolver"

import "high-density-repair02/lib/high-density-repair-solver/functions/repairNodeClearanceAsync"

SolverRuntime.listen()
