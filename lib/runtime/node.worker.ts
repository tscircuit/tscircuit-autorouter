import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import "tiny-hypergraph/lib/racing-tiny-hypergraph-solver"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import "../solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSampleSolver"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSampleSolver"

SolverRuntime.listen()
