import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

class UncachedPointClearanceSolver extends SingleHighDensityRouteSolver {
  override isNodeTooCloseToObstacle(
    ...args: Parameters<
      SingleHighDensityRouteSolver["isNodeTooCloseToObstacle"]
    >
  ): boolean {
    // Force the original geometry checks on every call, including repeated
    // coordinates, without changing path costs or search order.
    this.cachedPlanarTraceProximity = Number.NaN
    return super.isNodeTooCloseToObstacle(...args)
  }
}

const point = (x: number, y: number, z: number): Node => ({
  x,
  y,
  z,
  g: 0,
  h: 0,
  f: 0,
  parent: null,
})

test("planar obstacle memo preserves clearance under key collisions, invalidation and complete searches", (): void => {
  const obstacleRoutes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "foreign",
      traceThickness: 0.2,
      viaDiameter: 0.3,
      route: [
        { x: 2.05, y: 1, z: 0 },
        { x: 2.05, y: 9, z: 0 },
      ],
      vias: [{ x: 7, y: 7 }],
    },
  ]
  const options = {
    connectionName: "route",
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    minDistBetweenEnteringPoints: 0.2,
    A: { x: 1, y: 1, z: 0 },
    B: { x: 9, y: 9, z: 0 },
    traceThickness: 0.2,
    obstacleMargin: 0.1,
    obstacleRoutes,
    layerCount: 2,
    captureSearchDebug: true,
  }
  const solver = new SingleHighDensityRouteSolver(options)
  const reference = new UncachedPointClearanceSolver(options)
  const free = point(1.749, 2, 0)
  const blocked = point(1.751, 2, 0)
  expect(solver.getNodeKey(free)).toBe(solver.getNodeKey(blocked))
  expect(solver.isNodeTooCloseToObstacle(free)).toBeFalse()
  expect(solver.isNodeTooCloseToObstacle(blocked)).toBeTrue()

  // More distinct free coordinates than the memo can retain, with layer and
  // rounded-key aliases interspersed among points near traces and vias.
  for (let y = 0; y < 40; y++) {
    for (let x = 0; x < 40; x++) {
      for (const z of [0, 1]) {
        const query = point(x / 4, y / 4, z)
        const expected = reference.isNodeTooCloseToObstacle(query)
        expect(solver.isNodeTooCloseToObstacle(query)).toBe(expected)
        expect(solver.isNodeTooCloseToObstacle({ ...query })).toBe(expected)
      }
    }
  }
  const boundary = point(1.7, 2, 0)
  expect(solver.isNodeTooCloseToObstacle(boundary)).toBeFalse()
  expect(solver.isNodeTooCloseToObstacle(boundary, 0.2)).toBeTrue()
  expect(solver.isNodeTooCloseToObstacle(boundary)).toBeFalse()
  solver.traceThickness = 0.3
  expect(solver.isNodeTooCloseToObstacle(boundary)).toBeTrue()
  solver.traceThickness = 0.2
  expect(solver.isNodeTooCloseToObstacle(boundary)).toBeFalse()
  expect(solver.isNodeTooCloseToObstacle(point(7, 7, 1))).toBeTrue()
  expect(solver.isNodeTooCloseToObstacle(free)).toBeFalse()
  obstacleRoutes[0]!.route[0]!.x = 1.75
  obstacleRoutes[0]!.route[1]!.x = 1.75
  solver.buildObstacleIndexes()
  expect(solver.isNodeTooCloseToObstacle(free)).toBeTrue()

  for (const layerCount of [1, 2, 4]) {
    const params = {
      ...options,
      layerCount,
      B: { ...options.B, z: layerCount - 1 },
    }
    const cached = new SingleHighDensityRouteSolver(params)
    const uncached = new UncachedPointClearanceSolver(params)
    cached.solve()
    uncached.solve()
    expect(cached.solved).toBeTrue()
    expect(cached.failed).toBeFalse()
    expect(cached.solvedPath).toEqual(uncached.solvedPath)
    expect(cached.iterations).toBe(uncached.iterations)
    expect(cached.debug_exploredNodesOrdered).toEqual(
      uncached.debug_exploredNodesOrdered,
    )
  }
})
