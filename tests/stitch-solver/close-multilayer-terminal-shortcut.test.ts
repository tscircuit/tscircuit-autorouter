import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
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

  const common = {
    connectionName: "signal",
    traceThickness: 0.15,
    viaDiameter: 0.6,
    vias: [],
  }
  const stubSolver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "signal",
    start: { x: 3, y: 3, z: 1, pcb_port_id: "start" },
    end: { x: 0.8502, y: 0, z: 1, pcb_port_id: "end" },
    preserveTerminalPcbPortIds: true,
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "require_clear",
    hdRoutes: [
      {
        ...common,
        startPcbPortId: "start",
        route: [
          { x: 3, y: 3, z: 1 },
          { x: 0, y: 2, z: 1 },
          { x: 0, y: 2, z: 0 },
          { x: 0, y: 0, z: 0 },
        ],
      },
      {
        ...common,
        endPcbPortId: "end",
        route: [{ x: 0, y: 0, z: 1 }, { x: 0.85, y: 0, z: 1 }],
      },
      {
        ...common,
        route: [{ x: -0.095, y: 0, z: 0 }, { x: -0.095, y: 0, z: 1 }],
      },
    ],
  })
  stubSolver.solve()
  expect(stubSolver.solved).toBe(true)
  expect(stubSolver.mergedHdRoute.route.at(-1)).toEqual({
    x: 0.85,
    y: 0,
    z: 1,
  })
  expect(stubSolver.mergedHdRoute.endPcbPortId).toBe("end")
})
