import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("PMP22650 nearby multilayer terminals retain their identities", () => {
  const connectionName = "source_net_altium_pcb_3_mst0"
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName,
    start: {
      x: 197.98394489999998,
      y: 123.16207269999998,
      z: 7,
      pcb_port_id: "pcb_port_altium_8622",
    },
    end: {
      x: 197.98440972,
      y: 123.16207269999998,
      z: 0,
      pcb_port_id: "pcb_port_altium_7312",
    },
    hdRoutes: [
      {
        connectionName,
        rootConnectionName: "source_net_altium_pcb_3",
        endPcbPortId: "pcb_port_altium_7312",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 197.984, y: 122.552, z: 0 },
          { x: 197.984, y: 123.162, z: 0 },
        ],
        vias: [],
      },
      {
        connectionName,
        rootConnectionName: "source_net_altium_pcb_3",
        startPcbPortId: "pcb_port_altium_8622",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 197.984, y: 123.162, z: 7 },
          { x: 197.975, y: 123.15, z: 7 },
          { x: 197.975, y: 123.1, z: 7 },
          { x: 197.975, y: 123.05, z: 7 },
          { x: 197.975, y: 123, z: 7 },
          { x: 197.975, y: 122.95, z: 7 },
          { x: 197.975, y: 122.9, z: 7 },
          { x: 197.975, y: 122.85, z: 7 },
          { x: 197.975, y: 122.801, z: 7 },
          { x: 197.975, y: 122.752, z: 7 },
          { x: 197.975, y: 122.705, z: 7 },
          { x: 197.975, y: 122.661, z: 7 },
          { x: 197.975, y: 122.6, z: 7 },
          { x: 197.984, y: 122.552, z: 7 },
        ],
        vias: [],
      },
      {
        connectionName,
        rootConnectionName: "source_net_altium_pcb_3",
        startPcbPortId: "pcb_port_altium_7314",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 197.984, y: 122.552, z: 7 },
          { x: 198.067, y: 121.999, z: 7 },
          { x: 198.067, y: 121.999, z: 0 },
          { x: 197.984, y: 122.552, z: 0 },
        ],
        vias: [{ x: 198.067, y: 121.999 }],
      },
    ],
    preserveTerminalPcbPortIds: true,
    validPcbPortIds: new Set([
      "pcb_port_altium_8622",
      "pcb_port_altium_7312",
      "pcb_port_altium_7314",
    ]),
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "prefer_clear",
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(
    new Set([
      solver.mergedHdRoute.startPcbPortId,
      solver.mergedHdRoute.endPcbPortId,
    ]),
  ).toEqual(new Set(["pcb_port_altium_8622", "pcb_port_altium_7312"]))
  expect(solver.mergedHdRoute.route.length).toBeGreaterThan(2)
  expect(
    getSvgFromGraphicsObject(solver.visualize(), {
      backgroundColor: "#0d1117",
      svgWidth: 800,
      svgHeight: 500,
      hideInlineLabels: true,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
