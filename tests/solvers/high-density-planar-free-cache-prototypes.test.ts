import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver as Base } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Solver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

const parent: Node = { x: 0, y: 0, z: 0, f: 0, g: 0, h: 0, parent: null }
const createSolver = (fixedObstacleGeometry: boolean): Solver => new Solver({
  connectionName: "route", A: { x: -2, y: 0, z: 0 }, B: { x: 2, y: 0, z: 1 },
  bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
  minDistBetweenEnteringPoints: 0.1, fixedObstacleGeometry,
  obstacleRoutes: [{ connectionName: "obstacle", traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x: 1, y: -1, z: 0 }, { x: 1, y: 1, z: 0 }], vias: [] }],
})

test("prototype hooks patched before construction remain observable and cannot become cache defaults", () => {
  for (const [prototype, method] of [
    [Base.prototype, "isNodeTooCloseToObstacle"],
    [Solver.prototype, "isNodeTooCloseToObstacle"],
    [Base.prototype, "getPlanarObstacleQuery"],
    [Base.prototype, "getPlanarNeighborObstacleQuery"],
    [Base.prototype, "doesPathToParentIntersectObstacle"],
  ] as const) {
    const original = prototype[method]
    const counts = new Map<Base, number>()
    Object.defineProperty(prototype, method, { configurable: true, writable: true,
      value: function (this: Base, ...args: unknown[]): unknown {
        counts.set(this, (counts.get(this) ?? 0) + 1)
        return (original as (...args: unknown[]) => unknown).apply(this, args)
      },
    })
    try {
      const candidate = createSolver(true)
      const reference = createSolver(false)
      if (method === "getPlanarObstacleQuery") {
        candidate.NEARBY_SEGMENT_CLEARANCE = 0.8
        reference.NEARBY_SEGMENT_CLEARANCE = 0.8
      }
      counts.clear()
      expect(candidate.getNeighbors(parent)).toEqual(reference.getNeighbors(parent))
      expect(candidate.getNeighbors(parent)).toEqual(reference.getNeighbors(parent))
      expect(counts.get(candidate)).toBeGreaterThan(0)
      expect(counts.get(candidate)).toBe(counts.get(reference))
      expect((candidate as unknown as { planarFreeCache: unknown }).planarFreeCache).toBeUndefined()
    } finally {
      Object.defineProperty(prototype, method, { configurable: true, writable: true, value: original })
    }
  }
})
