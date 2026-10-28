import { expect, spyOn, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

type PlanarQuery = NonNullable<
  Parameters<SingleHighDensityRouteSolver["isNodeTooCloseToObstacle"]>[3]
>

class ControlledKeySolver extends SingleHighDensityRouteSolver {
  forcedKey?: number

  override getNodeKey(node: Node): number {
    return this.forcedKey ?? super.getNodeKey(node)
  }
}

function createSolver(): ControlledKeySolver {
  return new ControlledKeySolver({
    connectionName: "current",
    obstacleRoutes: [
      {
        connectionName: "foreign",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: -1, z: 0 },
          { x: 0, y: 1, z: 0 },
        ],
        vias: [{ x: 4, y: 0 }],
      },
    ],
    bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100 },
    A: { x: -10, y: -10, z: 0 },
    B: { x: 10, y: 10, z: 1 },
    minDistBetweenEnteringPoints: 0.05,
    traceThickness: 0.1,
    obstacleMargin: 0.2,
    availableZ: [0, 1],
    captureSearchDebug: false,
  })
}

test("bounded planar memo preserves exact clearance with aliases, eviction and changing geometry", (): void => {
  const solver = createSolver()
  const reference = createSolver()
  const origin: Node = {
    x: 0,
    y: 0,
    z: 0,
    g: 0,
    h: 0,
    f: 0,
    parent: null,
  }
  const free = { ...origin, x: 2, y: 2 }
  const check = (node: Node, query?: PlanarQuery, margin?: number): boolean => {
    reference.traceThickness = solver.traceThickness
    reference.obstacleMargin = solver.obstacleMargin
    reference.viaDiameter = solver.viaDiameter
    reference.obstacleRoutes = solver.obstacleRoutes
    reference.buildObstacleIndexes()
    const expected = reference.isNodeTooCloseToObstacle(node, margin)
    const actual = solver.isNodeTooCloseToObstacle(node, margin, false, query)
    expect(actual).toBe(expected)
    return actual
  }

  // The origin must not match uninitialized coordinate storage.
  expect(check(origin)).toBe(true)
  const searches = spyOn(solver.obstacleViaIndex!, "search")
  try {
    expect(check(free)).toBe(false)
    expect(check({ ...free })).toBe(false)
    expect(searches).toHaveBeenCalledTimes(1)
    expect(check(origin)).toBe(true)

    const outside = { ...origin, x: 0.3001 }
    const inside = { ...origin, x: 0.2999 }
    expect(solver.getNodeKey(outside)).toBe(solver.getNodeKey(inside))
    expect(check(outside)).toBe(false)
    expect(check(inside)).toBe(true)
    expect(check(outside)).toBe(false)

    solver.forcedKey = 0
    expect(check({ ...origin, z: 1 })).toBe(false)
    expect(check(origin)).toBe(true)
    expect(check({ ...origin, z: 1 })).toBe(false)

    // Exercise replacement beyond the cache capacity, then revisit old points.
    for (let index = 0; index <= 4096; index++) {
      solver.forcedKey = index
      expect(check({ ...free, x: 2 + index / 20 })).toBe(false)
    }
    solver.forcedKey = 0
    const beforeEvictionQuery = searches.mock.calls.length
    expect(check(free)).toBe(false)
    expect(searches.mock.calls.length).toBe(beforeEvictionQuery + 1)
    expect(check(free)).toBe(false)
    expect(searches.mock.calls.length).toBe(beforeEvictionQuery + 1)

    for (const key of [
      -1,
      -1025,
      Number.MAX_SAFE_INTEGER + 1,
      NaN,
      Infinity,
    ]) {
      solver.forcedKey = key
      solver.buildObstacleIndexes()
      const currentSearches = spyOn(solver.obstacleViaIndex!, "search")
      try {
        expect(check(free)).toBe(false)
        expect(check(free)).toBe(false)
        expect(currentSearches).toHaveBeenCalledTimes(
          Number.isSafeInteger(key) ? 1 : 2,
        )
        expect(check(origin)).toBe(true)
      } finally {
        currentSearches.mockRestore()
      }
    }
  } finally {
    searches.mockRestore()
  }

  solver.forcedKey = 0
  // Each larger clearance must invalidate a formerly clear point.
  const nearWire = { ...origin, x: 0.4 }
  expect(check(nearWire)).toBe(false)
  solver.obstacleMargin = 0.4
  expect(check(nearWire)).toBe(true)
  solver.obstacleMargin = 0.2
  expect(check(nearWire)).toBe(false)
  solver.traceThickness = 0.3
  expect(check(nearWire)).toBe(true)
  solver.traceThickness = 0.1
  const nearVia = { ...origin, x: 4.5, z: 1 }
  expect(check(nearVia)).toBe(false)
  solver.viaDiameter = 0.8
  expect(check(nearVia)).toBe(true)
  solver.viaDiameter = 0.3
  expect(check(nearWire, undefined, 0.1)).toBe(false)
  expect(check(nearWire, undefined, 0.4)).toBe(true)

  // A supplied query that cannot cover the point must neither read nor fill it.
  solver.forcedKey = 7
  solver.buildObstacleIndexes()
  const viaSearches = spyOn(solver.obstacleViaIndex!, "search")
  try {
    const incompleteQuery: PlanarQuery = {
      segments: solver.obstacleSegmentsByLayer.get(0)!,
      segmentIds: [0],
      pointQueryProximity: 0.01,
    }
    expect(check(free, incompleteQuery)).toBe(false)
    expect(check(free)).toBe(false)
    expect(viaSearches).toHaveBeenCalledTimes(2)
    expect(check(free, incompleteQuery)).toBe(false)
    expect(viaSearches).toHaveBeenCalledTimes(3)
  } finally {
    viaSearches.mockRestore()
  }

  expect(check(free)).toBe(false)
  solver.obstacleRoutes = [
    {
      connectionName: "new-foreign",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { ...free, y: 1 },
        { ...free, y: 3 },
      ],
      vias: [],
    },
  ]
  solver.buildObstacleIndexes()
  expect(check(free)).toBe(true)
})
