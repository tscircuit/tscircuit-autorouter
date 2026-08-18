import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getGlobalInMemoryCache } from "../../cache/setupGlobalCaches"
import { HighDensitySolver } from "./HighDensitySolver"
import type {
  HighDensityNodeSolveResult,
  HighDensityNodeSolveTask,
  HighDensitySolverExecutionContext,
} from "./high-density-parallel-types"

/**
 * Creates the pure algorithm-side handler used inside an executor session.
 * ConnectivityMap is reconstructed in the execution realm because structured
 * clone intentionally does not preserve its prototype.
 */
export const createHighDensityNodeTaskHandler = (
  context: HighDensitySolverExecutionContext,
): ((task: HighDensityNodeSolveTask) => HighDensityNodeSolveResult) => {
  const connMap = context.connectivityNetMap
    ? new ConnectivityMap(context.connectivityNetMap)
    : undefined

  return (task: HighDensityNodeSolveTask): HighDensityNodeSolveResult => {
    const cache = getGlobalInMemoryCache()
    const cacheHitsBefore = cache.cacheHits
    const cacheMissesBefore = cache.cacheMisses
    const solver = new HighDensitySolver({
      nodePortPoints: [task.nodeWithPortPoints],
      nodePfById: {
        [task.nodeWithPortPoints.capacityMeshNodeId]: task.nodePf,
      },
      colorMap: context.colorMap,
      connMap,
      viaDiameter: context.viaDiameter,
      traceWidth: context.traceWidth,
      obstacleMargin: context.obstacleMargin,
      effort: context.effort,
      obstacles: context.obstacles,
      layerCount: context.layerCount,
      useGrowShrinkHighDensityIntraNodeSolver:
        context.useGrowShrinkHighDensityIntraNodeSolver,
      preserveTerminalPcbPortIds: context.preserveTerminalPcbPortIds,
      growShrinkMaxInnerIterationsPerGrowthAttempt:
        context.growShrinkMaxInnerIterationsPerGrowthAttempt,
      growShrinkFallbackToInvalidGeometryOnFailure:
        context.growShrinkFallbackToInvalidGeometryOnFailure,
      captureSearchDebug: context.captureSearchDebug,
    })

    solver.solve()

    const metadata = solver.nodeSolveMetadataById.get(
      task.nodeWithPortPoints.capacityMeshNodeId,
    )
    const routes = solver.solved
      ? solver.routes
      : (solver.failedSolvers[0]?.solvedRoutes ?? [])

    return {
      nodeIndex: task.nodeIndex,
      status: solver.solved ? "solved" : "failed",
      routes,
      solverType: metadata?.solverType ?? "unknown",
      iterations: metadata?.iterations ?? solver.iterations,
      routeCount: metadata?.routeCount ?? routes.length,
      growthAttempts: solver.stats.highDensityResizeCount ?? 0,
      cacheHits: cache.cacheHits - cacheHitsBefore,
      cacheMisses: cache.cacheMisses - cacheMissesBefore,
      error: metadata?.error ?? solver.error ?? undefined,
    }
  }
}
