import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { getDeclaredTerminalStitchRoutes } from "lib/solvers/RouteStitchingSolver/getDeclaredTerminalStitchRoutes"

test("declared endpoints join owned islands without snapping both island ends to one pad", (): void => {
  const routes: HighDensityIntraNodeRoute[] = [
    { connectionName: "pair", rootConnectionName: "bus", startPcbPortId: "A", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: 0, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }], vias: [] },
    { connectionName: "pair", rootConnectionName: "bus", endPcbPortId: "B", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: 0.2, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], vias: [] },
    { connectionName: "neighbor", rootConnectionName: "bus", startPcbPortId: "C", endPcbPortId: "D", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: 0.1, y: 0.2, z: 0 }, { x: 5, y: 2, z: 0 }], vias: [] },
  ]
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      { name: "pair", pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "A" }, { x: 10, y: 0, layer: "top", pcb_port_id: "B" }] },
      { name: "neighbor", pointsToConnect: [{ x: 0.1, y: 0.2, layer: "top", pcb_port_id: "C" }, { x: 5, y: 2, layer: "top", pcb_port_id: "D" }] },
    ],
    hdRoutes: routes,
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
    useDeclaredConnectionEndpoints: true,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(2)
  const pair = solver.mergedHdRoutes.find((route) => route.connectionName === "pair")!
  expect(pair.startPcbPortId).toBe("A")
  expect(pair.endPcbPortId).toBe("B")
  expect(pair.route[0]).toMatchObject({ x: 0, y: 0, z: 0 })
  expect(pair.route.at(-1)).toMatchObject({ x: 10, y: 0, z: 0 })
  expect(pair.route.some((point) => point.x === 0.2 && point.y === 0)).toBe(true)
  const missing = [{ name: "missing", pointsToConnect: [{ x: 0, y: 0, layer: "top" }, { x: 1, y: 0, layer: "top" }] }]
  expect(() => getDeclaredTerminalStitchRoutes({ connections: missing, hdRoutes: [], layerCount: 2 }))
    .toThrow("no copper for missing")
  expect(getDeclaredTerminalStitchRoutes({ connections: missing, hdRoutes: [], layerCount: 2,
    preconnectedConnectionNames: new Set(["missing"]) })).toHaveLength(0)
  expect(() => getDeclaredTerminalStitchRoutes({ connections: [], hdRoutes: [], layerCount: 2,
    preconnectedConnectionNames: new Set(["unknown"]) })).toThrow("unknown connectivity witness")
})
