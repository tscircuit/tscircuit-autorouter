import { expect, spyOn, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("checks shared via-position clearance once for every target layer", (): void => {
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    connectionName: "signal",
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    A: { x: 1, y: 1, z: 0 },
    B: { x: 9, y: 9, z: 0 },
    traceThickness: 0.2,
    obstacleMargin: 0.1,
    layerCount: 6,
    availableZ: [0, 1, 2, 3, 4, 5],
    obstacleRoutes: [],
  })
  const clearanceCheck = spyOn(solver, "isNodeTooCloseToObstacle")
  const node: Node = {
    x: 5,
    y: 5,
    z: 0,
    g: 0,
    h: 0,
    f: 0,
    parent: { x: 5, y: 5, z: 0, g: 0, h: 0, f: 0, parent: null },
  }

  try {
    const viaNeighbors = solver
      .getNeighbors(node)
      .filter((neighbor) => neighbor.z !== node.z)
    const viaClearanceChecks = clearanceCheck.mock.calls.filter(
      ([, , isVia]) => isVia === true,
    )

    expect(viaNeighbors).toHaveLength(5)
    expect(viaClearanceChecks).toHaveLength(1)
  } finally {
    clearanceCheck.mockRestore()
  }
})
