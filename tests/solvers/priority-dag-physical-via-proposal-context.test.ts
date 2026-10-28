import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { priorityParams } from "./priorityDagTestUtils"

test("native priority queries world physical via context before proposing ordinary or endpoint vias", (): void => {
  const params = priorityParams()
  params.nodeWithPortPoints.portPoints = params.nodeWithPortPoints.portPoints.map((point) =>
    point.connectionName === "c" ? { ...point, x: 2.2, y: 2.2, z: point.pcb_port_id === "c-0" ? 0 : 1 } : point,
  )
  let physicalQueries = 0
  const solver = new PriorityDagIntraNodeSolver({
    ...params,
    routeFragmentValidator: (route): boolean => {
      physicalQueries++
      expect(route.traceThickness).toBe(0.1)
      expect(route.viaDiameter).toBe(0.3)
      return false
    },
  })
  const state = { ancestors: [new Set(), new Set(), new Set()], witnesses: [undefined, undefined, undefined] }
  const options = Reflect.get(solver, "getOptions").call(solver, 0, state)
  const physicalNative = Reflect.get(solver, "createNativeSolver").call(solver, options) as Native
  const parent = { x: 2.2, y: 2.2, z: 0, g: 0, h: 0, f: 0, parent: null }
  const via = { ...parent, z: 1, parent }
  expect(new Native(options).isNodeTooCloseToObstacle(via, 0.2, true)).toBeFalse()
  expect(physicalNative.isNodeTooCloseToObstacle(via, 0.2, true)).toBeTrue()
  const wire = { ...parent, x: 2.4, parent }
  expect(new Native(options).doesPathToParentIntersectObstacle(wire)).toBeFalse()
  expect(physicalNative.doesPathToParentIntersectObstacle(wire)).toBeTrue()
  Reflect.get(solver, "startTask").call(solver, 0, state)
  expect(solver.activeSubSolver).toBeInstanceOf(Native)
  expect(solver.solved).toBeFalse()
  expect(state.witnesses[0]).toBeUndefined()
  expect(physicalQueries).toBeGreaterThanOrEqual(2)
})
