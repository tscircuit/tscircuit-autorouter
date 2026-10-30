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
): SolverRuntime {
  const runtime = new SolverRuntime({
    ...options,
    workerSource,
  })
  // Compatibility with solver-utils 0.0.23; remove after upstream #53 releases.
  // https://github.com/tscircuit/solver-utils/pull/53
  if (!("workerCount" in runtime)) {
    Object.defineProperty(runtime, "workerCount", {
      value: options.workerCount,
    })
  }
  return runtime
}
