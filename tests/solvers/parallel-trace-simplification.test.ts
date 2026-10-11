import { expect, test } from "bun:test"
import { TraceSimplificationSolver } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ParallelTraceSimplificationSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelTraceSimplificationSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { getParallelPathBatches } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/getParallelPathBatches"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("parallel independent path components preserve serial crossing-via and width-aware cleanup", async (): Promise<void> => {
  const original: HighDensityRoute[] = [
    {
      connectionName: "detour", traceThickness: 0.15, viaDiameter: 0.4,
      route: [
        { x: -3, y: 3, z: 0, pcb_port_id: "detour-start" },
        { x: -2, y: 3, z: 0 }, { x: -2, y: 3, z: 1 },
        { x: -2, y: -2, z: 1 }, { x: -1, y: -3, z: 1 },
        { x: -1, y: -3, z: 0 }, { x: 1, y: -5, z: 0, pcb_port_id: "detour-end" },
      ],
      vias: [{ x: -2, y: 3 }, { x: -1, y: -3 }],
    },
    {
      connectionName: "transition", traceThickness: 0.15, viaDiameter: 0.4,
      route: [
        { x: 0, y: 4, z: 1, pcb_port_id: "transition-start" },
        { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 },
        { x: -3, y: 0, z: 0, pcb_port_id: "transition-end" },
      ],
      vias: [{ x: 0, y: 0 }],
    },
  ]
  const routes: HighDensityRoute[] = original.flatMap((route) =>
    Array.from({ length: 4 }, (_, copy) => ({
      ...route,
      connectionName: `${copy}-${route.connectionName}`,
      route: route.route.map((point) => ({ ...point, x: point.x + copy * 20, ...(point.pcb_port_id ? { pcb_port_id: `${copy}-${point.pcb_port_id}` } : {}) })),
      vias: route.vias.map((via) => ({ ...via, x: via.x + copy * 20 })),
    })),
  )
  const workerPool = new Pipeline9LocalWorkerPool()
  try {
    const groups = getParallelPathBatches(routes, true, 4)
    expect(groups.interactionComponentCount).toBe(4)
    expect(groups.batches).toHaveLength(4)
    for (const useTraceWidthAwareClearance of [false, true]) {
      const config = {
        hdRoutes: routes,
        obstacles: [],
        connMap: new ConnectivityMap(Object.fromEntries(routes.map((route) => [route.connectionName, [route.connectionName]]))),
        colorMap: {}, defaultViaDiameter: 0.4, layerCount: 2,
        enableCrossingViaReduction: true,
        useTraceWidthAwareClearance,
        enableVertexShortcuts: true,
        preserveRouteEndpoints: true,
        otherHdRoutes: [{ connectionName: "fixed", traceThickness: 0.1, viaDiameter: 0.5, route: [{ x: 100, y: -1, z: 0 }, { x: 100, y: 1, z: 0 }], vias: [] }],
      }
      const serial = new TraceSimplificationSolver(config)
      serial.solve()
      const parallel = new ParallelTraceSimplificationSolver({ ...config, workerPool, workerCount: workerPool.workerCount })
      await parallel.solveAsync()
      expect(serial.solved).toBe(true)
      expect(parallel.solved).toBe(true)
      expect(parallel.simplifiedHdRoutes).toEqual(serial.simplifiedHdRoutes)
      expect(parallel.simplifiedHdRoutes.reduce((total, route) => total + route.vias.length, 0)).toBe(4)
      expect(parallel.simplificationPipelineLoops).toBe(serial.simplificationPipelineLoops)
      expect(parallel.stats).toEqual({
        pathSimplificationPhaseCount: 2,
        parallelPathBatchCountMax: 4,
        interactionComponentCountMax: 4,
        componentJobs: 8,
      })
      const oneBatch = new ParallelTraceSimplificationSolver({ ...config, workerPool, workerCount: 1 })
      await oneBatch.solveAsync()
      expect(oneBatch.simplifiedHdRoutes).toEqual(serial.simplifiedHdRoutes)
      expect(oneBatch.simplificationPipelineLoops).toBe(serial.simplificationPipelineLoops)
      expect(oneBatch.MAX_ITERATIONS).toBe(serial.MAX_ITERATIONS)
      expect(oneBatch.MAX_SIMPLIFICATION_PIPELINE_LOOPS).toBe(serial.MAX_SIMPLIFICATION_PIPELINE_LOOPS)
      expect(oneBatch.stats).toEqual({
        pathSimplificationPhaseCount: 2,
        parallelPathBatchCountMax: 1,
        interactionComponentCountMax: 4,
        componentJobs: 0,
      })
    }
    expect(workerPool.stats.maxActiveWorkers).toBe(4)
  } finally {
    workerPool.dispose()
  }
})
