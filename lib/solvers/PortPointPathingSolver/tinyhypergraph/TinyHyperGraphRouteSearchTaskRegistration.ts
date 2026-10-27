import { SolverRuntime } from "@tscircuit/solver-utils"
import { WasmRouteTask, WasmRouteReadyTask } from "tiny-hypergraph/lib/parallel/WasmRouteTask"

SolverRuntime.registerSolver(WasmRouteTask)
SolverRuntime.registerSolver(WasmRouteReadyTask)
