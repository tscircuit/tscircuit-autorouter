import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { getDeclaredTerminalStitchRoutes } from "lib/solvers/RouteStitchingSolver/getDeclaredTerminalStitchRoutes"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("declared assembly selects an owned physical path through duplicate regional fragments without retracing", (): void => {
  const make = (points: Array<[number, number]>, terminal?: "A" | "B"): HighDensityIntraNodeRoute => ({
    connectionName: "branch", rootConnectionName: "bus", traceThickness: 0.1, viaDiameter: 0.3,
    route: points.map(([x, z]) => ({ x, y: 0, z })), vias: points.length > 2 ? [{ x: 1, y: 0 }] : [],
    ...(terminal === "A" ? { startPcbPortId: terminal } : terminal === "B" ? { endPcbPortId: terminal } : {}),
  })
  const routes = [make([[0, 0], [1, 0]], "A"), make([[1, 0], [1, 3], [2, 3]]),
    make([[2, 3], [3, 3]]), make([[2, 3], [3, 3]]), make([[3, 3], [4, 3]], "B")]
  const connections = [{ name: "branch", pointsToConnect: [
    { x: 0, y: 0, layer: "top", pcb_port_id: "A" }, { x: 4, y: 0, layer: "bottom", pcb_port_id: "B" },
  ] }]
  const selected = getDeclaredTerminalStitchRoutes({ connections, hdRoutes: routes, layerCount: 4 })
  expect(selected[0]!.hdRoutes).toHaveLength(4)
  const solver = new MultipleHighDensityRouteStitchSolver3({ connections, hdRoutes: routes,
    layerCount: 4, preserveTerminalPcbPortIds: true, useDeclaredConnectionEndpoints: true })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes[0]!.route.map((point) => point.x)).toEqual([0, 1, 1, 2, 3, 4])
  expect(solver.mergedHdRoutes[0]!.route.at(-1)).toMatchObject({ x: 4, y: 0, z: 3 })
  expect(solver.mergedHdRoutes[0]!.vias).toEqual([{ x: 1, y: 0 }])
  expect(() => getDeclaredTerminalStitchRoutes({ connections, hdRoutes: [...routes,
    { ...routes[2]!, startPcbPortId: "foreign" }], layerCount: 4 })).toThrow("unknown PCB terminal")
})
