import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

class CustomPlanarQuerySolver extends SingleHighDensityRouteSolver {
  override getPlanarNeighborObstacleQuery(
    node: Node,
  ): ReturnType<
    SingleHighDensityRouteSolver["getPlanarNeighborObstacleQuery"]
  > {
    const original = super.getPlanarNeighborObstacleQuery(node)
    if (!original) return undefined
    const custom = { segments: [], segmentIds: [] }
    return custom
  }
}

test("shared planar via queries stay lazy and preserve strict bounds, custom queries and via ancestry", () => {
  const options = {
    connectionName: "route",
    minDistBetweenEnteringPoints: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: -1, z: 0 },
    B: { x: 2, y: -1, z: 0 },
    obstacleRoutes: [
      {
        connectionName: "obstacle",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 1, y: -1, z: 0 },
          { x: 1, y: 1, z: 0 },
        ],
        vias: [
          { x: 0.375, y: 0 },
          { x: 1.2, y: 0 },
        ],
      },
    ],
  }
  const solver = new SingleHighDensityRouteSolver(options)
  let searches = 0
  const search = solver.obstacleViaIndex!.search.bind(solver.obstacleViaIndex!)
  solver.obstacleViaIndex!.search = (
    ...args: Parameters<typeof search>
  ): number[] => {
    searches++
    const result = search(...args)
    return result
  }
  const parent: Node = { x: 0, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null }
  const segmentBlocked = { ...parent, x: 1, parent }
  const segmentQuery = solver.getPlanarNeighborObstacleQuery(segmentBlocked)!
  expect(searches).toBe(0)
  expect(
    solver.isNodeTooCloseToObstacle(
      segmentBlocked,
      undefined,
      false,
      segmentQuery,
    ),
  ).toBe(true)
  expect(searches).toBe(0)

  const query = solver.getPlanarNeighborObstacleQuery(parent)!
  expect(searches).toBe(0)
  const onRadius = { ...parent, parent }
  expect(
    solver.isNodeTooCloseToObstacle(onRadius, undefined, false, query),
  ).toBe(false)
  expect(searches).toBe(1)
  const insideRadius = { ...onRadius, x: 1e-12 }
  expect(solver.getNodeKey(insideRadius)).toBe(solver.getNodeKey(onRadius))
  expect(
    solver.isNodeTooCloseToObstacle(insideRadius, undefined, false, query),
  ).toBe(true)
  expect(
    solver.isNodeTooCloseToObstacle(
      { ...onRadius, x: -0.1 },
      undefined,
      false,
      query,
    ),
  ).toBe(false)
  expect(searches).toBe(1)

  // Segment query edits must not alter the independent via-clearance decision.
  query.segments = []
  query.segmentIds = []
  expect(
    solver.isNodeTooCloseToObstacle(insideRadius, undefined, false, query),
  ).toBe(true)
  expect(searches).toBe(1)
  const customQuery = { segments: [], segmentIds: [] }
  expect(
    solver.isNodeTooCloseToObstacle(
      insideRadius,
      undefined,
      false,
      customQuery,
    ),
  ).toBe(true)
  expect(searches).toBe(2)
  expect(solver.isNodeTooCloseToObstacle(insideRadius, 0, false, query)).toBe(
    false,
  )
  expect(searches).toBe(3)
  expect(
    solver.isNodeTooCloseToObstacle(
      { ...onRadius, x: 1.2 },
      undefined,
      false,
      query,
    ),
  ).toBe(true)
  expect(searches).toBe(4)
  expect(
    solver.isNodeTooCloseToObstacle(insideRadius, undefined, true, query),
  ).toBe(true)
  expect(searches).toBe(5)

  const oldViaStart = { ...parent, x: -0.8, y: -0.8 }
  const oldViaEnd = { ...oldViaStart, z: 1, parent: oldViaStart }
  const ownViaArrival = { ...oldViaStart, x: -0.75, parent: oldViaEnd }
  expect(
    solver.isNodeTooCloseToObstacle(ownViaArrival, undefined, true, query),
  ).toBe(true)
  expect(searches).toBe(5)
  expect(
    solver.getPlanarNeighborObstacleQuery({ ...parent, z: 1 }),
  ).toBeUndefined()

  const customSolver = new CustomPlanarQuerySolver(options)
  let customSearches = 0
  const customSearch = customSolver.obstacleViaIndex!.search.bind(
    customSolver.obstacleViaIndex!,
  )
  customSolver.obstacleViaIndex!.search = (
    ...args: Parameters<typeof customSearch>
  ): number[] => {
    customSearches++
    const result = customSearch(...args)
    return result
  }
  const customNode = { ...parent, x: 1, y: 0.8, parent }
  const overriddenQuery =
    customSolver.getPlanarNeighborObstacleQuery(customNode)!
  expect(
    customSolver.isNodeTooCloseToObstacle(
      customNode,
      undefined,
      false,
      overriddenQuery,
    ),
  ).toBe(false)
  expect(
    customSolver.isNodeTooCloseToObstacle(
      customNode,
      undefined,
      false,
      overriddenQuery,
    ),
  ).toBe(false)
  expect(customSearches).toBe(2)

  solver.viaDiameter = 0.6
  expect(
    solver.isNodeTooCloseToObstacle(onRadius, undefined, false, query),
  ).toBe(true)
  expect(searches).toBe(6)
  solver.viaDiameter = 0.3
  solver.obstacleRoutes = [
    {
      connectionName: "replacement",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [],
      vias: [{ x: -1, y: -1 }],
    },
  ]
  solver.buildObstacleIndexes()
  expect(
    solver.isNodeTooCloseToObstacle(insideRadius, undefined, false, query),
  ).toBe(false)
  expect(
    solver.isNodeTooCloseToObstacle(
      { ...onRadius, x: -1, y: -1 },
      undefined,
      false,
      query,
    ),
  ).toBe(true)
})
