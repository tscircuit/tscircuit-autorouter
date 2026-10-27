import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("archived copper revises two conflicting geometries and publishes only after native validation", () => {
  const connections = [
    { connectionName: "a", points: [[-2, 0], [2, 0]] },
    { connectionName: "b", points: [[0, -1], [0, 1]] },
    { connectionName: "c", points: [[-1, 2], [1, 2]] },
  ]
  const solver = new PriorityDagIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "region", center: { x: 0, y: 0 }, width: 8, height: 6,
      availableZ: [0, 1],
      portPoints: connections.flatMap(({ connectionName, points }) =>
        points.map(([x, y]) => ({ x, y, z: 0, connectionName }))),
    },
    copperCandidateSearch: true, priorityFamilySize: 6, traceWidth: 0.1,
    viaDiameter: 0.3, obstacleMargin: 0.1, layerCount: 2, captureSearchDebug: false,
  })
  const state = {
    ancestors: [new Set<number>(), new Set<number>(), new Set<number>()],
    witnesses: Array(3).fill(undefined),
  }
  const route = (connectionName: string, points: number[][]): HighDensityIntraNodeRoute => ({
    connectionName, rootConnectionName: undefined, regionId: "region",
    traceThickness: 0.1, viaDiameter: 0.3,
    route: points.map(([x, y]) => ({ x, y, z: 0 })), vias: [],
  })
  const store = Reflect.get(solver, "storeRoute").bind(solver)
  // Domains contain legal alternatives collected from different earlier plans.
  // Native task order is c,b,a. The newest b and a choices are incompatible.
  store(route("c", [[-1, 2], [1, 2]]), state, 0)
  const b = route("b", [[0, -1], [3, -1], [3, 1], [0, 1]])
  store(b, state, 1)
  store(route("b", [[0, -1], [0, 1]]), state, 1)
  const a = route("a", [[-2, 0], [2, 0]])
  store(a, state, 2)
  store(route("a", [[-2, 0], [-2, 2], [2, 2], [2, 0]]), state, 2)
  Reflect.set(solver, "current", state)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.priorityDiagnostics.copperCandidateRevisedSelections).toBe(2)
  expect(solver.priorityDiagnostics.copperCandidateAssignmentsPublished).toBe(1)
  expect(solver.priorityDiagnostics.copperCandidateRejectedChoices).toBeGreaterThan(0)
  expect(solver.solvedRoutes.find((value) => value.connectionName === "a")?.route).toEqual(a.route)
  expect(solver.solvedRoutes.find((value) => value.connectionName === "b")?.route).toEqual(b.route)
  expect(solver.solvedRoutes).toHaveLength(3)
})
