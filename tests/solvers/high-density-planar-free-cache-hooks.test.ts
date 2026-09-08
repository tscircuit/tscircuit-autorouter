import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Solver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

const createSolver = (fixedObstacleGeometry: boolean): Solver => new Solver({
  connectionName: "route", A: { x: -2, y: 0, z: 0 }, B: { x: 2, y: 0, z: 1 },
  bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
  minDistBetweenEnteringPoints: 0.1, fixedObstacleGeometry,
  obstacleRoutes: [{ connectionName: "obstacle", traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x: 1, y: -1, z: 0 }, { x: 1, y: 1, z: 0 }], vias: [{ x: 1, y: 0 }] }],
})
const parent: Node = { x: 0, y: 0, z: 0, f: 0, g: 0, h: 0, parent: null }
const neighbors = (solver: Solver): Node[] => {
  solver.exploredNodes.clear()
  return solver.getNeighbors(parent)
}

test("planar cache preserves custom hooks, index getters, direct queries and path-dependent via ancestry", () => {
  for (const method of ["getNodeKey", "isNodeTooCloseToObstacle", "getPlanarObstacleQuery", "getPlanarNeighborObstacleQuery", "doesPathToParentIntersectObstacle"] as const) {
    const candidate = createSolver(true)
    const reference = createSolver(false)
    expect(neighbors(candidate)).toEqual(neighbors(reference))
    const counts = [0, 0]
    for (const [index, solver] of [candidate, reference].entries()) {
      const original = solver[method].bind(solver) as (...args: unknown[]) => unknown
      Object.defineProperty(solver, method, { configurable: true, value: (...args: unknown[]): unknown => {
        counts[index]++
        const result = original(...args)
        if (method === "getNodeKey") return 0
        if (method === "isNodeTooCloseToObstacle" && !args[2]) return true
        if (method === "getPlanarObstacleQuery" || method === "getPlanarNeighborObstacleQuery") {
          return result ? { ...(result as object), segmentIds: [] } : result
        }
        return result
      } })
    }
    expect(neighbors(candidate)).toEqual(neighbors(reference))
    expect(neighbors(candidate)).toEqual(neighbors(reference))
    expect(counts[0]).toBeGreaterThan(0)
    expect(counts[0]).toBe(counts[1])
  }
  const candidate = createSolver(true)
  const reference = createSolver(false)
  const reads = [0, 0]
  for (const [index, solver] of [candidate, reference].entries()) {
    const spatialIndex = solver.obstacleViaIndex!
    const original = spatialIndex.search.bind(spatialIndex)
    Object.defineProperty(spatialIndex, "search", { get: (): typeof original => { reads[index]++; return original } })
  }
  expect(neighbors(candidate)).toEqual(neighbors(reference))
  expect(neighbors(candidate)).toEqual(neighbors(reference))
  expect(reads[0]).toBe(reads[1])
  expect(reads[0]).toBeGreaterThan(0)

  const solver = createSolver(true)
  neighbors(solver)
  neighbors(solver)
  const direct: Node = { ...parent, x: 1, y: 0.8, parent }
  expect(solver.isNodeTooCloseToObstacle(direct, undefined, false, { segments: [], segmentIds: [] })).toBe(false)
  expect(solver.isNodeTooCloseToObstacle(direct, undefined, false)).toBe(true)
  const withoutVia = { ...parent, z: 1, parent }
  const viaAncestor: Node = { ...parent, z: 1, parent }
  const withVia = { ...parent, z: 1, parent: viaAncestor }
  expect(solver.isNodeTooCloseToObstacle(withoutVia, 0.2, true)).toBe(false)
  expect(solver.isNodeTooCloseToObstacle(withVia, 0.2, true)).toBe(true)
})
