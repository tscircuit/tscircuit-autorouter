import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import { getPendingEffectsFromSolverTree } from "lib/solvers/getPendingEffectsFromSolverTree"
import {
  AutoroutingPipelineSolver4_TinyHypergraph,
  type AutoroutingPipelineSolverOptions,
} from "../AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { Pipeline5HdCacheHighDensitySolver } from "./Pipeline5HdCacheHighDensitySolver"

export type AutoroutingPipelineSolver5Options =
  AutoroutingPipelineSolverOptions & {
    hdCacheBaseUrl?: string
    hdCacheFetch?: typeof fetch
  }

export class AutoroutingPipelineSolver5_HdCache extends AutoroutingPipelineSolver4_TinyHypergraph {
  readonly hdCacheBaseUrl: string
  readonly hdCacheFetch?: typeof fetch

  constructor(
    srj: ConstructorParameters<
      typeof AutoroutingPipelineSolver4_TinyHypergraph
    >[0],
    opts: AutoroutingPipelineSolver5Options = {},
  ) {
    super(
      srj,
      opts.maxNodeDimension === undefined
        ? { ...opts, maxNodeDimension: 7 }
        : opts,
    )
    this.hdCacheBaseUrl =
      opts.hdCacheBaseUrl ?? "https://hd-cache.tscircuit.com"
    this.hdCacheFetch = opts.hdCacheFetch
    this.replaceHighDensityPipelineStep()
  }

  private replaceHighDensityPipelineStep() {
    const highDensityStepIndex = this.pipelineDef.findIndex(
      (step) => step.solverName === "highDensityRouteSolver",
    )

    if (highDensityStepIndex === -1) {
      throw new Error("Pipeline4 highDensityRouteSolver step is missing")
    }

    this.pipelineDef[highDensityStepIndex] = {
      ...this.pipelineDef[highDensityStepIndex],
      solverClass: Pipeline5HdCacheHighDensitySolver as any,
      getConstructorParams: (cms: AutoroutingPipelineSolver5_HdCache) => {
        const uniformNodes =
          cms.uniformPortDistributionSolver?.getOutput() ?? []
        const fallbackNodes =
          cms.portPointPathingSolver?.getOutput().nodesWithPortPoints ?? []
        const nodePortPointsSource =
          uniformNodes.length > 0 ? uniformNodes : fallbackNodes

        cms.highDensityNodePortPoints = structuredClone(nodePortPointsSource)

        return [
          {
            nodePortPoints: nodePortPointsSource,
            nodePfById: new Map(
              (
                cms.portPointPathingSolver?.getOutput()
                  .inputNodeWithPortPoints ?? []
              ).map((node) => [
                node.capacityMeshNodeId as CapacityMeshNodeId,
                cms.portPointPathingSolver?.computeNodePf(node) ?? null,
              ]),
            ) as Map<CapacityMeshNodeId, number | null>,
            colorMap: cms.colorMap,
            connMap: cms.connMap as ConnectivityMap | undefined,
            viaDiameter: cms.viaDiameter,
            traceWidth: cms.minTraceWidth,
            obstacleMargin: cms.srj.defaultObstacleMargin ?? 0.15,
            hdCacheBaseUrl: cms.hdCacheBaseUrl,
            fetchImpl: cms.hdCacheFetch,
          },
        ]
      },
    } as any
  }

  async stepAsync() {
    if (this.solved || this.failed) return

    this.step()

    const pendingEffects = getPendingEffectsFromSolverTree(this)
    if (pendingEffects.length === 0) {
      return
    }

    await Promise.race(
      pendingEffects.map((effect) =>
        effect.promise.then(
          () => effect.name,
          () => effect.name,
        ),
      ),
    )

    if (!this.solved && !this.failed) {
      this.step()
    }
  }

  async solveAsync() {
    const startTime = Date.now()

    while (!this.solved && !this.failed) {
      await this.stepAsync()
    }

    this.timeToSolve = Date.now() - startTime
  }

  override solve() {
    throw new Error(
      "AutoroutingPipelineSolver5_HdCache requires async execution. Use solveAsync() or stepAsync().",
    )
  }
}

export { AutoroutingPipelineSolver5_HdCache as AutoroutingPipelineSolver5 }
