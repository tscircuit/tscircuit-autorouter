import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteConnection } from "lib/types"

test("reproduces rc car power trace width falling back below 1.2mm", () => {
  const connection: SimpleRouteConnection = {
    name: "MOTOR_A1",
    nominalTraceWidth: 1.2,
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" },
      { x: 10, y: 0, layer: "top" },
    ],
  }
  const hdRoute: HighDensityRoute = {
    connectionName: "MOTOR_A1",
    traceThickness: 0.15,
    viaDiameter: 0.6,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ],
    vias: [],
  }
  const obstacles: Obstacle[] = [
    {
      obstacleId: "nearby-copper",
      type: "rect",
      center: { x: 5, y: 0.45 },
      width: 8,
      height: 0.2,
      layers: ["top"],
      connectedTo: ["OTHER_NET"],
    },
  ]
  const solver = new TraceWidthSolver({
    hdRoutes: [hdRoute],
    connection: [connection],
    obstacles,
    minTraceWidth: 0.15,
    obstacleMargin: 0.1,
    layerCount: 2,
  })

  solver.solve()

  const output = solver.getHdRoutesWithWidths()
  expect(output).toHaveLength(1)
  expect(output[0]!.traceThickness).toBe(0.15)
  expect(connection.nominalTraceWidth).toBe(1.2)
  const graphics = solver.visualize()
  graphics.texts = [
    ...(graphics.texts ?? []),
    {
      x: 0,
      y: 1.2,
      text: "REQUESTED: 1.20mm / ROUTED: 0.15mm",
      fontSize: 0.3,
      color: "black",
      anchorSide: "center_left",
    },
  ]
  expect(graphics).toMatchGraphicsSvg(import.meta.path)
})
