import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { createIntraNodePhysicalPairProblem } from "../fixtures/intraNodePhysicalPairs"

test("post-route repair requeues every original physical pair without flattening same-name tasks", (): void => {
  const { node, pairs, params } = createIntraNodePhysicalPairProblem()
  const before = structuredClone(node)
  const solver = new IntraNodeRouteSolver(params)
  const originalTasks = structuredClone(solver.unsolvedConnections)
  const retainedRoute: HighDensityIntraNodeRoute = {
    connectionName: "unrelated-net",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 1.5, z: 0 },
      { x: 1, y: 1.5, z: 0 },
    ],
    vias: [],
  }
  solver.solvedRoutes = [
    ...pairs.map(
      (pair): HighDensityIntraNodeRoute => ({
        connectionName: "paired-net",
        rootConnectionName: "paired-root",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: pair.map(({ x, y, z }): { x: number; y: number; z: number } => ({
          x,
          y,
          z,
        })),
        vias: [],
      }),
    ),
    retainedRoute,
  ]
  solver.unsolvedConnections = []
  expect(solver["queueConnectionForPostrouteRepair"]("paired-net")).toBe(true)
  expect(solver.solvedRoutes).toEqual([retainedRoute])
  expect(solver.solvedRoutes[0]).toBe(retainedRoute)
  expect(solver.unsolvedConnections).toEqual(originalTasks)
  expect(solver.unsolvedConnections).toHaveLength(2)
  expect(solver.rerouteAttemptsByConnection.get("paired-net")).toBe(1)

  solver.unsolvedConnections[0]!.points[0]!.x = -0.5
  solver.unsolvedConnections = []
  expect(solver["queueConnectionForPostrouteRepair"]("paired-net")).toBe(true)
  expect(solver.unsolvedConnections).toEqual(originalTasks)
  expect(solver.rerouteAttemptsByConnection.get("paired-net")).toBe(2)
  expect(node).toEqual(before)
})
