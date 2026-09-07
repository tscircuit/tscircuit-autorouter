import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("stitching retains a routed planar detour instead of terminal shortcuts", (): void => {
  const points: HighDensityIntraNodeRoute["route"] = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0.4, z: 0 },
    { x: 0.4, y: 0.4, z: 0 },
    { x: 0.8, y: 0.4, z: 0 },
    { x: 3, y: 0.4, z: 0 },
    { x: 3.4, y: 0.4, z: 0 },
    { x: 3.4, y: 0, z: 0 },
  ]
  const routes = points.slice(1).map(
    (point, index): HighDensityIntraNodeRoute => ({
      connectionName: "detour",
      rootConnectionName: "detour",
      ...(index === 0 ? { startPcbPortId: "terminal_start" } : {}),
      ...(index === points.length - 2
        ? { endPcbPortId: "terminal_end" }
        : {}),
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [points[index]!, point],
      vias: [],
    }),
  )
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "detour",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "terminal_start" },
          { x: 3.4, y: 0, layer: "top", pcb_port_id: "terminal_end" },
        ],
      },
    ],
    hdRoutes: [...routes].reverse(),
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  expect(solver.mergedHdRoutes[0]!.route).toEqual(points)
  expect(solver.mergedHdRoutes[0]!.startPcbPortId).toBe("terminal_start")
  expect(solver.mergedHdRoutes[0]!.endPcbPortId).toBe("terminal_end")
})
