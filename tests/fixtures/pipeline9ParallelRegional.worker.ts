import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ParallelRegionalTaskSolver"
import "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionWorker"

SolverRuntime.listen()
