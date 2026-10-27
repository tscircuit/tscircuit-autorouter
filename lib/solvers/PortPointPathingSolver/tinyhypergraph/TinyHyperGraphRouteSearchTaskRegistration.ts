import { SolverRuntime } from "@tscircuit/solver-utils"
import { DistributedSearchTask } from "tiny-hypergraph/lib/core-parallel"

SolverRuntime.registerSolver(DistributedSearchTask)
