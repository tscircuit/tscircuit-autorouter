import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { WorkerHighDensityA01Solver } from "./high-density-a01-fork/WorkerHighDensityA01Solver"
import { WorkerHighDensityA03Solver } from "./high-density-a01-fork/WorkerHighDensityA03Solver"
import { PARALLEL_GRID_HISTORY_QUANTUM, type GridHistoryJob, type GridHistoryResult,
  type GridHistorySnapshot } from "./parallelGridHistoryTypes"

export type NativeGridHistorySolver = HighDensitySolverA01 | HighDensitySolverA03 | WorkerHighDensityA01Solver | WorkerHighDensityA03Solver

const nativeA01PrototypeDescriptors = Object.getOwnPropertyDescriptors(HighDensitySolverA01.prototype)
const nativeA03PrototypeDescriptors = Object.getOwnPropertyDescriptors(HighDensitySolverA03.prototype)

/** Custom A01 methods retain the original class and its callback sequence. */
function hasNativeA01WorkerMethods(): boolean {
  const currentDescriptors = Object.getOwnPropertyDescriptors(HighDensitySolverA01.prototype)
  const names = Object.keys(nativeA01PrototypeDescriptors)
  if (Object.keys(currentDescriptors).length !== names.length) return false
  for (const name of names) {
    const original = nativeA01PrototypeDescriptors[name]!
    const current = currentDescriptors[name]
    if (!current || current.value !== original.value || current.get !== original.get || current.set !== original.set) return false
  }
  return true
}

/** A native method override requires the original class, including its errors. */
function hasNativeA03WorkerMethods(): boolean {
  const currentDescriptors = Object.getOwnPropertyDescriptors(HighDensitySolverA03.prototype)
  const names = Object.keys(nativeA03PrototypeDescriptors)
  if (Object.keys(currentDescriptors).length !== names.length) return false
  for (const name of names) {
    const original = nativeA03PrototypeDescriptors[name]!
    const current = currentDescriptors[name]
    if (!current || current.value !== original.value || current.get !== original.get || current.set !== original.set) return false
  }
  return true
}

export function snapshotNativeGridHistory(solver: NativeGridHistorySolver): GridHistorySnapshot {
  let solvedSegmentCount = 0
  for (const routes of solver.solvedConnectionsMap.values()) solvedSegmentCount += routes.length
  return { iterations: solver.iterations, maxIterations: solver.MAX_ITERATIONS,
    solved: solver.solved, failed: solver.failed, error: solver.error,
    progress: solver.progress, solvedSegmentCount, stats: structuredClone(solver.stats) }
}

export function assertGridHistoryJob(job: GridHistoryJob): void {
  if (job.kind !== "gridHistory" || (job.algorithm !== "a01" && job.algorithm !== "a03") ||
    !Number.isSafeInteger(job.candidateId) || job.candidateId < 0 ||
    !Number.isSafeInteger(job.maxIterations) || job.maxIterations < 1 ||
    !Number.isSafeInteger(job.ownerIterations) || job.ownerIterations < 0 ||
    job.ownerIterations >= job.maxIterations || job.ownerIterations % PARALLEL_GRID_HISTORY_QUANTUM !== 0 ||
    !job.params || typeof job.params !== "object" ||
    ("initialPenaltyFn" in job.params && job.params.initialPenaltyFn !== undefined)) {
    throw new Error("Grid history requires native callback-free parameters and an exact candidate cap")
  }
  if (job.cancellationBuffer && job.cancellationBuffer.byteLength !== Int32Array.BYTES_PER_ELEMENT) {
    throw new Error("Grid history cancellation must contain one atomic flag")
  }
}

