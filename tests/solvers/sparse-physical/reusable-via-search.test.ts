import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SparsePhysicalSingleRouteSolver } from "lib/solvers/HighDensitySolver/SparsePhysicalSingleRouteSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { sparseOptions } from "./fixtures"

test("a narrow cell can reach an existing compatible same-net drill without adding a nearby hole", (): void => {
  const via = { x: 0.2933125, y: 0.287 }
  const ancestor: HighDensityIntraNodeRoute = {
    connectionName: "ancestor",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: via.x, y: 0, z: 1 },
      { ...via, z: 1 },
      { ...via, z: 0 },
      { x: via.x, y: 0.574, z: 0 },
    ],
    vias: [via],
  }
  const solver = new SparsePhysicalSingleRouteSolver({
    ...sparseOptions,
    bounds: { minX: 0, maxX: 0.586625, minY: 0, maxY: 0.574 },
    A: { x: via.x, y: 0, z: 1 },
    B: { x: 0.586625, y: via.y, z: 0 },
    traceThickness: 0.1,
    obstacleMargin: 0.15,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    layerCount: 2,
    availableZ: [0, 1],
    connMap: new ConnectivityMap({ net: ["a", "ancestor"] }),
    obstacleRoutes: [ancestor],
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.solvedPath!.vias).toEqual([via])
  let parent: Node | null = null
  for (const point of solver.solvedPath!.route) {
    const current: Node = { ...point, g: 0, h: 0, f: 0, parent }
    if (parent)
      expect(
        solver.isSparseEdgeLegal({ start: parent, end: current, parent }),
      ).toBe(true)
    parent = current
  }
  expect(
    solver.isSparseEdgeLegal({
      start: { x: via.x + 1e-10, y: via.y, z: 0 },
      end: { x: via.x + 1e-10, y: via.y, z: 1 },
    }),
  ).toBe(false)
})
