import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import type { ThreadedSolverRuntimeOptions } from "@tscircuit/solver-utils"
import workerSource from "./generated/nodeWorkerSource"

export type AutorouterSolverRuntimeOptions = Omit<
  ThreadedSolverRuntimeOptions,
  "workerSource" | "workerUrl"
>

/** The host owns this pool and reuses it across solves before disposing it. */
export function createAutorouterSolverRuntime(
  options: AutorouterSolverRuntimeOptions,
): SolverRuntime {
  return new SolverRuntime({
    ...options,
    workerSource,
  })
}
