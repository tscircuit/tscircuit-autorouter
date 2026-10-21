import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"

/** Unit tests use a source entrypoint; packed-consumer checks exercise embedded workers. */
export function createPipeline9TestRuntime(workerCount: number): SolverRuntime {
  return new SolverRuntime({
    workerCount,
    workerUrl: new URL("./pipeline9SolverRuntime.worker.ts", import.meta.url),
    requireWorker: true,
  })
}
