import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const routedFragment: HighDensityIntraNodeRoute = {
  connectionName: "conn",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: [
    { x: 0, y: 0, z: 0 },
    { x: 0.9, y: 0, z: 0 },
  ],
  vias: [],
  startPcbPortId: "pcb_port_start",
}

test("trace copper reaching its owned pad does not require a colliding centerline extension", () => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "conn",
        pointsToConnect: [
          {
            x: 0,
            y: 0,
            layer: "top",
            pcb_port_id: "pcb_port_start",
          },
          {
            x: 1,
            y: 0,
            layer: "top",
            pcb_port_id: "pcb_port_end",
          },
        ],
      },
    ],
    hdRoutes: [routedFragment],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
    minTraceToPadEdgeClearance: 0.15,
    obstacles: [
      {
        type: "rect",
        center: { x: 1, y: 0 },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: ["conn", "pcb_port_end"],
      },
      {
        type: "rect",
        center: { x: 1, y: 0.2 },
        width: 0.1,
        height: 0.1,
        layers: ["top"],
        connectedTo: ["foreign"],
      },
    ],
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  expect(solver.mergedHdRoutes[0]!.route.at(-1)).toEqual({
    x: 0.9,
    y: 0,
    z: 0,
  })
})
