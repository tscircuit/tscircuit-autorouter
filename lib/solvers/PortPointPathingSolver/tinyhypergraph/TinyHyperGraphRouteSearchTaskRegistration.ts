import { SolverRuntime } from "@tscircuit/solver-utils"
import { RegionCostTask, RegionCostReadyTask } from "tiny-hypergraph/lib/core-parallel"

SolverRuntime.registerSolver(RegionCostTask)
SolverRuntime.registerSolver(RegionCostReadyTask)
