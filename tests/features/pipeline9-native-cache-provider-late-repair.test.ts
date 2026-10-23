import { expect, spyOn, test } from "bun:test"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9RegionalB01RepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalB01RepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SimpleRouteJson } from "lib/types/srj-types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("late joint regional repairs retain the original native cache policy through actual candidates", (): void => {
  const srj: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, minViaDiameter: 0.3, bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 }, obstacles: [], connections: [
    { name: "route", pointsToConnect: [{ x: -2, y: 0, layer: "top" }, { x: 2, y: 0, layer: "top" }] },
  ] }
  const routes: HighDensityRoute[] = [{ connectionName: "route", rootConnectionName: "route", traceThickness: 0.1, viaDiameter: 0.3, vias: [], route: [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }] }]
  const errors = [{ type: "pcb_trace_error", pcb_trace_id: "route_0", center: { x: 0, y: 0 } }]
  const globalCache = getGlobalInMemoryCache()
  const read = spyOn(globalCache, "getCachedSolutionSync")
  const write = spyOn(globalCache, "setCachedSolutionSync")
  try {
    for (const cacheProvider of [null, undefined, new InMemoryCache()]) {
      globalCache.clearCache()
      const pipeline = new Pipeline9(structuredClone(srj), { effort: 1, cacheProvider })
      pipeline.solveUntilPhase("pipeline9JointDrcRepairSolver")
      pipeline.step()
      expect(pipeline.pipeline9JointDrcRepairSolver!.params.cacheProvider).toBe(cacheProvider)
      read.mockClear()
      write.mockClear()
      const repair = new Pipeline9RegionalB01RepairSolver({ cacheProvider, srj, routes, fixedObstacleRoutes: [], newConnections: srj.connections,
        syntheticConnectionNames: new Set(), drcEvaluator: () => ({ errors, errorsWithCenters: errors }),
        preloadRepairTraceIds: new Set(["route_0"]), connMap: getConnectivityMapFromSimpleRouteJson(srj), colorMap: {}, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 1 })
      repair.solve()
      expect(repair.solved).toBe(true)
      expect(repair.failed).toBe(false)
      expect(repair.getResult().attemptedCandidateCount).toBe(6)
      expect(repair.getResult().fallbackCandidateCount).toBe(1)
      expect(repair.getResult().routes).toEqual(routes)
      const nativeReads = read.mock.calls.filter(([key]) => key.startsWith("intranode-solver:"))
      const nativeWrites = write.mock.calls.filter(([key]) => key.startsWith("intranode-solver:"))
      if (cacheProvider === undefined) {
        expect(nativeReads.length).toBeGreaterThan(0)
        expect(nativeWrites.length).toBeGreaterThan(0)
      } else {
        expect(nativeReads).toHaveLength(0)
        expect(nativeWrites).toHaveLength(0)
        if (cacheProvider !== null) expect(cacheProvider.getAllCacheKeys().some((key) => key.startsWith("intranode-solver:"))).toBe(true)
      }
    }
  } finally {
    read.mockRestore()
    write.mockRestore()
    globalCache.clearCache()
  }
})
