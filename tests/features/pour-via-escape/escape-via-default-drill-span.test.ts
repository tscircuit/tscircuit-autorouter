import { expect, test } from "bun:test"
import { EscapeViaLocationSolver } from "../../../lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import type { SimpleRouteJson } from "../../../lib/types"

test("escape vias reserve every drilled layer by default", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.2,
    minViaDiameter: 0.6,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [
      {
        obstacleId: "gnd-pad",
        type: "rect",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["GND"],
      },
      {
        obstacleId: "gnd-plane",
        type: "rect",
        center: { x: 0, y: 0 },
        width: 10,
        height: 10,
        layers: ["inner1"],
        connectedTo: ["GND"],
        isCopperPour: true,
      },
    ],
    connections: [
      {
        name: "GND",
        pointsToConnect: [{ x: 0, y: 0, layer: "top", pointId: "gnd-pin" }],
      },
    ],
  }
  const solver = new EscapeViaLocationSolver(srj)
  solver.solve()

  expect(solver.solved).toBe(true)
  const vias = [...solver.getEscapeViaMetadataByPointId().values()]
  expect(vias).toHaveLength(1)
  expect(vias[0]!.sourceLayer).toBe("top")
  expect(vias[0]!.targetLayer).toBe("inner1")
  const addedObstacles = solver
    .getOutputSimpleRouteJson()
    .obstacles.slice(srj.obstacles.length)
  expect(addedObstacles).toHaveLength(1)
  expect(addedObstacles[0]!.layers).toEqual([
    "top",
    "inner1",
    "inner2",
    "bottom",
  ])
  expect(addedObstacles[0]!.__zLayers).toEqual([0, 1, 2, 3])
})
