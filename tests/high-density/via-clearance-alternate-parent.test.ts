import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("rejecting one incoming edge leaves its endpoint reachable from a legal parent", (): void => {
  const obstacle: HighDensityIntraNodeRoute = {
    connectionName: "foreign",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0.3, z: 0 },
      { x: 0, y: 0.3, z: 1 },
    ],
    vias: [{ x: 0, y: 0.3 }],
  }
  const solver = new SingleHighDensityRouteSolver({
    connectionName: "signal",
    obstacleRoutes: [obstacle],
    minDistBetweenEnteringPoints: 4,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    A: { x: -4, y: 0, z: 0 },
    B: { x: 4, y: 0, z: 0 },
    traceThickness: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    availableZ: [0],
    captureSearchDebug: false,
  })
  const blockedParent: Node = {
    x: -0.4,
    y: 0,
    z: 0,
    g: 0,
    h: 0,
    f: 0,
    parent: null,
  }
  const safeParent: Node = { ...blockedParent, x: 0.4, y: -0.8 }
  const destination: Node = {
    ...blockedParent,
    x: 0.4,
    parent: blockedParent,
  }
  const destinationKey = solver.getNodeKey(destination)

  expect(solver.cellStep).toBe(0.8)
  expect(solver.isNodeTooCloseToObstacle(destination)).toBe(false)
  expect(solver.doesPathToParentIntersectObstacle(destination)).toBe(true)
  const blockedNeighbors = solver.getNeighbors(blockedParent)
  expect(
    blockedNeighbors.some(
      (neighbor): boolean => solver.getNodeKey(neighbor) === destinationKey,
    ),
  ).toBe(false)
  expect(solver.exploredNodes.has(destinationKey)).toBe(false)

  const safeNeighbors = solver.getNeighbors(safeParent)
  const reachedDestination = safeNeighbors.find(
    (neighbor): boolean =>
      neighbor.x === destination.x &&
      neighbor.y === destination.y &&
      neighbor.z === destination.z,
  )
  expect(reachedDestination).toBeDefined()
  expect(reachedDestination?.parent).toBe(safeParent)
})
