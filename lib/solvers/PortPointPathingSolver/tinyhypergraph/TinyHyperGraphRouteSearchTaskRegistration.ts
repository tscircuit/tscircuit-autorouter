import { SolverRuntime } from "@tscircuit/solver-utils"
import { DistributedSearchTask, DistributedSearchReadyTask } from "tiny-hypergraph/lib/core-parallel"

SolverRuntime.registerSolver(DistributedSearchTask)
SolverRuntime.registerSolver(DistributedSearchReadyTask)
