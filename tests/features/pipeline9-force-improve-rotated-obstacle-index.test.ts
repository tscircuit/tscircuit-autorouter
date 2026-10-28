import { expect, test } from "bun:test"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { Pipeline9HighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityForceImproveSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("force proposal broad phase retains rotated pad corners outside their unrotated box", async () => {
  const route: HighDensityRoute = {
    connectionName: "signal", regionId: "node", traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [0, 0, 1, 1].map((z) => ({ x: 0, y: 2, z })),
    vias: [{ x: 0, y: 2 }],
  }
  const pad: Obstacle = {
    type: "rect", obstacleId: "rotated", center: { x: 0, y: 0 },
    width: 4, height: 0.1, layers: ["top"], connectedTo: ["foreign"],
    ccwRotationDegrees: 45,
  }
  const runtime = {
    async executeAsync(_Solver: unknown, input: { hdRoutes: HighDensityRoute[] }): Promise<unknown> {
      const proposal = structuredClone(input.hdRoutes[0]!)
      proposal.route = proposal.route.map((point) => ({ ...point, x: 1.1, y: 1.1 }))
      proposal.vias = [{ x: 1.1, y: 1.1 }]
      return { routes: [proposal], latestVisualization: {} }
    },
  } as unknown as SolverRuntimeExecutor
  const solver = new Pipeline9HighDensityForceImproveSolver({
    nodeWithPortPoints: [{ capacityMeshNodeId: "node", center: { x: 0, y: 1 },
      width: 8, height: 8, portPoints: [] }],
    hdRoutes: [structuredClone(route)], totalStepsPerNode: 1,
    physicalValidation: {
      connectivityNetMap: { signal: ["signal"], foreign: ["foreign"] },
      layerCount: 2, traceClearance: 0.1, viaHoleDiameter: 0.15,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.1, viaToPadClearance: 0.1,
      boardObstacles: [pad, ...Array.from({ length: 100 }, (_, index) => ({
        ...pad, obstacleId: `distant-${index}`, center: { x: 100 + index, y: 100 },
      }))],
    },
  })
  await solver.solveAsync(runtime)
  expect(solver.solved).toBe(true)
  expect(solver.getOutput()).toEqual([route])
  expect(solver.stats.physicalCandidateRejectionCount).toBe(1)
})
