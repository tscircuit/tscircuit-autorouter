import type { HighDensityIntraNodeRoute } from "../../types/high-density-types"
import { assertGridHistoryResult, snapshotNativeGridHistory, type NativeGridHistorySolver } from "./executeGridHistoryJob"
import { PARALLEL_GRID_HISTORY_QUANTUM, type GridHistoryJob, type GridHistoryResult,
  type GridHistorySnapshot } from "./parallelGridHistoryTypes"

type SettledGridHistory = { kind: "history"; history: GridHistoryResult } | { kind: "error"; error: unknown }

function equalGridSnapshotValues(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (typeof left !== "object" || !left || typeof right !== "object" || !right) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => Object.hasOwn(right, key) && equalGridSnapshotValues(
    (left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key],
  ))
}

/**
 * Only the original supervisor's 100-step observation boundary is public to
 * ordered worker routing. Native grid arrays and partial getOutput geometry are
 * never read by that coordinator; their exact solved-segment count is observed
 * through PortfolioSingleIntraNodeSolver's protected hook. Terminal flags and
 * exceptions still become visible at their actual native substep.
 */
export class GridHistoryReplayState {
  private historyRequest?: Promise<void>
  private settledHistory?: SettledGridHistory
  private history?: GridHistoryResult
  private expectedPrefix?: GridHistorySnapshot
  private job?: GridHistoryJob
  private checkpointIndex = 0
  private observedSnapshot?: GridHistorySnapshot
  admittedAtIteration?: number

  setHistoryRequest(solver: NativeGridHistorySolver, job: GridHistoryJob, request: Promise<GridHistoryResult>): void {
    if (this.historyRequest || !solver._setupDone || solver.solved || solver.failed ||
      solver.iterations % PARALLEL_GRID_HISTORY_QUANTUM !== 0 || solver.MAX_ITERATIONS !== job.maxIterations ||
      solver.iterations !== job.ownerIterations) {
      throw new Error("Grid history must be assigned at an initialized native supervisor boundary")
    }
    this.job = job
    this.admittedAtIteration = solver.iterations
    this.expectedPrefix = snapshotNativeGridHistory(solver)
    this.historyRequest = request.then(
      (history): void => { this.settledHistory = { kind: "history", history } },
      (error: unknown): void => { this.settledHistory = { kind: "error", error } },
    )
  }

  async prepareForNextStep(): Promise<void> {
    if (!this.historyRequest || this.history) return
    await this.historyRequest
    const settled = this.settledHistory
    if (!settled || !this.job || !this.expectedPrefix) throw new Error("Grid history settled without its native prefix")
    if (settled.kind === "error") throw settled.error
    assertGridHistoryResult(this.job, settled.history)
    const snapshots = [settled.history.initial, ...settled.history.checkpoints]
    const prefixIndex = snapshots.findIndex((snapshot) => snapshot.iterations === this.expectedPrefix!.iterations)
    const prefix = snapshots[prefixIndex]
    if (!prefix || !equalGridSnapshotValues(prefix, this.expectedPrefix)) {
      throw new Error("Grid history does not match the owner's exact native prefix")
    }
    this.history = settled.history
    this.observedSnapshot = prefix
    this.checkpointIndex = prefixIndex
  }

  /** Returns false only for an eligible candidate that was not lent a worker. */
  applyStep(solver: NativeGridHistorySolver): boolean {
    if (!this.history) {
      if (this.historyRequest) throw new Error("Grid history was stepped before preparation")
      return false
    }
    const checkpoint = this.history.checkpoints[this.checkpointIndex]
    if (!checkpoint || solver.iterations > checkpoint.iterations) {
      throw new Error(`Grid history is missing the selected native prefix ${solver.iterations}`)
    }
    if (solver.iterations !== checkpoint.iterations) return true
    this.checkpointIndex++
    this.observedSnapshot = checkpoint
    solver.MAX_ITERATIONS = checkpoint.maxIterations
    solver.solved = checkpoint.solved
    solver.failed = checkpoint.failed
    solver.error = checkpoint.error
    solver.progress = checkpoint.progress
    solver.stats = structuredClone(checkpoint.stats)
    if (checkpoint.exception) {
      const error = new Error(checkpoint.exception.message)
      error.name = checkpoint.exception.name
      if (checkpoint.exception.stack) error.stack = checkpoint.exception.stack
      throw error
    }
    return true
  }

  getSolvedSegmentCount(): number | null {
    // No history means native arrays remain authoritative. A prepared history
    // supplies its count only at boundaries used by the existing supervisor.
    if (!this.history) return null
    if (!this.observedSnapshot) throw new Error("Prepared grid history has no observation")
    return this.observedSnapshot.solvedSegmentCount
  }

  getTerminalOutput(solver: NativeGridHistorySolver): HighDensityIntraNodeRoute[] | undefined {
    if (!this.history) return undefined
    const terminal = this.history.checkpoints.at(-1) ?? this.history.initial
    if (!solver.solved || solver.iterations !== terminal.iterations) {
      throw new Error("Grid replay output is only available at the original successful native onSolve boundary")
    }
    if (this.history.outputException) {
      const error = new Error(this.history.outputException.message)
      error.name = this.history.outputException.name
      if (this.history.outputException.stack) error.stack = this.history.outputException.stack
      throw error
    }
    // Native getOutput creates fresh route arrays, point objects and via arrays
    // on every call. The replay retains that alias contract for onSolve callers.
    return structuredClone(this.history.output)
  }
}
