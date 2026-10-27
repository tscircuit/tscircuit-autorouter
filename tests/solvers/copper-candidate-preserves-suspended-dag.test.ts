import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("rejecting a mixed assignment preserves its valid suspended Native ancestor context", () => {
  const connections = [
    { name: "a", points: [[-2, 0], [2, 0]] },
    { name: "b", points: [[0, -2], [0, 2]] },
  ]
  const route = (connectionName: string, points: number[][], vias: Array<{ x: number; y: number }> = []): HighDensityIntraNodeRoute => ({
    connectionName, rootConnectionName: undefined, regionId: "region", traceThickness: 0.1, viaDiameter: 0.3,
    route: points.map(([x, y, z = 0]) => ({ x, y, z })), vias,
  })
  const solver = new PriorityDagIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "region", center: { x: 0, y: 0 }, width: 8, height: 6, availableZ: [0, 1],
      portPoints: connections.flatMap(({ name, points }) => points.map(([x, y]) => ({ x, y, z: 0, connectionName: name }))),
    },
    copperCandidateSearch: true, priorityFamilySize: 6, traceWidth: 0.1,
    viaDiameter: 0.3, viaHoleDiameter: 0.15, obstacleMargin: 0.1, layerCount: 2, captureSearchDebug: false,
  })
  const state = {
    ancestors: [new Set<number>(), new Set<number>([0])],
    witnesses: Array(2).fill(undefined),
  }
  const store = Reflect.get(solver, "storeRoute").bind(solver)
  store(route("b", [[0, -2], [3, -2], [3, 2], [0, 2]]), state, 0)
  store(route("a", [[-2, 0], [2, 0]]), state, 1)
  // The via clears actual b copper, but crosses b's speculative future chord.
  const viaRoute = route("a", [[-2, 0], [0, 0], [0, 0, 1], [1, 0, 1], [1, 0], [2, 0]], [{ x: 0, y: 0 }, { x: 1, y: 0 }])
  store(viaRoute, state, 1)
  expect(Reflect.get(solver, "validateRoute").call(solver, 1, state)).toBe(true)
  Reflect.set(solver, "stack", [])
  Reflect.get(solver, "acceptState").call(solver, state)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.solvedRoutes).toHaveLength(2)
  expect(solver.solvedRoutes.find((value) => value.connectionName === "a")?.route).toEqual(viaRoute.route)
  expect(solver.priorityDiagnostics.copperCandidateSuspendedDagStates).toBe(1)
  expect(solver.priorityDiagnostics.copperCandidateRejectedAssignments).toBe(1)
  expect(solver.priorityDiagnostics.copperCandidateAssignmentsPublished).toBeUndefined()
  expect(solver.iterations).toBeLessThanOrEqual(solver.MAX_ITERATIONS)
})
