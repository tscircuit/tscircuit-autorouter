import { expect, test } from "bun:test"
import { pointToBoxDistance } from "@tscircuit/math-utils"
import { EscapeViaLocationSolver } from "../../../lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import type { Obstacle, SimpleRouteJson } from "../../../lib/types"

test("through-hole escape vias reserve and clear every physical layer", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.45,
    minViaEdgeToPadEdgeClearance: 0.15,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        connectedTo: ["GND", "source-pad"],
      },
      {
        type: "rect",
        layers: ["inner1"],
        center: { x: 0, y: 0 },
        width: 8,
        height: 8,
        connectedTo: ["GND"],
        isCopperPour: true,
      },
    ],
    connections: [
      {
        name: "GND",
        pointsToConnect: [{ x: 0, y: 0, layer: "top", pointId: "source-pad" }],
      },
    ],
  }
  const initial = new EscapeViaLocationSolver(input)
  initial.solve()
  expect(initial.createdEscapeVias).toHaveLength(1)
  const blockedPosition = initial.createdEscapeVias[0]!
  const oppositePad: Obstacle = {
    type: "rect",
    layers: ["bottom"],
    center: { x: blockedPosition.x, y: blockedPosition.y },
    width: 0.45,
    height: 0.45,
    connectedTo: ["SIGNAL"],
  }
  input.obstacles.push(oppositePad)

  for (const allowBlindAndBuriedVias of [undefined, false, true]) {
    const solver = new EscapeViaLocationSolver({
      ...input,
      allowBlindAndBuriedVias,
    })
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.createdEscapeVias).toHaveLength(1)
    const via = solver.createdEscapeVias[0]!
    const obstacle = solver
      .getOutputSimpleRouteJson()
      .obstacles.find(
        (entry) => entry.obstacleId === `escape-via-obstacle:${via.pointId}`,
      )!
    if (allowBlindAndBuriedVias) {
      expect(obstacle.layers).toEqual(["top", "inner1"])
      expect(obstacle.__zLayers).toEqual([0, 1])
      expect(via.x).toBe(blockedPosition.x)
      expect(via.y).toBe(blockedPosition.y)
    } else {
      expect(obstacle.layers).toEqual(["top", "inner1", "inner2", "bottom"])
      expect(obstacle.__zLayers).toEqual([0, 1, 2, 3])
      expect(
        pointToBoxDistance(via, oppositePad) - 0.45 / 2,
      ).toBeGreaterThanOrEqual(0.15 - 1e-4)
    }
  }
})