/** A01/A03 own no shared cache, clocks, random source or nested worker requests. */
export function executeGridHistoryJob(job: GridHistoryJob): GridHistoryResult {
  assertGridHistoryJob(job)
  const solver: NativeGridHistorySolver = job.algorithm === "a01"
    ? hasNativeA01WorkerMethods() ? new WorkerHighDensityA01Solver(job.params) : new HighDensitySolverA01(job.params)
    : hasNativeA03WorkerMethods()
      ? new WorkerHighDensityA03Solver(job.params) : new HighDensitySolverA03(job.params)
  solver.setup()
  if (job.maxIterations > solver.MAX_ITERATIONS) {
    throw new Error("Grid history cap exceeds the native candidate's setup limit")
  }
  solver.MAX_ITERATIONS = job.maxIterations
  const initial = snapshotNativeGridHistory(solver)
  const checkpoints: GridHistorySnapshot[] = []
  const cancellation = job.cancellationBuffer ? new Int32Array(job.cancellationBuffer) : undefined
  while (!solver.solved && !solver.failed) {
    if (cancellation && Atomics.load(cancellation, 0) !== 0) {
      return { kind: "gridHistory", algorithm: job.algorithm, initial, checkpoints,
        output: [], computedIterations: solver.iterations, cancelled: true }
    }
    let exception: GridHistorySnapshot["exception"]
    try { solver.step() }
    catch (error: unknown) {
      exception = error instanceof Error
        ? { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) }
        : { name: "Error", message: String(error) }
    }
    if (solver.iterations % PARALLEL_GRID_HISTORY_QUANTUM === 0 || solver.solved || solver.failed || exception) {
      checkpoints.push({ ...snapshotNativeGridHistory(solver), ...(exception ? { exception } : {}) })
    }
    if (exception) break
  }
  let output: GridHistoryResult["output"] = []
  let outputException: GridHistoryResult["outputException"]
  // The original portfolio calls getOutput only on a successful onSolve.
  // Failed/exception histories must not inspect a native partial route graph.
  if (solver.solved) {
    try { output = solver.getOutput() }
    catch (error: unknown) {
      outputException = error instanceof Error
        ? { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) }
        : { name: "Error", message: String(error) }
    }
  }
  return { kind: "gridHistory", algorithm: job.algorithm, initial, checkpoints,
    output, ...(outputException ? { outputException } : {}), computedIterations: solver.iterations }
}

export function assertGridHistoryResult(job: GridHistoryJob, history: GridHistoryResult): void {
  if (history.kind !== "gridHistory" || history.algorithm !== job.algorithm ||
    !Array.isArray(history.checkpoints) || !Array.isArray(history.output) ||
    !Number.isSafeInteger(history.computedIterations) || history.computedIterations < 0 || history.computedIterations > job.maxIterations ||
    (history.cancelled !== undefined && history.cancelled !== true)) {
    throw new Error("Malformed grid history result")
  }
  const snapshots = [history.initial, ...history.checkpoints]
  let previousIterations = -PARALLEL_GRID_HISTORY_QUANTUM
  for (const [index, snapshot] of snapshots.entries()) {
    if (!snapshot || !Number.isSafeInteger(snapshot.iterations) || snapshot.iterations < 0 ||
      snapshot.maxIterations !== job.maxIterations || !Number.isFinite(snapshot.progress) ||
      !Number.isSafeInteger(snapshot.solvedSegmentCount) || snapshot.solvedSegmentCount < 0 ||
      typeof snapshot.solved !== "boolean" || typeof snapshot.failed !== "boolean" ||
      (snapshot.solved && snapshot.failed) || (snapshot.error !== null && typeof snapshot.error !== "string") ||
      !snapshot.stats || typeof snapshot.stats !== "object" || Array.isArray(snapshot.stats) ||
      snapshot.iterations <= previousIterations ||
      snapshot.iterations - previousIterations > PARALLEL_GRID_HISTORY_QUANTUM ||
      (index === 0 && snapshot.iterations !== 0) ||
      (index > 0 && !snapshot.solved && !snapshot.failed && snapshot.iterations % PARALLEL_GRID_HISTORY_QUANTUM !== 0) ||
      ((snapshot.solved || snapshot.failed || snapshot.exception !== undefined) && index !== snapshots.length - 1) ||
      (snapshot.exception !== undefined && (!snapshot.exception || typeof snapshot.exception !== "object" ||
        !snapshot.failed || typeof snapshot.exception.name !== "string" ||
        typeof snapshot.exception.message !== "string" ||
        (snapshot.exception.stack !== undefined && typeof snapshot.exception.stack !== "string")))) {
      throw new Error(`Malformed grid history checkpoint ${index}`)
    }
    previousIterations = snapshot.iterations
  }
  const terminal = snapshots[snapshots.length - 1]!
  if ((!history.cancelled && (!terminal.solved && !terminal.failed)) ||
    (!terminal.solved && history.output.length !== 0) ||
    (history.outputException !== undefined && (!history.outputException || typeof history.outputException !== "object" ||
      !terminal.solved || history.output.length !== 0 ||
      typeof history.outputException.name !== "string" || typeof history.outputException.message !== "string" ||
      (history.outputException.stack !== undefined && typeof history.outputException.stack !== "string"))) ||
    (!history.cancelled && history.computedIterations !== terminal.iterations) ||
    (history.cancelled && (history.computedIterations < terminal.iterations ||
      history.computedIterations - terminal.iterations >= PARALLEL_GRID_HISTORY_QUANTUM || terminal.solved || terminal.failed))) {
    throw new Error("Grid history has no matching native terminal checkpoint")
  }
}
