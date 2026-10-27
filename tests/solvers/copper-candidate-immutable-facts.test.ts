import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { priorityParams } from "./priorityDagTestUtils"

test("learned physical facts follow immutable exact copper identities and changed routes are rechecked", () => {
  const solver = new PriorityDagIntraNodeSolver({ ...priorityParams(), copperCandidateSearch: true })
  const state = {
    ancestors: [new Set<number>(), new Set<number>(), new Set<number>()],
    witnesses: Array(3).fill(undefined),
  }
  const route = (name: string, points: number[][]): HighDensityIntraNodeRoute => ({
    connectionName: name, rootConnectionName: `root-${name}`, regionId: "region",
    traceThickness: 0.1, viaDiameter: 0.3,
    route: points.map(([x, y]) => ({ x, y, z: 0 })), vias: [],
  })
  const store = Reflect.get(solver, "storeRoute").bind(solver)
  const conflict = Reflect.get(solver, "pairConflict").bind(solver)
  const clear = route("c", [[1.5, 2.2], [2.7, 2.2]])
  store(clear, state, 0)
  store(route("b", [[0, -2.8], [0, 1.1]]), state, 1)
  const originalId = state.witnesses[0].id
  expect(conflict(0, 1, state)).toBe(false)
  clear.route.splice(1, 0, { x: 0, y: 0, z: 0 })
  expect(Object.isFrozen(state.witnesses[0].route.route)).toBe(true)
  expect(state.witnesses[0].route.route).toHaveLength(2)
  expect(conflict(0, 1, state)).toBe(false)
  store(route("c", [[1.5, 2.2], [0, 0], [2.7, 2.2]]), state, 0)
  expect(state.witnesses[0].id).not.toBe(originalId)
  expect(conflict(0, 1, state)).toBe(true)
  expect(conflict(0, 1, state)).toBe(true)
  expect(solver.priorityDiagnostics.copperCandidatePhysicalPairChecks).toBe(2)
  expect(solver.priorityDiagnostics.copperCandidateConflictFactHits).toBe(2)
  expect(solver.priorityDiagnostics.copperCandidateConflictsLearned).toBe(1)
})
