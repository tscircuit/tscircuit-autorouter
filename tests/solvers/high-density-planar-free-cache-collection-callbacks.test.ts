import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver as Base } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Future } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

const parent: Node = { x: 0, y: 0, z: 0, f: 0, g: 0, h: 0, parent: null }
const createSolver = (Type: typeof Base, fixedObstacleGeometry: boolean, obstacleX: number): Base => {
  const solver = new Type({
    connectionName: "route", A: { x: -2, y: 0, z: 0 }, B: { x: 2, y: 0, z: 1 },
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    minDistBetweenEnteringPoints: 0.1, fixedObstacleGeometry,
    traceThickness: 0.05, obstacleMargin: 0.05,
    obstacleRoutes: [{ connectionName: "obstacle", traceThickness: 0.15, viaDiameter: 0.3,
      route: [{ x: obstacleX, y: -1, z: 0 }, { x: obstacleX, y: 1, z: 0 }], vias: [] }],
    futureConnections: [{ connectionName: "future", points: [{ x: 0, y: 1, z: 1 }] }],
  })
  solver.cellStep = 0.4
  solver.getNeighbors(parent)
  solver.exploredNodes.clear()
  return solver
}
const neighbors = (solver: Base): unknown => ({
  neighbors: solver.getNeighbors(parent), explored: [...solver.exploredNodes],
})

test("collection callbacks keep clearance calls, mutation order and iterator counts", () => {
  {
    const candidate = createSolver(Base, true, 0.4)
    const reference = createSolver(Base, false, 0.4)
    const calls = [0, 0]
    for (const [index, solver] of [candidate, reference].entries()) {
      const layers = [...solver.availableZ]
      layers[Symbol.iterator] = function* (): ArrayIterator<number> {
        calls[index]++
        solver.traceThickness = 0.8
        for (let layer = 0; layer < layers.length; layer++) yield layers[layer]!
      }
      solver.availableZ = layers
      solver.buildObstacleIndexes()
    }
    expect(neighbors(candidate)).toEqual(neighbors(reference))
    expect(calls[0]).toBeGreaterThan(0)
    expect(calls[0]).toBe(calls[1])
  }

  for (const property of ["obstacleSegmentIndexByLayer", "obstacleSegmentsByLayer"] as const) {
    const candidate = createSolver(Base, true, 0.4)
    const reference = createSolver(Base, false, 0.4)
    const calls = [0, 0]
    let armed = false
    for (const [index, solver] of [candidate, reference].entries()) {
      const map = solver[property] as Map<number, unknown>
      const originalGet = map.get.bind(map)
      map.get = (key: number): unknown => {
        if (armed) {
          calls[index]++
          solver.traceThickness = 0.8
        }
        return originalGet(key)
      }
      // The custom implementation is installed before rebuilding and remains
      // fixed throughout both expansions, within the geometry opt-in contract.
      solver.buildObstacleIndexes()
      solver.getNeighbors(parent)
      solver.exploredNodes.clear()
    }
    armed = true
    expect(neighbors(candidate)).toEqual(neighbors(reference))
    expect(calls[0]).toBeGreaterThan(0)
    expect(calls[0]).toBe(calls[1])
  }

  for (const [property, obstacleX] of [
    ["debug_nodesTooCloseToObstacle", -0.4],
    ["debug_nodePathToParentIntersectsObstacle", -0.2],
  ] as const) {
    const candidate = createSolver(Base, true, obstacleX)
    const reference = createSolver(Base, false, obstacleX)
    const calls = [0, 0]
    for (const [index, solver] of [candidate, reference].entries()) {
      const originalAdd = solver[property].add.bind(solver[property])
      solver[property].add = (key: number): Set<number> => {
        calls[index]++
        solver.traceThickness = 0.8
        return originalAdd(key)
      }
    }
    expect(neighbors(candidate)).toEqual(neighbors(reference))
    expect(calls[0]).toBeGreaterThan(0)
    expect(calls[0]).toBe(calls[1])
  }

  const candidate = createSolver(Future, true, 0.4) as Future
  const reference = createSolver(Future, false, 0.4) as Future
  const calls = [0, 0]
  for (const [index, solver] of [candidate, reference].entries()) {
    const points = [...solver.futureConnectionPoints]
    points[Symbol.iterator] = function* (): ArrayIterator<(typeof points)[number]> {
      calls[index]++
      solver.traceThickness = 0.8
      for (let pointIndex = 0; pointIndex < points.length; pointIndex++) {
        yield points[pointIndex]!
      }
    }
    solver.futureConnectionPoints = points
  }
  expect(neighbors(candidate)).toEqual(neighbors(reference))
  expect(calls[0]).toBeGreaterThan(0)
  expect(calls[0]).toBe(calls[1])
})
