import { expect, test } from "bun:test"
import { distance } from "@tscircuit/math-utils"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("the future-cost solver caches the legacy closest point for each grid node", () => {
  const futurePoints = [
    { x: 2, y: 8, z: 0 },
    { x: 8, y: 2, z: 1 },
    { x: 5, y: 5, z: 0 },
  ]
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    connectionName: "conn-a",
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    A: { x: 1, y: 1, z: 0 },
    B: { x: 9, y: 9, z: 0 },
    traceThickness: 0.2,
    obstacleMargin: 0.1,
    layerCount: 2,
    obstacleRoutes: [],
    futureConnections: [
      { connectionName: "future-conn", points: futurePoints },
    ],
  })

  const nodes: Node[] = [
    { x: 7.9, y: 2.1, z: 1, g: 0, h: 0, f: 0, parent: null },
    { x: 4.9, y: 5.1, z: 0, g: 0, h: 0, f: 0, parent: null },
    { x: 2.1, y: 7.9, z: 1, g: 0, h: 0, f: 0, parent: null },
  ]

  for (const node of nodes) {
    let expectedPoint = futurePoints[0]!
    let expectedDistance = Infinity
    for (const point of futurePoints) {
      const candidateDistance =
        distance(node, point) +
        (node.z !== point.z ? solver.viaPenaltyDistance : 0)
      if (candidateDistance < expectedDistance) {
        expectedDistance = candidateDistance
        expectedPoint = point
      }
    }

    expect(solver.getClosestFutureConnectionPoint(node)).toBe(expectedPoint)
    expect(solver.getClosestFutureConnectionPoint(node)).toBe(expectedPoint)
  }

  const collisionX = Math.round(5 / solver.cellStep) * solver.cellStep
  const collisionPointA = { x: collisionX, y: 5, z: 0 }
  const collisionPointB = {
    x: collisionX + solver.cellStep * 0.4,
    y: 5,
    z: 0,
  }
  const collisionSolver =
    new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
      connectionName: "conn-a",
      minDistBetweenEnteringPoints: 0.2,
      bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
      A: { x: 1, y: 1, z: 0 },
      B: { x: 9, y: 9, z: 0 },
      traceThickness: 0.2,
      obstacleMargin: 0.1,
      layerCount: 2,
      obstacleRoutes: [],
      futureConnections: [
        {
          connectionName: "future-conn",
          points: [collisionPointA, collisionPointB],
        },
      ],
    })
  const collisionNodeA: Node = {
    x: collisionPointA.x,
    y: 5,
    z: 0,
    g: 0,
    h: 0,
    f: 0,
    parent: null,
  }
  const collisionNodeB: Node = {
    ...collisionNodeA,
    x: collisionPointB.x,
  }

  expect(collisionSolver.getNodeKey(collisionNodeA)).toBe(
    collisionSolver.getNodeKey(collisionNodeB),
  )
  expect(collisionSolver.getClosestFutureConnectionPoint(collisionNodeA)).toBe(
    collisionPointA,
  )
  expect(collisionSolver.getClosestFutureConnectionPoint(collisionNodeB)).toBe(
    collisionPointB,
  )
  expect(collisionSolver.getClosestFutureConnectionPoint(collisionNodeA)).toBe(
    collisionPointA,
  )
})
