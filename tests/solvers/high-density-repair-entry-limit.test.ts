import { expect, test } from "bun:test"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("repair entry limit counts eligible route groups before materializing samples", () => {
  let portPointReads = 0
  const nodes: NodeWithPortPoints[] = [0, 10, 20, 30].map((x, index) => ({
    capacityMeshNodeId: `node-${index}`,
    center: { x, y: 0 },
    width: 2,
    height: 2,
    get portPoints(): NodeWithPortPoints["portPoints"] {
      portPointReads++
      return []
    },
  }))
  const routes: HighDensityRoute[] = [10, 10, 10, 40, 20].map((x, index) => ({
    connectionName: `route-${index}`,
    ...(index < 2 ? { regionId: nodes[0].capacityMeshNodeId } : {}),
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: x - 0.5, y: 0, z: 0 },
      { x: x + 0.5, y: 0, z: 0 },
    ],
    vias: [],
  }))
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: 20, y: 0 },
      width: 2,
      height: 2,
      layers: ["top", "bottom"],
      connectedTo: [routes[4].connectionName],
    },
  ]

  for (const [maxSampleEntries, skipped] of [
    [undefined, false],
    [0, true],
    [1, true],
    [2, false],
    [3, false],
    [-1, true],
    [Number.POSITIVE_INFINITY, false],
    [Number.NaN, false],
  ] as const) {
    portPointReads = 0
    const solver = new Pipeline4HighDensityRepairSolver({
      nodeWithPortPoints: nodes,
      hdRoutes: routes,
      obstacles,
      maxSampleEntries,
    })

    expect(portPointReads).toBe(skipped ? 0 : 2)
    expect(solver.stats).toEqual({
      sampleCount: skipped ? 0 : 2,
      skippedSampleCount: skipped ? 2 : 0,
      repairedNodeCount: 0,
      repairedRouteCount: 0,
    })
    expect(solver.MAX_ITERATIONS).toBe(100_000)
    expect(solver.sampleEntries.map((entry) => entry.routeIndexes)).toEqual(
      skipped ? [] : [[0, 1], [2]],
    )
    expect(solver.sampleEntries.map((entry) => entry.node)).toEqual(
      skipped ? [] : [nodes[0], nodes[1]],
    )
    expect(solver.solved).toBe(false)
    if (skipped) {
      solver.step()
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      expect(solver.activeSubSolver).toBeNull()
      expect(solver.stats.skippedSampleCount).toBe(2)
    }
    expect(solver.getOutput()).toEqual(routes)
    solver.getOutput().forEach((route, index) => {
      expect(route).toBe(routes[index])
    })
  }

  for (const maxSampleEntries of [undefined, -1, 0]) {
    const solver = new Pipeline4HighDensityRepairSolver({
      nodeWithPortPoints: nodes,
      hdRoutes: [],
      obstacles,
      maxSampleEntries,
    })
    expect(solver.sampleEntries).toEqual([])
    expect(solver.stats).toEqual({
      sampleCount: 0,
      skippedSampleCount: 0,
      repairedNodeCount: 0,
      repairedRouteCount: 0,
    })
    solver.step()
    expect(solver.solved).toBe(true)
  }
})
