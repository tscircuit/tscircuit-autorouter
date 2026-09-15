import { expect, test } from "bun:test"
import { pointToBoxDistance } from "@tscircuit/math-utils"
import { EscapeViaLocationSolver } from "lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import type { Obstacle, SimpleRouteJson } from "lib/types"

test("escape vias check bottom pads according to the board via policy", (): void => {
  const baseSrj: SimpleRouteJson = {
    layerCount: 4,
    allowBlindAndBuriedVias: true,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.6,
    defaultObstacleMargin: 0.1,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    obstacles: [
      {
        obstacleId: "pad",
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 0.65,
        height: 0.2,
        connectedTo: ["power", "pad"],
      },
      {
        obstacleId: "plane",
        type: "rect",
        layers: ["inner2"],
        center: { x: 0, y: 0 },
        width: 7,
        height: 7,
        connectedTo: ["power"],
        isCopperPour: true,
      },
    ],
    connections: [
      {
        name: "power",
        pointsToConnect: [{ x: 0, y: 0, layer: "top", pointId: "pad" }],
      },
    ],
  }
  const control = new EscapeViaLocationSolver(baseSrj)
  control.solve()
  const chosenVia = control.createdEscapeVias[0]!
  expect(chosenVia).toBeDefined()
  const bottomPad: Obstacle = {
    obstacleId: "foreign-bottom-pad",
    type: "rect",
    layers: ["bottom"],
    center: { x: chosenVia.x, y: chosenVia.y },
    width: 0.25,
    height: 0.25,
    connectedTo: ["signal"],
  }
  for (const allowBlindAndBuriedVias of [undefined, false, true]) {
    const srj = {
      ...baseSrj,
      allowBlindAndBuriedVias,
      obstacles: [...baseSrj.obstacles, bottomPad],
    }
    const before = structuredClone(srj)
    const solver = new EscapeViaLocationSolver(srj)
    solver.solve()
    expect(solver.failed).toBeFalse()
    const via = solver.createdEscapeVias[0]!
    expect(via).toBeDefined()
    const obstacle = solver
      .getOutputSimpleRouteJson()
      .obstacles.find((obstacle) =>
        obstacle.obstacleId?.startsWith("escape-via-obstacle:"),
      )!
    const occupiedZ = allowBlindAndBuriedVias ? [0, 1, 2] : [0, 1, 2, 3]
    expect(obstacle.__zLayers).toEqual(occupiedZ)
    expect(obstacle.layers).toEqual(
      allowBlindAndBuriedVias
        ? ["top", "inner1", "inner2"]
        : ["top", "inner1", "inner2", "bottom"],
    )
    if (allowBlindAndBuriedVias) {
      expect({ x: via.x, y: via.y }).toEqual(bottomPad.center)
    } else {
      expect(pointToBoxDistance(via, bottomPad) - 0.3).toBeGreaterThanOrEqual(
        0.1 - 1e-4,
      )
    }
    expect(srj).toEqual(before)
  }
})
