import { expect, test } from "bun:test"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { ParallelHighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelHighDensityForceImproveSolver"
import { ParallelHighDensityRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelHighDensityRepairSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { simplifyPipeline9CollinearRoutePoints } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/simplifyPipeline9CollinearRoutePoints"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { HighDensityRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import input from "../fixtures/am3352-force-improve-dense-grid.json"

test("four workers preserve serial force improvement and repair geometry in original route order", async (): Promise<void> => {
  const originalRoutes = simplifyPipeline9CollinearRoutePoints(input.hdRoutes as HighDensityRoute[])
  const nodes: NodeWithPortPoints[] = []
  const routes: HighDensityRoute[] = []
  for (let copy = 0; copy < 4; copy++) {
    const dx = copy * 30
    const nodeId = `parallel-node-${copy}`
    nodes.push({
      ...input.nodeWithPortPoints[0],
      capacityMeshNodeId: nodeId,
      center: { x: input.nodeWithPortPoints[0].center.x + dx, y: input.nodeWithPortPoints[0].center.y },
      portPoints: input.nodeWithPortPoints[0].portPoints.map((point: PortPoint) => ({ ...point, x: point.x + dx, connectionName: `${copy}-${point.connectionName}` })),
    })
    routes.push(...originalRoutes.map((route) => ({
      ...route,
      connectionName: `${copy}-${route.connectionName}`,
      rootConnectionName: `${copy}-${route.rootConnectionName}`,
      regionId: nodeId,
      route: route.route.map((point) => ({ ...point, x: point.x + dx })),
      vias: route.vias.map((via) => ({ ...via, x: via.x + dx })),
    })))
  }
  const workerPool = new Pipeline9LocalWorkerPool()
  try {
    const forceParams = { nodeWithPortPoints: nodes, hdRoutes: routes, totalStepsPerNode: 20, nodeAssignmentMargin: 0.2 }
    const serialForce = new HighDensityForceImproveSolver(structuredClone(forceParams))
    serialForce.solve()
    const parallelForce = new ParallelHighDensityForceImproveSolver({ ...structuredClone(forceParams), workerPool })
    await parallelForce.solveAsync()
    expect(serialForce.solved).toBe(true)
    expect(parallelForce.solved).toBe(true)
    expect(parallelForce.getOutput()).toEqual(serialForce.getOutput())
    expect(parallelForce.stats).toEqual(serialForce.stats)

    const repairParams = { nodeWithPortPoints: nodes, hdRoutes: serialForce.getOutput(), obstacles: [], repairMargin: 0.2 }
    const serialRepair = new Pipeline4HighDensityRepairSolver(structuredClone(repairParams))
    serialRepair.solve()
    const parallelRepair = new ParallelHighDensityRepairSolver({ ...structuredClone(repairParams), workerPool })
    await parallelRepair.solveAsync()
    expect(serialRepair.solved).toBe(true)
    expect(parallelRepair.solved).toBe(true)
    expect(parallelRepair.getOutput()).toEqual(serialRepair.getOutput())
    expect(parallelRepair.stats).toEqual(serialRepair.stats)
    expect(workerPool.stats.maxActiveWorkers).toBe(4)
  } finally {
    workerPool.dispose()
  }
})
