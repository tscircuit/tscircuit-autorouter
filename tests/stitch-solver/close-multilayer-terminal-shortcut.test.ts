import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"
import fixture from "./fixtures/close-multilayer-terminals.json"

test("does not replace nearby multilayer terminals with a reversed layer shortcut", (): void => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    ...fixture,
    connections: fixture.connections as SimpleRouteConnection[],
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  const route = solver.mergedHdRoutes[0]!
  const start = route.route[0]!
  const end = route.route[route.route.length - 1]!
  expect(start).toEqual({ x: 32.520005, y: -1.929998, z: 0 })
  expect(end).toEqual({ x: 32.545, y: -1.45, z: 3 })
  expect(route.startPcbPortId).toBe("start")
  expect(route.endPcbPortId).toBe("end")
})
