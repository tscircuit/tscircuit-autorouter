import { expect, test } from "bun:test"
import { getDeclaredTerminalStitchRoutes } from "lib/solvers/RouteStitchingSolver/getDeclaredTerminalStitchRoutes"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("declared assembly materializes every planar gap leg and never marks an unreachable selected path solved", (): void => {
  const connection = { name: "chain", pointsToConnect: [
    { x: 0, y: 0, layer: "top", pcb_port_id: "A" }, { x: 3, y: 0, layer: "top", pcb_port_id: "B" },
  ] }
  const routes = [
    { connectionName: "chain", rootConnectionName: "bus", traceThickness: 0.2, viaDiameter: 0.3,
      route: [{ x: 1, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }], vias: [] },
    { connectionName: "chain", rootConnectionName: "bus", traceThickness: 0.15, viaDiameter: 0.3, endPcbPortId: "B",
      route: [{ x: 2, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }], vias: [] },
  ]
  const selected = getDeclaredTerminalStitchRoutes({ connections: [connection], hdRoutes: routes, layerCount: 2 })[0]!
  expect(selected.hdRoutes).toHaveLength(3)
  expect(selected.hdRoutes.map((route) => [route.route[0]!.x, route.route.at(-1)!.x])).toEqual([[0, 1], [1, 2], [2, 3]])
  expect(selected.hdRoutes.slice(0, 2).every((route) => route.traceThickness === 0.2 && route.vias.length === 0)).toBe(true)
  const params = { connectionName: "chain", start: selected.start, end: selected.end, hdRoutes: selected.hdRoutes,
    preserveTerminalPcbPortIds: true, preserveExactEndpoints: true, stitchClearanceMode: "require_clear" as const }
  const solver = new SingleHighDensityRouteStitchSolver3({ ...params, isStitchSegmentClear: () => true })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoute.route.map((point) => point.x)).toEqual([0, 1, 2, 3])
  expect(solver.mergedHdRoute.vias).toHaveLength(0)
  const blocked = new SingleHighDensityRouteStitchSolver3({ ...params, isStitchSegmentClear: ({ start }) => start.x !== 1 })
  expect(blocked.failed).toBe(true)
  const disconnected = new SingleHighDensityRouteStitchSolver3({ ...params,
    hdRoutes: [routes[1]!], isStitchSegmentClear: () => true })
  expect(() => disconnected.solve()).toThrow("cannot join next selected fragment")
  expect(disconnected.solved).toBe(false)
})
