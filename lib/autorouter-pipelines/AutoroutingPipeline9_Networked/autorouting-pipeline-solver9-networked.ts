import type { SimpleRouteJson } from "../../types/srj-types"
import { getPendingEffectsFromSolverTree } from "../../solvers/getPendingEffectsFromSolverTree"
import {
  AutoroutingPipelineSolver9_PreloadedTraceGraph,
  type AutoroutingPipelineSolverOptions,
} from "../AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import { AUTOROUTER_VERSION } from "./autorouter-version"
import {
  DEFAULT_PIPELINE9_NETWORKED_CACHE_URL,
  DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_BODY_BYTES,
  DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_ITEMS,
  DEFAULT_PIPELINE9_NETWORKED_TIMEOUT_MS,
  DEFAULT_PIPELINE9_NETWORKED_TRANSPORT_TIMEOUT_MS,
  Pipeline9NetworkedHighDensitySolver,
} from "./pipeline9-networked-high-density-solver"

export type AutoroutingPipelineSolver9NetworkedOptions = Omit<
  AutoroutingPipelineSolverOptions,
  "effort"
> & {
  effort?: 1
  hdCacheBaseUrl?: string
  hdCacheFetch?: typeof fetch
  hdCacheTimeoutMs?: number
  hdCacheTransportTimeoutMs?: number
  hdCacheMaxBatchItems?: number
  hdCacheMaxBatchBodyBytes?: number
}

/** Pipeline9 with exact, version-scoped remote terminal node solving. */
export class AutoroutingPipelineSolver9_Networked extends AutoroutingPipelineSolver9_PreloadedTraceGraph {
  readonly hdCacheBaseUrl: string
  readonly hdCacheFetch?: typeof fetch
  readonly hdCacheTimeoutMs: number
  readonly hdCacheTransportTimeoutMs: number
  readonly hdCacheMaxBatchItems: number
  readonly hdCacheMaxBatchBodyBytes: number

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

    this.hdCacheBaseUrl =
      opts.hdCacheBaseUrl ?? DEFAULT_PIPELINE9_NETWORKED_CACHE_URL
    this.hdCacheFetch = opts.hdCacheFetch
    this.hdCacheTimeoutMs =
      opts.hdCacheTimeoutMs ?? DEFAULT_PIPELINE9_NETWORKED_TIMEOUT_MS
    this.hdCacheTransportTimeoutMs =
      opts.hdCacheTransportTimeoutMs ??
      DEFAULT_PIPELINE9_NETWORKED_TRANSPORT_TIMEOUT_MS
    this.hdCacheMaxBatchItems =
      opts.hdCacheMaxBatchItems ?? DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_ITEMS
    this.hdCacheMaxBatchBodyBytes =
      opts.hdCacheMaxBatchBodyBytes ??
      DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_BODY_BYTES
    if (!Number.isFinite(this.hdCacheTimeoutMs) || this.hdCacheTimeoutMs <= 0) {
      throw new Error(
        `Pipeline9 network request timeout must be a positive number, received ${this.hdCacheTimeoutMs}`,
      )
    }
    if (
      !Number.isFinite(this.hdCacheTransportTimeoutMs) ||
      this.hdCacheTransportTimeoutMs < this.hdCacheTimeoutMs
    ) {
      throw new Error(
        `Pipeline9 network transport timeout must be at least the logical request timeout (${this.hdCacheTimeoutMs}ms), received ${this.hdCacheTransportTimeoutMs}`,
      )
    }
    if (
      !Number.isInteger(this.hdCacheMaxBatchItems) ||
      this.hdCacheMaxBatchItems <= 0 ||
      this.hdCacheMaxBatchItems > DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_ITEMS
    ) {
      throw new Error(
        `Pipeline9 network max batch items must be a positive integer no greater than ${DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_ITEMS}, received ${this.hdCacheMaxBatchItems}`,
      )
    }
    if (
      !Number.isInteger(this.hdCacheMaxBatchBodyBytes) ||
      this.hdCacheMaxBatchBodyBytes <= 0 ||
      this.hdCacheMaxBatchBodyBytes >
        DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_BODY_BYTES
    ) {
      throw new Error(
        `Pipeline9 network max batch body bytes must be a positive integer no greater than ${DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_BODY_BYTES}, received ${this.hdCacheMaxBatchBodyBytes}`,
      )
    }
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
            hdCacheBaseUrl: solver.hdCacheBaseUrl,
            fetchImpl: solver.hdCacheFetch,
            requestTimeoutMs: solver.hdCacheTimeoutMs,
            transportTimeoutMs: solver.hdCacheTransportTimeoutMs,
            maxBatchItems: solver.hdCacheMaxBatchItems,
            maxBatchBodyBytes: solver.hdCacheMaxBatchBodyBytes,
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
