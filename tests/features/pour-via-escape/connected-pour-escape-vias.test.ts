import { expect, test } from "bun:test"
import { EscapeViaLocationSolver } from "../../../lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import type { SimpleRouteJson } from "../../../lib/types"

test("escape vias share touching pour tiles but retain disconnected islands", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.45,
    bounds: { minX: -8, maxX: 8, minY: -4, maxY: 4 },
    obstacles: [-4, 0, 5].map((x) => ({
      type: "rect",
      layers: ["inner1"],
      center: { x, y: 0 },
      width: 4,
      height: 8,
      connectedTo: ["GND"],
      isCopperPour: true,
    })),
    connections: [
      {
        name: "GND",
        pointsToConnect: [-4, 0, 5].map((x, index) => ({
          x,
          y: 0,
          layer: "top",
          pointId: `pad-${index}`,
        })),
      },
    ],
  }
  const solver = new EscapeViaLocationSolver(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.createdEscapeVias).toHaveLength(3)
  const ids = new Map(
    solver.createdEscapeVias.map((via) => [via.sourcePointId, via.pointId]),
  )
  const connection = solver.getOutputSimpleRouteJson().connections[0]!
  expect(connection.externallyConnectedPointIds).toEqual([
    [ids.get("pad-0")!, ids.get("pad-1")!],
  ])
  expect(connection.pointsToConnect).toHaveLength(6)
})
