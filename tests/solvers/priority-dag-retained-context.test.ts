import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { detailedPriority, priorityParams } from "./priorityDagTestUtils"

test("retained witnesses require exact immutable ancestor route context, including canonical future complement", () => detailedPriority(() => {
  const solver = new PriorityDagIntraNodeSolver(priorityParams())
  const route = { connectionName: "c", rootConnectionName: "root-c", regionId: "region", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 1.5, y: 2.2, z: 0 }, { x: 2.7, y: 2.2, z: 0 }], vias: [] }
  const state = { ancestors: [new Set<number>(), new Set<number>(), new Set<number>()], witnesses: new Array<any>(3).fill(undefined) }
  Reflect.get(solver, "storeRoute").call(solver, route, state, 0)
  expect(Object.isFrozen(state.witnesses[0].route)).toBe(true)
  expect(Object.isFrozen(state.witnesses[0].route.route[0])).toBe(true)
  route.route[0].x = -100
  expect(state.witnesses[0].route.route[0].x).toBe(1.5)
  const stale = { ancestors: [new Set<number>([1]), new Set<number>(), new Set<number>()], witnesses: [...state.witnesses] }
  expect(() => Reflect.get(solver, "acceptState").call(solver, stale)).toThrow("Stale retained priority witness")
}))
