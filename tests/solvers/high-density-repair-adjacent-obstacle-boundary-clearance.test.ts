import { expect, test } from "bun:test"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { Pipeline4HighDensityRepairSampleSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSampleSolver"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("high-density repair falls back to boundary repair when subdivided wall-hugging segments collide with an adjacent obstacle", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_46",
    center: { x: -11.78, y: 16.635 },
    width: 6.81,
    height: 2.27,
    availableZ: [0, 1],
    portPoints: [
      {
        portPointId: "pp_start",
        connectionName: "source_trace_3__source_net_3_mst0",
        rootConnectionName: "source_net_3",
        x: -14.764,
        y: 15.5,
        z: 1,
      },
      {
        portPointId: "pp_end",
        connectionName: "source_trace_3__source_net_3_mst0",
        rootConnectionName: "source_net_3",
        x: -9.437,
        y: 15.5,
        z: 1,
      },
    ],
  }

  // Subdivided boundary-hugging polyline produced by HighDensityForceImproveSolver
  // along the bottom wall y = 15.5 where an adjacent 3x3 mounting hole sits.
  const subdividedMidpoints = Array.from({ length: 35 }, (_, index) => ({
    x: -14.3 + index * 0.12,
    y: 15.574,
    z: 1,
  }))
  const route: HighDensityRoute = {
    regionId: "cmn_46",
    connectionName: "source_trace_3__source_net_3_mst0",
    rootConnectionName: "source_net_3",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -14.764, y: 15.5, z: 1 },
      { x: -14.569, y: 15.554, z: 1 },
      ...subdividedMidpoints,
      { x: -9.601, y: 15.554, z: 1 },
      { x: -9.437, y: 15.5, z: 1 },
    ],
  }

  const mountingHoleObstacle: Obstacle = {
    type: "rect",
    center: { x: -12, y: 14 },
    width: 3,
    height: 3,
    layers: ["top", "bottom"],
    connectedTo: [],
  }

  const solver = new Pipeline4HighDensityRepairSolver({
    nodeWithPortPoints: [node],
    hdRoutes: [route],
    obstacles: [mountingHoleObstacle],
    repairMargin: 0.2,
    minimumTraceWidth: 0.15,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.stats.nodeClearanceFinalConflictCount).toBe(0)

  const repairedRoute = solver.getOutput()[0]!
  let minGapOverObstacle = Infinity
  for (let i = 0; i < repairedRoute.route.length - 1; i++) {
    const a = repairedRoute.route[i]!
    const b = repairedRoute.route[i + 1]!
    const dist = segmentToBoxMinDistance(a, b, mountingHoleObstacle)
    minGapOverObstacle = Math.min(
      minGapOverObstacle,
      dist - repairedRoute.traceThickness / 2,
    )
  }
  expect(minGapOverObstacle).toBeGreaterThanOrEqual(0.1 - 1e-6)

  // Verify the worker sample solver produces the exact same repaired result.
  const sampleSolver = new Pipeline4HighDensityRepairSampleSolver({
    sample: solver.sampleEntries[0]!.sample,
    margin: solver.repairMargin,
  })
  sampleSolver.solve()
  expect(sampleSolver.solved).toBe(true)
  expect(
    sampleSolver.getOutput().clearanceStats?.nodeClearanceFinalConflictCount,
  ).toBe(0)
  expect(
    sampleSolver.getOutput().repairedRoutes[0]!.route!.map(({ x, y, z }) => ({
      x,
      y,
      z: z ?? 0,
    })),
  ).toEqual(repairedRoute.route)
})
