import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import type { HighDensityIntraNodeRoute } from "../../types/high-density-types"
import { GridHistoryReplayState } from "./GridHistoryReplayState"
import type { GridHistoryJob, GridHistoryResult } from "./parallelGridHistoryTypes"
import { NativeA01HistoryEquivalence } from "./NativeA01HistoryEquivalence"
import { finishParallelNativeA01Heap, installParallelNativeA01Heap, prepareParallelNativeA01Heap } from "./installParallelNativeA01Heap"

/** Native identity and setup remain intact; only admitted selected quanta replay. */
export class ReplayHighDensityA01Solver extends HighDensitySolverA01 {
  private readonly replay = new GridHistoryReplayState()
  private historyEquivalence: NativeA01HistoryEquivalence | null = null

  override _setup(): void {
    super._setup()
    if (!this.failed) this.historyEquivalence = NativeA01HistoryEquivalence.capture(this, replayContract)
    installParallelNativeA01Heap(this, replayContract)
  }

  hasEquivalentHistory(other: ReplayHighDensityA01Solver): boolean {
    return this.historyEquivalence !== null && other.historyEquivalence !== null &&
      this.historyEquivalence.matches(this, other.historyEquivalence, other)
  }

  createHistoryJob(candidateId: number): GridHistoryJob {
    const [params] = this.getConstructorParams()
    const { initialPenaltyFn, ...nativeParams } = params
    if (initialPenaltyFn) throw new Error("A01 grid histories cannot serialize a penalty callback")
    if (!this._setupDone) throw new Error("A01 history requires the owner's post-setup native cap")
    return { kind: "gridHistory", algorithm: "a01", candidateId,
      params: nativeParams, maxIterations: this.MAX_ITERATIONS, ownerIterations: this.iterations }
  }

  setHistoryRequest(job: GridHistoryJob, request: Promise<GridHistoryResult>,
    recordReplayWork?: (iterations: number) => void): void {
    if (job.algorithm !== "a01") throw new Error("A01 replay received a different grid algorithm")
    this.replay.setHistoryRequest(this, job, request, recordReplayWork)
  }

  async prepareForNextStep(): Promise<void> {
    await this.replay.prepareForNextStep()
  }

  getReplaySolvedSegmentCount(): number | null {
    return this.replay.getSolvedSegmentCount()
  }

  override _step(): void {
    if (!this.replay.applyStep(this)) {
      prepareParallelNativeA01Heap(this)
      try {
        super._step()
      } finally {
        finishParallelNativeA01Heap(this)
      }
    }
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    return this.replay.getTerminalOutput(this) ?? super.getOutput()
  }
}

const replayContract = { prototype: ReplayHighDensityA01Solver.prototype,
  descriptors: Object.getOwnPropertyDescriptors(ReplayHighDensityA01Solver.prototype) }
