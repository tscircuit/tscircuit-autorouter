import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import "../solvers/PortPointPathingSolver/tinyhypergraph/snapshot/SnapshotRouteBatchSolver"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import "../solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSampleSolver"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSampleSolver"

SolverRuntime.listen()
