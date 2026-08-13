import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const baseOpts = {
  connectionName: "conn-a",
  minDistBetweenEnteringPoints: 0.2,
  bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
  A: { x: 1, y: 1, z: 0 },
  B: { x: 9, y: 9, z: 0 },
  traceThickness: 0.2,
  obstacleMargin: 0.1,
  layerCount: 2,
}

test("SingleHighDensityRouteSolver indexes obstacle segments and vias", () => {
  const obstacleRoutes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "conn-obstacle",
      traceThickness: 0.2,
      viaDiameter: 0.3,
      route: [
        { x: 2, y: 2, z: 0 },
        { x: 8, y: 2, z: 0 },
      ],
      vias: [{ x: 6, y: 6 }],
    },
  ]

  const solver = new SingleHighDensityRouteSolver({
    ...baseOpts,
    obstacleRoutes,
  })

  expect(solver.obstacleSegments.length).toBe(1)
  expect(solver.obstacleVias.length).toBe(1)

  expect(solver.isNodeTooCloseToObstacle({ x: 5, y: 2.1, z: 0 } as any)).toBe(
    true,
  )
  expect(solver.isNodeTooCloseToObstacle({ x: 6, y: 6.05, z: 1 } as any)).toBe(
    true,
  )
})

test("SingleHighDensityRouteSolver ignores connected obstacle segments for clearance/intersection", () => {
  const obstacleRoutes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "conn-connected",
      traceThickness: 0.2,
      viaDiameter: 0.3,
      route: [
        { x: 3, y: 3, z: 0 },
        { x: 7, y: 3, z: 0 },
      ],
      vias: [],
    },
  ]

  const solver = new SingleHighDensityRouteSolver({
    ...baseOpts,
    obstacleRoutes,
    connMap: {
      areIdsConnected: (a: string, b: string) =>
        (a === "conn-a" && b === "conn-connected") ||
        (a === "conn-connected" && b === "conn-a"),
    } as any,
  })

  expect(solver.isNodeTooCloseToObstacle({ x: 5, y: 3.05, z: 0 } as any)).toBe(
    false,
  )

  const intersectingNode = {
    x: 5,
    y: 4,
    z: 0,
    parent: { x: 5, y: 2, z: 0 },
  }
  expect(
    solver.doesPathToParentIntersectObstacle(intersectingNode as any),
  ).toBe(false)
})

test("SingleHighDensityRouteSolver respects availableZ when generating via neighbors", () => {
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    ...baseOpts,
    A: { x: 5, y: 5, z: 1 },
    B: { x: 7, y: 7, z: 1 },
    obstacleRoutes: [],
    availableZ: [1],
    layerCount: 2,
  })

  const neighbors = solver.getNeighbors({
    x: 5,
    y: 5,
    z: 1,
    g: 0,
    h: 0,
    f: 0,
    parent: { x: 5, y: 5, z: 1, g: 0, h: 0, f: 0, parent: null },
  } as any)

  expect(neighbors.every((neighbor) => neighbor.z === 1)).toBe(true)
})

test("Future-cost solver rejects vias that violate future via-to-trace clearance", () => {
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    ...baseOpts,
    A: { x: 5, y: 5, z: 0 },
    B: { x: 7, y: 7, z: 1 },
    obstacleRoutes: [],
    futureConnections: [
      {
        connectionName: "future-conn",
        points: [
          { x: 0, y: 5.3, z: 0 },
          { x: 10, y: 5.3, z: 0 },
        ],
      },
    ],
  })

  const currentNode = {
    x: 5,
    y: 5,
    z: 0,
    g: 0,
    h: 0,
    f: 0,
    parent: { x: 5, y: 5, z: 0, g: 0, h: 0, f: 0, parent: null },
  }

  expect(
    solver.isNodeTooCloseToObstacle(
      currentNode as any,
      solver.viaDiameter / 2 + solver.obstacleMargin / 2,
      true,
    ),
  ).toBe(true)

  const neighbors = solver.getNeighbors(currentNode as any)
  expect(neighbors.some((neighbor) => neighbor.z !== currentNode.z)).toBe(false)
})

test("SingleHighDensityRouteSolver numeric node keys are collision-free across its grid", () => {
  const solver = new SingleHighDensityRouteSolver({
    ...baseOpts,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    A: { x: -1, y: -0.8, z: 0 },
    B: { x: -1, y: 0.8, z: 0 },
    obstacleRoutes: [],
    availableZ: [0, 2, 5],
    captureSearchDebug: false,
  })
  const minXIndex = Math.round(solver.bounds.minX / solver.cellStep)
  const maxXIndex = Math.round(solver.bounds.maxX / solver.cellStep)
  const minYIndex = Math.round(solver.bounds.minY / solver.cellStep)
  const maxYIndex = Math.round(solver.bounds.maxY / solver.cellStep)
  const keys = new Set<number>()

  for (const z of solver.availableZ) {
    for (let xIndex = minXIndex; xIndex <= maxXIndex; xIndex++) {
      for (let yIndex = minYIndex; yIndex <= maxYIndex; yIndex++) {
        const key = solver.getNodeKey({
          x: xIndex * solver.cellStep,
          y: yIndex * solver.cellStep,
          z,
        } as any)
        expect(keys.has(key)).toBe(false)
        keys.add(key)
      }
    }
  }
})

test("SingleHighDensityRouteSolver can skip search visualization history", () => {
  const createSolver = (captureSearchDebug?: boolean) =>
    new SingleHighDensityRouteSolver({
      ...baseOpts,
      A: { x: 0, y: 1, z: 0 },
      B: { x: 0, y: 9, z: 0 },
      obstacleRoutes: [],
      captureSearchDebug,
    })

  const headlessSolver = createSolver(false)
  headlessSolver.step()
  expect(headlessSolver.debug_exploredNodesOrdered).toHaveLength(0)

  const debugSolver = createSolver()
  debugSolver.step()
  expect(debugSolver.debug_exploredNodesOrdered.length).toBeGreaterThan(0)
})

test("SingleHighDensityRouteSolver caches immutable via ancestry", () => {
  const solver = new SingleHighDensityRouteSolver({
    ...baseOpts,
    A: { x: 0, y: 1, z: 0 },
    B: { x: 0, y: 9, z: 0 },
    obstacleRoutes: [],
    captureSearchDebug: false,
  })
  const root = { x: 0, y: 1, z: 0, parent: null }
  const firstVia = { x: 0, y: 1, z: 1, parent: root }
  const sameLayer = { x: 0.2, y: 1, z: 1, parent: firstVia }
  const secondVia = { x: 0.2, y: 1, z: 0, parent: sameLayer }

  const firstResult = solver.getViasInNodePath(secondVia as any)
  expect(firstResult).toEqual([
    { x: 0.2, y: 1 },
    { x: 0, y: 1 },
  ])
  expect(solver.getViasInNodePath(secondVia as any)).toBe(firstResult)
})
