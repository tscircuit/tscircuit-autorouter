import { expect, test } from "bun:test"
import { Pipeline9ParallelHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9ParallelHighDensitySolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { validateFirstValidHighDensityRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/validateFirstValidHighDensityRoutes"
import { createFirstValidFrontierFixture } from "tests/fixtures/first-valid-frontier-fixture"

test("stage-level generic and A13 node competitors share four workers and cancel every loser", async (): Promise<void> => {
  const { params, nodes } = createFirstValidFrontierFixture(6)
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    const solver = new Pipeline9ParallelHighDensitySolver({ ...params, workerPool: pool, highDensityPolicy: "first-valid" })
    while (!solver.solved && !solver.failed) {
      solver.step()
      if (solver.pendingEffects?.length) await Promise.all(solver.pendingEffects.map((effect) => effect.promise))
    }
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.routes).toHaveLength(12)
    while (solver.stats.firstValidNodeFrontierStats.candidateWork.length < 12) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
    expect(pool.stats.maxActiveWorkers).toBe(4)
    expect(solver.stats.firstValidNodeFrontierStats.pairedNodeCount).toBe(6)
    expect(solver.stats.firstValidNodeFrontierStats.winners).toHaveLength(6)
    expect(solver.stats.firstValidNodeFrontierStats.loserCancellationSignals).toBe(6)
    expect(solver.stats.firstValidNodeFrontierStats.candidateWork).toHaveLength(12)
    for (const node of nodes) {
      const routes = solver.routes.filter((route) => node.portPoints.some((port) => port.connectionName === route.connectionName))
      expect(validateFirstValidHighDensityRoutes({ routes, node, connMap: params.connMap, traceWidth: 0.15,
        viaDiameter: 0.3, obstacleMargin: 0.1, layerCount: 2, obstacles: [] })).toEqual({ valid: true })
      expect(routes.every((route) => route.startPcbPortId !== undefined && route.endPcbPortId !== undefined)).toBe(true)
    }
  } finally { pool.dispose() }
})
