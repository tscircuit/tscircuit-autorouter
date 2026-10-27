import { startSamplingProfiler } from "bun:jsc"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import "../solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSampleSolver"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSampleSolver"

import "../solvers/PortPointPathingSolver/tinyhypergraph/TinyHyperGraphRouteSearchTaskRegistration"

if (process.env.PROFILE_PORT_SEARCH === "1") startSamplingProfiler("worker-profiles", 1000)

SolverRuntime.listen()
