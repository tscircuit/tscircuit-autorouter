import { MultiHeadPolyLineIntraNodeSolver3 } from "../../solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import type { MultiHeadHistoryJob, MultiHeadHistoryResult, MultiHeadStepSnapshot } from "./parallelMultiHeadHistoryTypes"
import { restoreWorkerConnectivityMap } from "./restoreWorkerConnectivityMap"

function snapshotMultiHead(solver: MultiHeadPolyLineIntraNodeSolver3): MultiHeadStepSnapshot {
  return {
    iterations: solver.iterations, maxIterations: solver.MAX_ITERATIONS,
    solved: solver.solved, failed: solver.failed,
    error: solver.error, progress: solver.progress,
  }
}

/** These candidates own no cache and never send further worker requests. */
export function executeMultiHeadHistoryJob(job: MultiHeadHistoryJob): MultiHeadHistoryResult {
  const solver = new MultiHeadPolyLineIntraNodeSolver3({
    ...job.params, connMap: restoreWorkerConnectivityMap(job),
  })
  const initial = snapshotMultiHead(solver)
  const steps: MultiHeadStepSnapshot[] = []
  const cancellation = job.cancellationBuffer ? new Int32Array(job.cancellationBuffer) : undefined
  while (!solver.solved && !solver.failed) {
    if (cancellation && Atomics.load(cancellation, 0) !== 0) {
      return { kind: "multiHeadHistory", initial, steps, solvedRoutes: [], cancelled: true }
    }
    let exception: MultiHeadStepSnapshot["exception"]
    try {
      solver.step()
    } catch (error: unknown) {
      exception = error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: "Error", message: String(error) }
    }
    steps.push({ ...snapshotMultiHead(solver), ...(exception ? { exception } : {}) })
    if (exception) break
  }
  return { kind: "multiHeadHistory", initial, steps, solvedRoutes: solver.solvedRoutes }
}
