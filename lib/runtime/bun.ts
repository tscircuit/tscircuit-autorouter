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
): SolverRuntime & { readonly workerCount: number } {
  return Object.assign(new SolverRuntime({
    ...options,
    workerSource,
  }), { workerCount: options.workerCount })
}
