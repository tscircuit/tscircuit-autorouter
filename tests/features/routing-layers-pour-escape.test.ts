import { expect, test } from "bun:test"
import { EscapeViaLocationSolver } from "lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import type { SimpleRouteJson } from "lib/types"

test("pour escape does not generate a routing transition to an excluded layer", () => {
  const input = {
    layerCount: 4,
    routingLayers: ["top", "bottom"],
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    defaultObstacleMargin: 0.15,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [
      {
        obstacleId: "source-pad",
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.65,
        height: 0.15,
        connectedTo: ["net.GND", "source-pad"],
      },
      {
        obstacleId: "gnd-pour",
        type: "rect",
        layers: ["inner1"],
        center: { x: 0, y: 0 },
        width: 5,
        height: 5,
        connectedTo: ["net.GND"],
        isCopperPour: true,
      },
    ],
    connections: [
      {
        name: "net.GND",
        pointsToConnect: [{ x: 0, y: 0, layer: "top", pointId: "source-pad" }],
      },
    ],
  } satisfies SimpleRouteJson

  const solver = new EscapeViaLocationSolver(input)
  solver.solve()
  const output = solver.getOutputSimpleRouteJson()

  expect(solver.createdEscapeVias).toHaveLength(0)
  expect(output.connections[0]?.pointsToConnect).toEqual(
    input.connections[0]?.pointsToConnect,
  )
})
