import type { SimpleRouteJson } from "../../types/srj-types"
import { getPendingEffectsFromSolverTree } from "../../solvers/getPendingEffectsFromSolverTree"
import {
  AutoroutingPipelineSolver9_PreloadedTraceGraph,
  type AutoroutingPipelineSolverOptions,
} from "../AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import { AUTOROUTER_VERSION } from "./autorouter-version"
import {
  DEFAULT_HD_CACHE2_SERVER_URL,
  Pipeline9NetworkedHighDensitySolver,
} from "./pipeline9-networked-high-density-solver"

export type AutoroutingPipelineSolver9NetworkedOptions = Omit<
  AutoroutingPipelineSolverOptions,
  "effort"
> & {
  effort?: 1
  /** Base URL of an hd-cache2-compatible server. */
  hdCache2ServerUrl?: string
  /** Optional cache namespace, used to isolate cold/hot benchmark runs. */
  hdCache2CacheVersion?: string
}

/** Pipeline9 with exact, version-scoped remote terminal node solving. */
export class AutoroutingPipelineSolver9_Networked extends AutoroutingPipelineSolver9_PreloadedTraceGraph {
  readonly hdCache2ServerUrl: string
  readonly hdCache2CacheVersion?: string

  override getSolverName(): string {
    return "AutoroutingPipelineSolver9_Networked"
  }

  constructor(
    srj: SimpleRouteJson,
    opts: AutoroutingPipelineSolver9NetworkedOptions = {},
  ) {
    super(srj, opts)
    if (this.effort !== 1) {
      throw new Error(
        `AutoroutingPipelineSolver9_Networked is only available at effort=1, received ${this.effort}`,
      )
    }

    this.hdCache2ServerUrl =
      opts.hdCache2ServerUrl ?? DEFAULT_HD_CACHE2_SERVER_URL
    this.hdCache2CacheVersion = opts.hdCache2CacheVersion
    this.replaceHighDensityPipelineStep()
  }

  private replaceHighDensityPipelineStep(): void {
    const highDensityStepIndex = this.pipelineDef.findIndex(
      (step) => step.solverName === "highDensityRouteSolver",
    )
    const originalStep = this.pipelineDef[highDensityStepIndex]
    if (!originalStep) {
      throw new Error("Pipeline9 highDensityRouteSolver step is missing")
    }
    const getOriginalConstructorParams = originalStep.getConstructorParams

    this.pipelineDef[highDensityStepIndex] = {
      ...originalStep,
      solverClass: Pipeline9NetworkedHighDensitySolver as any,
      getConstructorParams: (solver: AutoroutingPipelineSolver9_Networked) => {
        const [params] = getOriginalConstructorParams(solver)
        return [
          {
            ...params,
            autorouterVersion: AUTOROUTER_VERSION,
            hdCache2ServerUrl: solver.hdCache2ServerUrl,
            hdCache2CacheVersion: solver.hdCache2CacheVersion,
          },
        ]
      },
    } as any
  }

  async stepAsync(): Promise<void> {
    if (this.solved || this.failed) return
    this.step()

    const pendingEffects = getPendingEffectsFromSolverTree(this)
    if (pendingEffects.length === 0) return
    await Promise.race(
      pendingEffects.map((effect) =>
        effect.promise.then(
          () => effect.name,
          () => effect.name,
        ),
      ),
    )

    if (!this.solved && !this.failed) this.step()
  }

  async solveAsync(): Promise<void> {
    const startTime = Date.now()
    while (!this.solved && !this.failed) {
      await this.stepAsync()
    }
    this.timeToSolve = Date.now() - startTime
  }

  async solveUntilPhaseAsync(phase: string): Promise<void> {
    while (this.getCurrentPhase() !== phase && !this.solved && !this.failed) {
      await this.stepAsync()
    }
  }

  override solve(): void {
    throw new Error(
      "AutoroutingPipelineSolver9_Networked requires async execution. Use solveAsync() or stepAsync().",
    )
  }

  override solveUntilPhase(_phase: string): void {
    throw new Error(
      "AutoroutingPipelineSolver9_Networked requires solveUntilPhaseAsync().",
    )
  }
}
