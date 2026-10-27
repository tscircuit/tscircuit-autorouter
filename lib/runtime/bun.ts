import { SolverRuntime } from "@tscircuit/solver-utils/runtime/bun"
import type { ThreadedSolverRuntimeOptions } from "@tscircuit/solver-utils"
import workerSource from "./generated/bunWorkerSource"

export type AutorouterSolverRuntimeOptions = Omit<
  ThreadedSolverRuntimeOptions,
  "workerSource" | "workerUrl"
>

/** The host owns this pool and reuses it across solves before disposing it. */
export function createAutorouterSolverRuntime(
  options: AutorouterSolverRuntimeOptions,
): SolverRuntime & { persistentWorkerCount?: number } {
  const runtime = new SolverRuntime({
    ...options,
    workerSource,
  })
  return Object.assign(runtime, { persistentWorkerCount: options.requireWorker === true ? options.workerCount : undefined })
}
