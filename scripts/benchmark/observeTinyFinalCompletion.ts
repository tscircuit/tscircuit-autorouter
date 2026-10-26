import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import type { TinyFinalCompletionObservation } from "./benchmark-types"

type CompletionSource = {
  constructor: { name: string }
  iterations: number
  MAX_ITERATIONS: number
  solved: boolean
  failed: boolean
  error?: string | null
  state: {
    currentRouteId?: number
    unroutedRoutes: number[]
    ripCount: number
  }
  problem: {
    routeMetadata?: { connectionId?: unknown }[]
  }
  stats?: Record<string, unknown>
}

type CompletionPrototype = {
  getRemainingRouteIdsForGreedyFinalRoute: (this: CompletionSource) => number[]
}

export const observeTinyFinalCompletion = (): {
  events: TinyFinalCompletionObservation[]
  restore: () => void
} => {
  const prototype = TinyHyperGraphSolver.prototype as unknown as CompletionPrototype
  const original = prototype.getRemainingRouteIdsForGreedyFinalRoute
  const events: TinyFinalCompletionObservation[] = []
  prototype.getRemainingRouteIdsForGreedyFinalRoute = function (): number[] {
    const remainingRouteIds = original.call(this)
    const connectionId = (routeId: number | undefined): string | number | null => {
      const value =
        routeId === undefined
          ? undefined
          : this.problem.routeMetadata?.[routeId]?.connectionId
      return typeof value === "string" || typeof value === "number" ? value : null
    }
    const stats: TinyFinalCompletionObservation["stats"] = {}
    for (const key of [
      "neverSuccessfullyRoutedRouteCount",
      "acceptedBestSolutionOnTimeout",
      "acceptedGreedyFinalRouteOnTimeout",
      "greedyFinalRouteIter",
      "finalRoutingStrategy",
      "greedyFinalRouteAttemptCount",
      "greedyFinalRouteRemainingRouteCount",
      "greedyFinalRouteMaxIterations",
      "maxRegionCost",
      "totalRegionCost",
    ]) {
      const value = this.stats?.[key]
      if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") stats[key] = value
    }
    events.push({
      boundaryIndex: events.length,
      solverClass: this.constructor.name,
      iterations: this.iterations,
      maximumIterations: this.MAX_ITERATIONS,
      solved: this.solved,
      failed: this.failed,
      error: this.error ?? null,
      currentRouteId: this.state.currentRouteId ?? null,
      currentConnectionId: connectionId(this.state.currentRouteId),
      pendingRouteCount: this.state.unroutedRoutes.length,
      remainingRouteCount: remainingRouteIds.length,
      remainingRouteIds: [...remainingRouteIds],
      remainingConnectionIds: remainingRouteIds.map(connectionId),
      ripCount: this.state.ripCount,
      stats,
    })
    return remainingRouteIds
  }
  return {
    events,
    restore: (): void => {
      prototype.getRemainingRouteIdsForGreedyFinalRoute = original
    },
  }
}
