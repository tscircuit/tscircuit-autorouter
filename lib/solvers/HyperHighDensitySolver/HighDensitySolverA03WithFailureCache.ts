import { HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import {
  HighDensitySolverFailureCache,
  HighDensitySolverFailureCacheController,
  highDensitySolverFailureCache,
} from "./HighDensitySolverFailureCache"

export class HighDensitySolverA03WithFailureCache extends HighDensitySolverA03 {
  private readonly failureCacheController: HighDensitySolverFailureCacheController

  constructor(
    params: ConstructorParameters<typeof HighDensitySolverA03>[0],
    cache: HighDensitySolverFailureCache = highDensitySolverFailureCache,
  ) {
    super(params)
    this.failureCacheController = new HighDensitySolverFailureCacheController(
      { solverName: "A03", constructorParams: params },
      cache,
    )
  }

  override getSolverName(): string {
    return "HighDensitySolverA03"
  }

  override _step(): void {
    if (this.failureCacheController.replayFailure(this)) return
    super._step()
    this.failureCacheController.recordFailure(this)
  }

  override tryFinalAcceptance(): void {
    super.tryFinalAcceptance()
    this.failureCacheController.recordIterationLimit(this)
  }
}
