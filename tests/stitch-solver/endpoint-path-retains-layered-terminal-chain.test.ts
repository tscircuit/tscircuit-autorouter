import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("stitching retains terminal copper on both sides of a routed layer transition", (): void => {
  const points: HighDensityIntraNodeRoute["route"] = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0.25, z: 0 },
    { x: 0.5, y: 0.6, z: 0 },
    { x: 2, y: 0.6, z: 0 },
    { x: 2, y: 0.6, z: 1 },
    { x: 0.6, y: 0.6, z: 1 },
    { x: 0.3, y: 0.25, z: 1 },
    { x: 0.3, y: 0, z: 1 },
  ]
  const routePoints = [
    points.slice(0, 2),
    points.slice(1, 3),
    points.slice(2, 6),
    points.slice(5, 7),
    points.slice(6, 8),
  ]
  const routes = routePoints.map(
    (route, index): HighDensityIntraNodeRoute => ({
      connectionName: "layered_chain",
      rootConnectionName: "layered_chain",
      ...(index === 0 ? { startPcbPortId: "terminal_top" } : {}),
      ...(index === routePoints.length - 1
        ? { endPcbPortId: "terminal_bottom" }
        : {}),
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route,
      vias: index === 2 ? [{ x: 2, y: 0.6 }] : [],
    }),
  )
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "layered_chain",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "terminal_top" },
          { x: 0.3, y: 0, layer: "bottom", pcb_port_id: "terminal_bottom" },
        ],
      },
    ],
    hdRoutes: [routes[2]!, routes[4]!, routes[1]!, routes[3]!, routes[0]!],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  expect(solver.mergedHdRoutes[0]!.route).toEqual(points)
  expect(solver.mergedHdRoutes[0]!.vias).toEqual([{ x: 2, y: 0.6 }])
  expect(solver.mergedHdRoutes[0]!.startPcbPortId).toBe("terminal_top")
  expect(solver.mergedHdRoutes[0]!.endPcbPortId).toBe("terminal_bottom")
})
