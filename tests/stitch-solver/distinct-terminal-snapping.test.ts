import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"

test("PMP22650 nearby multilayer terminals retain their identities", () => {
  const connectionName = "source_net_altium_pcb_3_mst0"
  const rootConnectionName = "source_net_altium_pcb_3"
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: connectionName,
        nominalTraceWidth: 0.1,
        pointsToConnect: [
          {
            x: 197.98394489999998,
            y: 123.16207269999998,
            layer: "bottom",
            pcb_port_id: "pcb_port_altium_8622",
          },
          {
            x: 197.98440972,
            y: 123.16207269999998,
            layer: "top",
            pcb_port_id: "pcb_port_altium_7312",
          },
        ],
        __rootConnectionNames: [rootConnectionName],
      },
      {
        name: rootConnectionName,
        nominalTraceWidth: 0.1,
        pointsToConnect: [
          {
            x: 197.98440972,
            y: 123.16207269999998,
            layer: "top",
            pcb_port_id: "pcb_port_altium_7312",
          },
          {
            x: 194.42840972,
            y: 123.16207269999998,
            layer: "top",
            pcb_port_id: "pcb_port_altium_7314",
          },
          {
            x: 194.5549449,
            y: 123.16207269999998,
            layer: "bottom",
            pcb_port_id: "pcb_port_altium_8620",
          },
          {
            x: 197.98394489999998,
            y: 123.16207269999998,
            layer: "bottom",
            pcb_port_id: "pcb_port_altium_8622",
          },
        ],
      },
    ],
    hdRoutes: [
      {
        connectionName,
        rootConnectionName,
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
        rootConnectionName,
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
        rootConnectionName,
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 197.984, y: 122.552, z: 7 },
          { x: 197.984, y: 122.402, z: 7 },
          { x: 198.015, y: 122.283, z: 7 },
          { x: 198.067, y: 121.999, z: 7 },
          { x: 198.067, y: 121.999, z: 0 },
          { x: 198.015, y: 122.286, z: 0 },
          { x: 197.984, y: 122.402, z: 0 },
          { x: 197.984, y: 122.552, z: 0 },
        ],
        vias: [{ x: 198.067, y: 121.999 }],
      },
    ],
    layerCount: 8,
    defaultViaDiameter: 0.3,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  expect(
    new Set([
      solver.mergedHdRoutes[0]?.startPcbPortId,
      solver.mergedHdRoutes[0]?.endPcbPortId,
    ]),
  ).toEqual(
    new Set(["pcb_port_altium_8622", "pcb_port_altium_7312"]),
  )
  expect(
    getSvgFromGraphicsObject(solver.visualize(), {
      backgroundColor: "#0d1117",
      svgWidth: 800,
      svgHeight: 500,
      hideInlineLabels: true,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
