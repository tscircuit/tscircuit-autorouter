import type { SimpleRouteJson } from "../../types/srj-types"
import { getPendingEffectsFromSolverTree } from "../../solvers/getPendingEffectsFromSolverTree"
import {
  AutoroutingPipelineSolver9_PreloadedTraceGraph,
  type AutoroutingPipelineSolverOptions,
} from "../AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AUTOROUTER_VERSION } from "./autorouterVersion"
import {
  DEFAULT_HD_CACHE2_SERVER_URL,
  Pipeline9NetworkedHighDensitySolver,
} from "./Pipeline9NetworkedHighDensitySolver"
import { Pipeline9RemainingForceImproveSolver } from "./Pipeline9RemainingForceImproveSolver"
import { Pipeline9NetworkedHighDensityRepairSolver } from "./Pipeline9NetworkedHighDensityRepairSolver"

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
    this.replaceHighDensityPostProcessingSteps()
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
            forceImprove: {
              totalStepsPerNode: 20,
              nodeAssignmentMargin: solver.srj.defaultObstacleMargin ?? 0.2,
            },
          },
        ]
      },
    } as any
  }

  private replaceHighDensityPostProcessingSteps(): void {
    const forceStepIndex = this.pipelineDef.findIndex(
      (step) => step.solverName === "highDensityForceImproveSolver",
    )
    const repairStepIndex = this.pipelineDef.findIndex(
      (step) => step.solverName === "highDensityRepairSolver",
    )
    const forceStep = this.pipelineDef[forceStepIndex]
    const repairStep = this.pipelineDef[repairStepIndex]
    if (!forceStep || !repairStep) {
      throw new Error(
        "Pipeline9 high-density post-processing steps are missing",
      )
    }
    const getRepairConstructorParams = repairStep.getConstructorParams
    this.pipelineDef[forceStepIndex] = {
      ...forceStep,
      solverClass: Pipeline9RemainingForceImproveSolver as any,
      getConstructorParams: (solver: AutoroutingPipelineSolver9_Networked) => {
        const highDensitySolver = solver.highDensityRouteSolver
        if (
          !(highDensitySolver instanceof Pipeline9NetworkedHighDensitySolver)
        ) {
          throw new Error("Pipeline9 networked high-density solver is missing")
        }
        return [
          {
            nodeWithPortPoints: solver.highDensityNodePortPoints!,
            hdRoutes: highDensitySolver.routes,
            colorMap: solver.colorMap,
            totalStepsPerNode: 20,
            nodeAssignmentMargin: solver.srj.defaultObstacleMargin ?? 0.2,
            forceImprovedRegionIds: highDensitySolver.forceImprovedRegionIds,
          },
        ]
      },
    } as any
    this.pipelineDef[repairStepIndex] = {
      ...repairStep,
      solverClass: Pipeline9NetworkedHighDensityRepairSolver as any,
      getConstructorParams: (solver: AutoroutingPipelineSolver9_Networked) => {
        const [params] = getRepairConstructorParams(solver)
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
