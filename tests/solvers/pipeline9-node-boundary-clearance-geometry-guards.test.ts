import { expect, test } from "bun:test"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("Pipeline9 boundary repair respects physical board and pad geometry", () => {
  const route: HighDensityRoute = {
    connectionName: "trace",
    regionId: "node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -1, y: -0.79, z: 0 },
      { x: 1, y: -0.79, z: 0 },
    ],
  }
  const obstacle: Obstacle = {
    type: "rect",
    center: { x: -0.3, y: -0.54 },
    width: 0.8,
    height: 0.4,
    layers: ["top"],
    connectedTo: [],
  }
  const board: HighDensityBoardGeometry = {
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    outline: [
      { x: -2, y: -2 },
      { x: 2, y: -2 },
      { x: 2, y: 2 },
      { x: -2, y: 2 },
    ],
  }
  const cases: Array<{
    boardGeometry: HighDensityBoardGeometry
    obstacle: Obstacle
    repairAllowed: boolean
  }> = [
    { boardGeometry: board, obstacle, repairAllowed: true },
    {
      boardGeometry: {
        bounds: { minX: -1.1, maxX: 1.1, minY: -1.1, maxY: 1.1 },
      },
      obstacle,
      repairAllowed: false,
    },
    {
      boardGeometry: { ...board, minBoardEdgeClearance: 0.9 },
      obstacle,
      repairAllowed: false,
    },
    {
      boardGeometry: {
        ...board,
        outline: [
          { x: -2, y: -2 },
          { x: -0.2, y: -2 },
          { x: -0.2, y: 0.5 },
          { x: 0.2, y: 0.5 },
          { x: 0.2, y: -2 },
          { x: 2, y: -2 },
          { x: 2, y: 2 },
          { x: -2, y: 2 },
        ],
      },
      obstacle,
      repairAllowed: false,
    },
    {
      boardGeometry: board,
      obstacle: { ...obstacle, ccwRotationDegrees: 30 },
      repairAllowed: false,
    },
  ]
  for (const entry of cases) {
    const params = {
      nodeWithPortPoints: [
        {
          capacityMeshNodeId: "node",
          center: { x: 0, y: 0 },
          width: 2,
          height: 2,
          availableZ: [0, 1],
          portPoints: [],
        },
      ],
      hdRoutes: [route],
      obstacles: [entry.obstacle],
      boardGeometry: entry.boardGeometry,
    }
    const baseline = new Pipeline4HighDensityRepairSolver(params)
    const solver = new Pipeline4HighDensityRepairSolver({
      ...params,
      enableNodeBoundaryClearanceRepair: true,
    })
    baseline.solve()
    solver.solve()
    expect(solver.solved).toBe(true)
    if (entry.repairAllowed) {
      expect(solver.stats.nodeBoundaryClearanceResolvedConflictCount).toBe(1)
    } else {
      expect(solver.stats.nodeBoundaryClearanceCandidateCount).toBe(0)
      expect(solver.getOutput()).toEqual(baseline.getOutput())
    }
  }
})
