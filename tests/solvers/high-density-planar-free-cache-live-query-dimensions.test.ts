import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver as Solver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

const parent: Node = { x: 0, y: 0, z: 0, f: 0, g: 0, h: 0, parent: null }
const createSolver = (fixedObstacleGeometry: boolean, obstacleX = 0.7): Solver => new Solver({
  connectionName: "route", A: { x: -2, y: 0, z: 0 }, B: { x: 2, y: 0, z: 1 },
  bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
  minDistBetweenEnteringPoints: 0.1, fixedObstacleGeometry,
  traceThickness: 0.05, obstacleMargin: 0.05,
  obstacleRoutes: [{ connectionName: "obstacle", traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x: obstacleX, y: -1, z: 0 }, { x: obstacleX, y: 1, z: 0 }], vias: [] }],
})

test("live width changes cannot cache results from a shared query made for the previous width", () => {
  for (const [property, value, obstacleX] of [["traceThickness", 0.8, 0.7], ["cellStep", 1, 1]] as const) {
  const candidate = createSolver(true, obstacleX)
  const reference = createSolver(false, obstacleX)
  expect(candidate.getNeighbors(parent)).toEqual(reference.getNeighbors(parent))
  for (const solver of [candidate, reference]) {
    const original = solver.setNodeCosts.bind(solver)
    solver.setNodeCosts = (node: Node): void => {
      original(node)
      solver[property] = value
    }
  }
  expect(candidate.getNeighbors(parent)).toEqual(reference.getNeighbors(parent))
  const actual = candidate.getNeighbors(parent)
  const expected = reference.getNeighbors(parent)
  expect(actual).toEqual(expected)
  if (property === "traceThickness") expect(actual).toHaveLength(0)
  else expect(actual.some((node) => node.x === 1 && node.z === 0)).toBe(false)
  expect([...candidate.exploredNodes]).toEqual([...reference.exploredNodes])
  }
})
