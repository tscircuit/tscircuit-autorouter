import { SolverRuntime } from "@tscircuit/solver-utils"
import { WasmRouteTask, WasmRouteReadyTask } from "tiny-hypergraph/lib/core-parallel"

SolverRuntime.registerSolver(WasmRouteTask)
SolverRuntime.registerSolver(WasmRouteReadyTask)
