import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_Parallel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/AutoroutingPipelineSolver9_Parallel"
import { ParallelHighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelHighDensityForceImproveSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("all async pipeline drivers record worker rejection and preserve its identity", async (): Promise<void> => {
  const board: SimpleRouteJson = {
    bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
    obstacles: [], connections: [], layerCount: 2, minTraceWidth: 0.15,
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node", center: { x: 2.5, y: 2.5 },
    width: 5, height: 5, portPoints: [],
  }
  const route: HighDensityRoute = {
    connectionName: "route", regionId: node.capacityMeshNodeId,
    traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x: 1, y: 1, z: 0 }, { x: 2, y: 2, z: 0 }], vias: [],
  }
  for (const driver of ["stepAsync", "solveAsync", "solveUntilPhaseAsync"] as const) {
    const rejection = new Error(`deliberate startup failure for ${driver}`)
    const pool = new Pipeline9LocalWorkerPool({
      workerFactory: (): Worker => { throw rejection },
    })
    let disposed = false
    const disposePool = pool.dispose.bind(pool)
    pool.dispose = (): void => {
      disposed = true
      disposePool()
    }
    const solver = new AutoroutingPipelineSolver9_Parallel(board, { workerPool: pool })
    solver.currentPipelineStepIndex = solver.pipelineDef.findIndex((step) => step.solverName === "highDensityForceImproveSolver")
    solver.activeSubSolver = new ParallelHighDensityForceImproveSolver({
      nodeWithPortPoints: [node], hdRoutes: [route], workerPool: pool,
    })
    try {
      const execution = driver === "solveUntilPhaseAsync"
        ? solver.solveUntilPhaseAsync("powerTraceExpansionSolver")
        : solver[driver]()
      await expect(execution).rejects.toBe(rejection)
      expect(solver.failed).toBe(true)
      expect(solver.solved).toBe(false)
      expect(solver.error).toContain(rejection.message)
      expect(solver.activeSubSolver?.failed).toBe(true)
      expect(disposed).toBe(false)
      solver.dispose()
      expect(disposed).toBe(false)
    } finally {
      pool.dispose()
    }
  }
})
