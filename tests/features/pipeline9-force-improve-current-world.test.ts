import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("ordered force proposals are checked against already accepted neighboring copper", async () => {
  const routes: HighDensityRoute[] = [0, 2].map((y, index) => ({
    connectionName: `route-${index}`,
    rootConnectionName: `owner-${index}`,
    regionId: `node-${index}`,
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [-2, -1, 1, 2].map((x) => ({ x, y, z: 0 })),
    vias: [],
  }))
  const runtime = {
    async executeAsync(_Solver: unknown, input: { hdRoutes: HighDensityRoute[] }): Promise<unknown> {
      const route = structuredClone(input.hdRoutes[0]!)
      const y = route.connectionName === "route-0" ? 1 : 1.1
      route.route[1]!.y = y
      route.route[2]!.y = y
      return { routes: [route], latestVisualization: {} }
    },
  } as unknown as SolverRuntimeExecutor
  const solver = new Pipeline9HighDensityForceImproveSolver({
    nodeWithPortPoints: [0, 2].map((y, index) => ({
      capacityMeshNodeId: `node-${index}`,
      center: { x: 0, y }, width: 6, height: 2, portPoints: [],
    })),
    hdRoutes: structuredClone(routes),
    totalStepsPerNode: 1,
    physicalValidation: {
      connectivityNetMap: { "owner-0": ["route-0"], "owner-1": ["route-1"] },
      layerCount: 2,
      traceClearance: 0.1,
      viaHoleDiameter: 0.15,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
      boardObstacles: [],
      viaToPadClearance: 0.1,
    },
  })
  await solver.solveAsync(runtime)
  expect(solver.solved).toBe(true)
  expect(solver.getOutput()[0]!.route[1]!.y).toBe(1)
  expect(solver.getOutput()[1]).toEqual(routes[1])
  expect(solver.stats.physicalCandidateRejectionCount).toBe(1)
  expect(solver.stats.improvedRouteCount).toBe(1)
})
