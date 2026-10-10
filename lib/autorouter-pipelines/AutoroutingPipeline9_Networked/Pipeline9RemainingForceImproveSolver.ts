import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { materializePipeline9HdRouteVias } from "../AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import { simplifyPipeline9CollinearRoutePoints } from "../AutoroutingPipeline9_PreloadedTraceGraph/simplifyPipeline9CollinearRoutePoints"

type Pipeline9RemainingForceImproveSolverParams = ConstructorParameters<
  typeof HighDensityForceImproveSolver
>[0] & {
  forceImprovedRegionIds: ReadonlySet<string>
}

type Pipeline9RemainingForceImproveSolverConstructorParams = ReturnType<
  HighDensityForceImproveSolver["getConstructorParams"]
>[0] & {
  forceImprovedRegionIds: ReadonlySet<string>
}

/** Keeps node work already performed remotely while improving the remaining groups. */
export class Pipeline9RemainingForceImproveSolver extends HighDensityForceImproveSolver {
  readonly forceImprovedRegionIds: ReadonlySet<string>
  readonly completeHdRoutes: HighDensityIntraNodeRoute[]
  private readonly remainingRouteIndexes: number[]

  constructor(params: Pipeline9RemainingForceImproveSolverParams) {
    const remainingRouteIndexes = params.hdRoutes.flatMap((route, index) =>
      route.regionId !== undefined &&
      params.forceImprovedRegionIds.has(route.regionId)
        ? []
        : [index],
    )
    super({
      ...params,
      // Keep the full node list: routes without a region ID are assigned by
      // containment and must see the same candidates as the original stage.
      hdRoutes: simplifyPipeline9CollinearRoutePoints(
        materializePipeline9HdRouteVias(
          remainingRouteIndexes.map((index) => params.hdRoutes[index]!),
        ),
      ),
    })
    this.forceImprovedRegionIds = new Set(params.forceImprovedRegionIds)
    this.completeHdRoutes = params.hdRoutes
    this.remainingRouteIndexes = remainingRouteIndexes
    for (const sampleEntry of this.sampleEntries) {
      if (this.forceImprovedRegionIds.has(sampleEntry.node.capacityMeshNodeId)) {
        throw new Error(
          `Pipeline9 remaining force-improvement routes were assigned to already improved node "${sampleEntry.node.capacityMeshNodeId}"`,
        )
      }
    }
    this.stats.preImprovedRouteCount =
      params.hdRoutes.length - remainingRouteIndexes.length
  }

  override getSolverName(): string {
    return "Pipeline9RemainingForceImproveSolver"
  }

  override getConstructorParams(): readonly [Pipeline9RemainingForceImproveSolverConstructorParams] {
    return [
      {
        ...super.getConstructorParams()[0],
        hdRoutes: this.completeHdRoutes,
        forceImprovedRegionIds: this.forceImprovedRegionIds,
      },
    ]
  }

  override _step(): void {
    super._step()
    this.stats = {
      ...this.stats,
      preImprovedRouteCount:
        this.completeHdRoutes.length - this.remainingRouteIndexes.length,
    }
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    const output = [...this.completeHdRoutes]
    const remainingOutput = super.getOutput()
    for (const [index, originalIndex] of this.remainingRouteIndexes.entries()) {
      output[originalIndex] = remainingOutput[index]!
    }
    return output
  }
}
