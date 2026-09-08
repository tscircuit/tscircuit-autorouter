import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver as Base } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Future } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

const parent: Node = { x: 0, y: 0, z: 0, f: 0, g: 0, h: 0, parent: null }
const createSolver = (Type: typeof Base, fixedObstacleGeometry: boolean): Base => new Type({
  connectionName: "route", A: { x: -2, y: 0, z: 0 }, B: { x: 2, y: 0, z: 1 },
  bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
  minDistBetweenEnteringPoints: 0.1, fixedObstacleGeometry,
  traceThickness: 0.05, obstacleMargin: 0.05,
  obstacleRoutes: [{ connectionName: "obstacle", traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x: 0.7, y: -1, z: 0 }, { x: 0.7, y: 1, z: 0 }], vias: [] }],
  futureConnections: [{ connectionName: "future", points: [{ x: 0.2, y: 1, z: 1 }, { x: 1, y: -1, z: 0 }] }],
})
const neighbors = (solver: Base): unknown => {
  solver.exploredNodes.clear()
  return { neighbors: solver.getNeighbors(parent), explored: [...solver.exploredNodes] }
}

test("each planar cost and edge callback disables cache reuse for its entire expansion", () => {
  for (const Type of [Base, Future]) {
    const methods = ["setNodeCosts", "computeF", "isNodeTooCloseToEdge", ...(Type === Base
      ? ["computeG", "computeH"] : ["getFutureConnectionPenalty", "getClosestFutureConnectionPoint"])]
    for (const method of methods) {
      const candidate = createSolver(Type, true)
      const reference = createSolver(Type, false)
      expect(neighbors(candidate)).toEqual(neighbors(reference))
      const counts = [0, 0]
      for (const [index, solver] of [candidate, reference].entries()) {
        const target = solver as unknown as Record<string, (...args: unknown[]) => unknown>
        const original = target[method]!
        target[method] = function (...args: unknown[]): unknown {
          counts[index]++
          const result = original.apply(solver, args)
          solver.traceThickness = 0.8
          // Restoring a hook mid-expansion still must not activate caching
          // against the earlier, narrower shared obstacle query.
          if (method === "setNodeCosts") target[method] = original
          return result
        }
      }
      for (let repeat = 0; repeat < 3; repeat++) {
        expect(neighbors(candidate)).toEqual(neighbors(reference))
      }
      expect(counts[0]).toBeGreaterThan(0)
      expect(counts[0]).toBe(counts[1])
    }
  }

  for (const method of ["has", "add"] as const) {
    const candidate = createSolver(Future, true)
    const reference = createSolver(Future, false)
    expect(neighbors(candidate)).toEqual(neighbors(reference))
    const counts = [0, 0]
    for (const [index, solver] of [candidate, reference].entries()) {
      if (method === "add") solver.traceThickness = 0.8
      const original = solver.exploredNodes[method].bind(solver.exploredNodes)
      Object.defineProperty(solver.exploredNodes, method, { value: (key: number): unknown => {
        counts[index]++
        solver.traceThickness = 0.8
        return original(key)
      } })
    }
    expect(neighbors(candidate)).toEqual(neighbors(reference))
    expect(neighbors(candidate)).toEqual(neighbors(reference))
    expect(counts[0]).toBeGreaterThan(0)
    expect(counts[0]).toBe(counts[1])
  }

  const candidate = createSolver(Future, true)
  const reference = createSolver(Future, false)
  const reads = [0, 0]
  const getter = Object.getOwnPropertyDescriptor(Base.prototype, "viaPenaltyDistance")!.get!
  for (const [index, solver] of [candidate, reference].entries()) {
    Object.defineProperty(solver, "viaPenaltyDistance", { get: (): number => {
      reads[index]++
      solver.traceThickness = 0.8
      return getter.call(solver)
    } })
  }
  expect(neighbors(candidate)).toEqual(neighbors(reference))
  expect(neighbors(candidate)).toEqual(neighbors(reference))
  expect(reads[0]).toBeGreaterThan(0)
  expect(reads[0]).toBe(reads[1])
})
