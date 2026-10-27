import { SolverRuntime } from "@tscircuit/solver-utils"
import { RouteSearchTask, RouteSearchReadyTask } from "tiny-hypergraph/lib/core-parallel"

SolverRuntime.registerSolver(RouteSearchTask)
SolverRuntime.registerSolver(RouteSearchReadyTask)
