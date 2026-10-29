import type { RepairSearchScratchStats } from "../RepairSearchScratchStats"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { ClearancePathConnectivity } from "./ClearancePathConnectivity"
import type { ClearancePathSearchStats } from "@tscircuit/repair04"
import {
  createNegotiatedClearanceSearch,
  type NegotiatedClearanceSearchInput,
} from "./negotiatedClearanceSearchKernel"
import type { RepairRoutePoint } from "./repairRegionTypes"
import { FindClearancePathSolver } from "./FindClearancePathSolver"

export type PairedClearancePathInput = {
  task: NegotiatedClearanceSearchInput
  /** Reserved independently of the forward search, without reducing its cap. */
  reverseMaxNodes?: number
  connectivity?: ClearancePathConnectivity
}

/** Deterministic directional search, with one native step per active lane. */
export class PairedClearancePathSolver extends BaseSolver {
  readonly input: PairedClearancePathInput
  readonly forward: FindClearancePathSolver
  reverse?: FindClearancePathSolver
  override stats: ClearancePathSearchStats = {
    nodesPopped: 0,
    completionReason: "no-path",
  }
  private phase:
    | "prepare-forward"
    | "search-forward"
    | "prepare-reverse"
    | "search" = "prepare-forward"
  private output: RepairRoutePoint[] | null | undefined
  private laneErrors: Array<{ name: string; message: string } | undefined> = []
  private originalErrors: Array<{ error: unknown } | undefined> = []

  constructor(input: PairedClearancePathInput, private readonly scratchStats?: RepairSearchScratchStats) {
    super()
    if (
      input.reverseMaxNodes !== undefined &&
      (!Number.isSafeInteger(input.reverseMaxNodes) ||
        input.reverseMaxNodes < 1)
    ) {
      throw new Error("repair04: reverse node budget must be positive")
    }
    this.input = input
    this.forward = createNegotiatedClearanceSearch(
      input.task,
      input.connectivity,
      scratchStats,
    )
    this.activeSubSolver = this.forward
    const forwardNodes = input.task.pathInput.maxNodes ?? 30000
    const reverseMaximum =
      this.forward.MAX_ITERATIONS +
      Math.ceil((input.reverseMaxNodes ?? forwardNodes) / 128) -
      Math.ceil(forwardNodes / 128)
    this.MAX_ITERATIONS = this.forward.MAX_ITERATIONS + reverseMaximum + 8
  }

  getLaneStats(): ClearancePathSearchStats[] {
    return [this.forward, ...(this.reverse ? [this.reverse] : [])].map(
      (lane): ClearancePathSearchStats => ({ ...lane.stats }),
    )
  }

  getLastLaneErrors(): Array<{ name: string; message: string } | undefined> {
    return this.laneErrors.map(
      (error): { name: string; message: string } | undefined =>
        error ? { ...error } : undefined,
    )
  }

  private stepLane(lane: FindClearancePathSolver, index: number): void {
    try {
      lane.step()
    } catch (error) {
      this.originalErrors[index] = { error }
      this.laneErrors[index] =
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: "Error", message: String(error) }
    }
  }

  private throwLaneError(): void {
    const failure = this.originalErrors.find(
      (error): boolean => error !== undefined,
    )
    if (failure) throw failure.error
  }

  private updateStats(): void {
    this.stats.nodesPopped =
      this.forward.stats.nodesPopped + (this.reverse?.stats.nodesPopped ?? 0)
    if (!this.solved) {
      this.progress = Math.min(
        0.99,
        this.stats.nodesPopped /
          ((this.input.task.pathInput.maxNodes ?? 30000) +
            (this.reverse ? this.input.reverseMaxNodes! : 0)),
      )
    }
  }

  private finish(path: RepairRoutePoint[] | null, reverse = false): void {
    this.output = reverse && path ? path.slice().reverse() : path
    this.stats.completionReason = path
      ? "found"
      : this.getLaneStats().some(
            (stats): boolean => stats.completionReason === "node-limit",
          )
        ? "node-limit"
        : "no-path"
    this.solved = true
    this.progress = 1
    this.activeSubSolver = null
  }

  private checkFailure(): boolean {
    const failed = [this.forward, this.reverse].find((lane): boolean =>
      Boolean(lane?.failed),
    )
    if (!failed) return false
    this.failed = true
    this.error = failed.error
    return true
  }

  override _step(): void {
    this.laneErrors = []
    this.originalErrors = []
    if (this.phase === "prepare-forward") {
      this.stepLane(this.forward, 0)
      this.updateStats()
      this.throwLaneError()
      if (this.checkFailure()) return
      if (this.forward.solved) {
        this.finish(this.forward.getOutput())
        return
      }
      if (!this.forward.isSearchPrepared()) return
      if (this.input.reverseMaxNodes === undefined) {
        this.phase = "search"
        return
      }
      this.phase = "search-forward"
      return
    }
    if (this.phase === "search-forward") {
      this.stepLane(this.forward, 0)
      this.updateStats()
      this.throwLaneError()
      if (this.checkFailure()) return
      if (this.forward.solved) {
        this.finish(this.forward.getOutput())
        return
      }
      // Give ordinary forward searches eight native batches before paying for
      // another geometry/index preparation and a second constructed search.
      if (this.forward.stats.nodesPopped < 1024) return
      const { task } = this.input
      this.reverse = createNegotiatedClearanceSearch(
        {
          ...task,
          pathInput: {
            ...task.pathInput,
            start: task.pathInput.end,
            end: task.pathInput.start,
            existingPath: task.pathInput.existingPath?.slice().reverse(),
            maxNodes: this.input.reverseMaxNodes,
          },
        },
        this.input.connectivity,
        this.scratchStats,
      )
      this.activeSubSolver = this.reverse
      this.phase = "prepare-reverse"
      return
    }
    if (this.phase === "prepare-reverse") {
      this.stepLane(this.reverse!, 1)
      this.updateStats()
      this.throwLaneError()
      if (this.checkFailure()) return
      if (this.reverse!.solved && this.reverse!.getOutput()) {
        this.finish(this.reverse!.getOutput(), true)
        return
      }
      if (this.reverse!.solved || this.reverse!.isSearchPrepared()) {
        this.phase = "search"
        this.activeSubSolver = this.forward
      }
      return
    }
    if (!this.forward.solved && !this.forward.failed) {
      this.stepLane(this.forward, 0)
    }
    if (this.reverse && !this.reverse.solved && !this.reverse.failed) {
      this.stepLane(this.reverse, 1)
    }
    this.updateStats()
    this.throwLaneError()
    if (this.checkFailure()) return
    if (this.forward.solved && this.forward.getOutput()) {
      this.finish(this.forward.getOutput())
      return
    }
    if (this.reverse?.solved && this.reverse.getOutput()) {
      this.finish(this.reverse.getOutput(), true)
      return
    }
    if (this.forward.solved && (!this.reverse || this.reverse.solved)) {
      this.finish(null)
    }
  }

  override getOutput(): RepairRoutePoint[] | null {
    if (!this.solved || this.failed || this.output === undefined) {
      throw new Error("repair04: paired clearance output requested too early")
    }
    return this.output
  }
}

/** Solve the same deterministic directional algorithm without manual stepping. */
export function findPairedClearancePath(
  input: PairedClearancePathInput,
): RepairRoutePoint[] | null {
  const solver = new PairedClearancePathSolver(input)
  solver.solve()
  if (solver.failed) {
    throw new Error(solver.error ?? "repair04: paired clearance search failed")
  }
  return solver.getOutput()
}
