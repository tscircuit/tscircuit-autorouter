import { HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import type { HighDensityIntraNodeRoute } from "../../types/high-density-types"
import { GridHistoryReplayState } from "./GridHistoryReplayState"
import type { GridHistoryJob, GridHistoryResult } from "./parallelGridHistoryTypes"
import { installParallelNativeA03Geometry } from "./installParallelNativeA03Geometry"
import { isWorkerOwnedNativeGridOwner } from "./workerNativeGridKernelQuantum"

const immutableGeometryOwners = new WeakSet<HighDensitySolverA03>()

/** Native A03 identity preserves the original budget, fitness and output branch. */
export class ReplayHighDensityA03Solver extends HighDensitySolverA03 {
  private readonly replay = new GridHistoryReplayState()

  constructor(params: ConstructorParameters<typeof HighDensitySolverA03>[0],
    options?: { immutableWorkerGeometry?: boolean }) {
    super(params)
    if (options?.immutableWorkerGeometry === true) immutableGeometryOwners.add(this)
  }

  override _setup(): void {
    super._setup()
    if (immutableGeometryOwners.has(this) && isWorkerOwnedNativeGridOwner(this)) {
      installParallelNativeA03Geometry(this, replayContract)
    }
  }

  createHistoryJob(candidateId: number): GridHistoryJob {
    const [params] = this.getConstructorParams()
    const { initialPenaltyFn, ...nativeParams } = params
    if (initialPenaltyFn) throw new Error("A03 grid histories cannot serialize a penalty callback")
    if (!this._setupDone) throw new Error("A03 history requires the owner's post-setup native cap")
    return { kind: "gridHistory", algorithm: "a03", candidateId,
      params: nativeParams, maxIterations: this.MAX_ITERATIONS, ownerIterations: this.iterations }
  }

  setHistoryRequest(job: GridHistoryJob, request: Promise<GridHistoryResult>,
    recordReplayWork?: (iterations: number) => void): void {
    if (job.algorithm !== "a03") throw new Error("A03 replay received a different grid algorithm")
    this.replay.setHistoryRequest(this, job, request, recordReplayWork)
  }

  async prepareForNextStep(): Promise<void> {
    await this.replay.prepareForNextStep()
  }

  getReplaySolvedSegmentCount(): number | null {
    return this.replay.getSolvedSegmentCount()
  }

  override _step(): void {
    if (!this.replay.applyStep(this)) super._step()
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    return this.replay.getTerminalOutput(this) ?? super.getOutput()
  }
}

const replayContract = { prototype: ReplayHighDensityA03Solver.prototype,
  descriptors: Object.getOwnPropertyDescriptors(ReplayHighDensityA03Solver.prototype) }
