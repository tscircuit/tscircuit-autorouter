import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getParallelPathBatches } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/getParallelPathBatches"
import { ParallelMultiSimplifiedPathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiSimplifiedPathSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("clearance-boundary components retain interacting routes and serial output order", async (): Promise<void> => {
  const viaRoute: HighDensityRoute = {
    connectionName: "via-a", traceThickness: 0.2, viaDiameter: 0.6,
    route: [
      { x: 0, y: 0, z: 0, pcb_port_id: "start" },
      { x: 0.2, y: 0.2, z: 0, traceThickness: 0.5 },
      { x: 0.5, y: 1, z: 0 }, { x: 0.5, y: 1, z: 1 },
      { x: 0.75, y: 1.7, z: 1 },
      { x: 1, y: 2, z: 1, pcb_port_id: "end" },
    ],
    vias: [{ x: 0.5, y: 1 }],
  }
  const peerRoute: HighDensityRoute = {
    connectionName: "peer-a", traceThickness: 0.4, viaDiameter: 0.3,
    route: [
      { x: 0.2, y: -0.1, z: 1 },
      { x: 0.9, y: 0.8, z: 1, traceThickness: 0.45 },
      { x: 1.2, y: 2.1, z: 1 },
    ],
    vias: [],
  }
  const rightOffset = 2.000001
  const routes: HighDensityRoute[] = [
    viaRoute,
    { ...viaRoute, connectionName: "via-b", route: viaRoute.route.map((point) => ({ ...point, x: point.x + rightOffset })), vias: viaRoute.vias.map((via) => ({ ...via, x: via.x + rightOffset })) },
    peerRoute,
    { ...peerRoute, connectionName: "peer-b", route: peerRoute.route.map((point) => ({ ...point, x: point.x + rightOffset })) },
    { ...peerRoute, connectionName: "last", route: peerRoute.route.map((point) => ({ ...point, x: point.x + 3.800002 })) },
  ]
  const pool = new Pipeline9LocalWorkerPool()
  try {
    for (const useTraceWidthAwareClearance of [false, true]) {
      // The largest radius is 0.3 mm. Expanded boxes overlap at a raw
      // gap of 0.8 mm; these components sit only 0.000001 mm beyond it.
      const groups = getParallelPathBatches(routes, useTraceWidthAwareClearance, pool.workerCount)
      expect(groups.interactionComponentCount).toBe(3)
      expect(groups.batches).toEqual([[0, 2], [1, 3], [4]])
      for (const movement of [-0.000002, -1]) {
        const interacting = routes.map((route, index) => index === 1 || index === 3 ? {
          ...route,
          route: route.route.map((point) => ({ ...point, x: point.x + movement })),
          vias: route.vias.map((via) => ({ ...via, x: via.x + movement })),
        } : route)
        const closeGroups = getParallelPathBatches(interacting, useTraceWidthAwareClearance, pool.workerCount)
        expect(closeGroups.interactionComponentCount).toBe(2)
        expect(closeGroups.batches).toContainEqual([0, 1, 2, 3])
      }
      const config = {
        unsimplifiedHdRoutes: structuredClone(routes),
        otherHdRoutes: [{ ...peerRoute, connectionName: "fixed", route: peerRoute.route.map((point) => ({ ...point, y: point.y + 3 })) }],
        obstacles: [],
        connMap: new ConnectivityMap(Object.fromEntries(routes.map((route) => [route.connectionName, [route.connectionName]]))),
        outline: [{ x: -1, y: -1 }, { x: 6, y: -1 }, { x: 6, y: 6 }, { x: -1, y: 6 }],
        minBoardEdgeClearance: 0.23,
        defaultViaDiameter: 0.6,
        useTraceWidthAwareClearance,
        enableVertexShortcuts: true,
      }
      const serial = new MultiSimplifiedPathSolver(config)
      serial.solve()
      const parallel = new ParallelMultiSimplifiedPathSolver({ ...config, workerPool: pool, workerCount: pool.workerCount })
      while (!parallel.solved && !parallel.failed) {
        parallel.step()
        await Promise.all(parallel.pendingEffects!.map((effect) => effect.promise))
      }
      expect(serial.solved).toBe(true)
      expect(parallel.solved).toBe(true)
      expect(parallel.simplifiedHdRoutes).toEqual(serial.simplifiedHdRoutes)
      expect(parallel.simplifiedHdRoutes.map((route) => route.connectionName)).toEqual(routes.map((route) => route.connectionName))
    }
    expect(pool.stats.tasksCompleted).toBe(10)
    expect(pool.stats.maxActiveWorkers).toBeGreaterThanOrEqual(3)
    expect(pool.stats.maxActiveWorkers).toBeLessThanOrEqual(4)
  } finally {
    pool.dispose()
  }
})
