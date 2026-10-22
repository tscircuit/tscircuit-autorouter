import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import "../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"

import "tiny-hypergraph/lib/TinyHyperGraphRouteSearchSolver"
import "tiny-hypergraph/lib/TinyHyperGraphIndependentRoutesSolver"

SolverRuntime.listen()
