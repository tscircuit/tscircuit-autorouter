import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import {
  HighDensitySolverFailureCache,
  HighDensitySolverFailureCacheController,
  highDensitySolverFailureCache,
} from "./HighDensitySolverFailureCache"

export class HighDensitySolverA01WithFailureCache extends HighDensitySolverA01 {
  private readonly failureCacheController: HighDensitySolverFailureCacheController

  constructor(
    params: ConstructorParameters<typeof HighDensitySolverA01>[0],
    cache: HighDensitySolverFailureCache = highDensitySolverFailureCache,
  ) {
    super(params)
    this.failureCacheController = new HighDensitySolverFailureCacheController(
      { solverName: "A01", constructorParams: params },
      cache,
    )
  }

  override getSolverName(): string {
    return "HighDensitySolverA01"
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
