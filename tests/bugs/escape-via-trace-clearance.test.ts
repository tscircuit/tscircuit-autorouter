import { expect, test } from "bun:test"
import { EscapeViaLocationSolver } from "lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import type { SimpleRouteJson } from "lib/types"

test("EscapeViaLocationSolver requiredTraceClearance matches centerline-to-edge formula", () => {
  const syntheticSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    minViaDiameter: 0.3,
    defaultObstacleMargin: 0.2,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    obstacles: [
      {
        obstacleId: "pad-1",
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["source_net_0"],
      },
      {
        obstacleId: "inner-pour",
        type: "rect",
        layers: ["bottom"],
        center: { x: 0, y: 0 },
        width: 18,
        height: 18,
        connectedTo: ["source_net_0"],
        isCopperPour: true,
      },
    ],
    connections: [
      {
        name: "source_net_0",
        pointsToConnect: [
          {
            x: 0,
            y: 0,
            layer: "top",
            pointId: "pcb_port_a",
            pcb_port_id: "pcb_port_a",
          },
        ],
      },
    ],
  }

  const solver = new EscapeViaLocationSolver(syntheticSrj)

  // Centerline-to-edge distance must be trace_radius + obstacle_margin
  // (0.2 / 2) + 0.2 = 0.3
  expect(solver.requiredTraceClearance).toBeCloseTo(0.3)
})
