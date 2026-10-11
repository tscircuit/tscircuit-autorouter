import { expect, test } from "bun:test"
import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { ParallelMultiSimplifiedPathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiSimplifiedPathSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { getParallelPathBatches } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/getParallelPathBatches"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("directed path jobs preserve native order while overlapping later paths await both predecessors", async (): Promise<void> => {
  const routes: HighDensityRoute[] = [
    { connectionName: "left", traceThickness: 0.15, viaDiameter: 0.3,
      route: [{ x: -5, y: 0, z: 3 }, { x: -4, y: 0, z: 3 }, { x: -4, y: 1, z: 3 }, { x: -3, y: 1, z: 3 }], vias: [] },
    { connectionName: "right", traceThickness: 0.2, viaDiameter: 0.4,
      route: [{ x: 3, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }], vias: [] },
    { connectionName: "bridge", traceThickness: 0.15, viaDiameter: 0.3,
      route: [{ x: -5, y: 0.2, z: 0 }, { x: -5, y: -1, z: 0 }, { x: 5, y: -1, z: 0 }, { x: 5, y: 0.2, z: 0 }], vias: [] },
    { connectionName: "last", traceThickness: 0.15, viaDiameter: 0.3,
      route: [{ x: -4, y: 0.3, z: 0 }, { x: -4, y: -2, z: 0 }, { x: 4, y: -2, z: 0 }, { x: 4, y: 0.3, z: 0 }], vias: [] },
  ]
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    for (const useTraceWidthAwareClearance of [false, true]) {
      for (const enableVertexShortcuts of [false, true]) {
        const config = { unsimplifiedHdRoutes: structuredClone(routes), obstacles: [
          { type: "rect" as const, center: { x: 0, y: -0.5 }, width: 0.5, height: 0.5, layers: ["top"], connectedTo: [] },
        ], connMap: new ConnectivityMap({}), useTraceWidthAwareClearance, enableVertexShortcuts }
        const serial = new MultiSimplifiedPathSolver(config)
        serial.solve()
        const parallel = new ParallelMultiSimplifiedPathSolver({ ...config, workerPool: pool, workerCount: 4 })
        expect(getParallelPathBatches(routes, useTraceWidthAwareClearance, 4).interactionComponentCount).toBe(1)
        expect(parallel.hasParallelWork).toBe(true)
        expect(parallel.dependencies.predecessors).toEqual([[], [], [0, 1], [0, 1, 2]])
        while (!parallel.solved && !parallel.failed) {
          parallel.step()
          await Promise.all(parallel.pendingEffects!.map((effect) => effect.promise))
        }
        expect(parallel.solved).toBe(true)
        expect(parallel.simplifiedHdRoutes).toEqual(serial.simplifiedHdRoutes)
        expect(parallel.stats.nativePathSteps).toBe(serial.iterations)
      }
    }
    expect(pool.stats.maxActiveWorkers).toBe(2)
    expect(pool.stats.tasksCompleted).toBe(16)
  } finally {
    pool.dispose()
  }
})
