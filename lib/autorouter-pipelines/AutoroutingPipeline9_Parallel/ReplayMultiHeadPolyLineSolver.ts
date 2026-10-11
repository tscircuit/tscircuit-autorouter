import { MultiHeadPolyLineIntraNodeSolver3 } from "../../solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import type { MultiHeadHistoryResult } from "./parallelMultiHeadHistoryTypes"

type SettledHistory = { kind: "history"; history: MultiHeadHistoryResult } | { kind: "error"; error: unknown }

/** Replay only the prefix selected by the original adaptive supervisor. */
export class ReplayMultiHeadPolyLineSolver extends MultiHeadPolyLineIntraNodeSolver3 {
  private historyRequest?: Promise<void>
  private settledHistory?: SettledHistory
  private history?: MultiHeadHistoryResult

  setHistoryRequest(request: Promise<MultiHeadHistoryResult>): void {
    if (this.historyRequest || this.iterations !== 0) {
      throw new Error("Multi-head history must be assigned before its first step")
    }
    this.historyRequest = request.then(
      (history): void => { this.settledHistory = { kind: "history", history } },
      (error: unknown): void => { this.settledHistory = { kind: "error", error } },
    )
  }

  async prepareForNextStep(): Promise<void> {
    if (!this.historyRequest || this.history) return
    await this.historyRequest
    const settled = this.settledHistory
    if (!settled) throw new Error("Multi-head history request settled without a result")
    if (settled.kind === "error") throw settled.error
    const initial = settled.history.initial
    if (initial.iterations !== 0 || initial.maxIterations !== this.MAX_ITERATIONS ||
        initial.solved !== this.solved || initial.failed !== this.failed ||
        initial.error !== this.error || !Object.is(initial.progress, this.progress)) {
      throw new Error("Multi-head history does not match its initial solver state")
    }
    this.history = settled.history
  }

  override _step(): void {
    if (!this.history) {
      if (this.historyRequest) throw new Error("Multi-head history was stepped before preparation")
      super._step()
      return
    }
    const state = this.history.steps[this.iterations - 1]
    if (!state || state.iterations !== this.iterations) {
      throw new Error(`Multi-head history is missing step ${this.iterations}`)
    }
    this.MAX_ITERATIONS = state.maxIterations
    this.solved = state.solved
    this.failed = state.failed
    this.error = state.error
    this.progress = state.progress
    if (state.solved) this.solvedRoutes = this.history.solvedRoutes
    if (state.exception) {
      const error = new Error(state.exception.message)
      error.name = state.exception.name
      throw error
    }
  }

  override tryFinalAcceptance(): void {
    if (!this.history) {
      super.tryFinalAcceptance()
      return
    }
    // The recorded BaseSolver.step already ran final acceptance at this prefix.
    const state = this.history.steps[this.iterations - 1]
    if (!state || state.iterations !== this.iterations) {
      throw new Error("Multi-head final acceptance has no recorded state")
    }
  }
}
