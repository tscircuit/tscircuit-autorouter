import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { getSvgFromGraphicsObject, type Text } from "graphics-debug"

test("stitches a power path that needs every same-net fragment", async (): Promise<void> => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "power_mst0",
        __rootConnectionNames: ["power"],
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "a" },
          { x: 4, y: 0, layer: "top", pcb_port_id: "c" },
        ],
      },
      {
        name: "power_mst1",
        __rootConnectionNames: ["power"],
        pointsToConnect: [
          { x: 2, y: 0, layer: "top", pcb_port_id: "b" },
          { x: 4, y: 0, layer: "top", pcb_port_id: "c" },
        ],
      },
    ],
    hdRoutes: [
      {
        connectionName: "power_mst0",
        rootConnectionName: "power",
        startPcbPortId: "a",
        endPcbPortId: "b",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
        vias: [],
      },
      {
        connectionName: "power_mst1",
        rootConnectionName: "power",
        startPcbPortId: "b",
        endPcbPortId: "c",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [{ x: 2, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }],
        vias: [],
      },
    ],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
  })
  solver.solve()
  const graphics = solver.visualize()
  graphics.texts = solver.mergedHdRoutes.map((route, index): Text => ({
    text: `${route.connectionName}: ${route.startPcbPortId} → ${route.endPcbPortId}`,
    x: 0,
    y: 0.7 - index * 0.3,
    fontSize: 0.15,
    color: "#334155",
  }))
  await expect(getSvgFromGraphicsObject(graphics, { backgroundColor: "white" })).toMatchSvgSnapshot(
    import.meta.path,
  )
})
