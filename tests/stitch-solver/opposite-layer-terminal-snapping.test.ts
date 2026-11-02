import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"

test("stitches nearly coincident pads on opposite layers to distinct PCB terminals", () => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    layerCount: 4,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
    connections: [
      {
        name: "power",
        pointsToConnect: [
          { x: 0, y: 0, layer: "bottom", pcb_port_id: "bottom-pad" },
          { x: 0.0004, y: 0, layer: "top", pcb_port_id: "top-pad" },
        ],
      },
    ],
    hdRoutes: [
      {
        connectionName: "power",
        startPcbPortId: "bottom-pad",
        endPcbPortId: "top-pad",
        traceThickness: 0.15,
        viaDiameter: 0.2,
        route: [
          { x: 0, y: 0, z: 3 },
          { x: 1, y: 0, z: 3 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
        ],
        vias: [{ x: 1, y: 0 }],
      },
    ],
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  const route = solver.mergedHdRoutes[0]
  const points = route.route
  expect(new Set([route.startPcbPortId, route.endPcbPortId])).toEqual(
    new Set(["bottom-pad", "top-pad"]),
  )
  expect(points[0].z).not.toBe(points.at(-1)!.z)
})
