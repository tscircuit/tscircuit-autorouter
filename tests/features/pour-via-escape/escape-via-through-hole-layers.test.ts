import { expect, test } from "bun:test"
import input from "../../../fixtures/features/pour-via-escape/escape-via-through-hole-clearance.json"
import { EscapeViaLocationSolver } from "../../../lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import type { SimpleRouteJson } from "../../../lib/types"

test("through-hole escape vias reserve every physical copper layer", (): void => {
  const solver = new EscapeViaLocationSolver(
    structuredClone(input) as SimpleRouteJson,
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const vias = solver.getOutputSimpleRouteJson().obstacles.filter((obstacle) =>
    obstacle.obstacleId?.startsWith("escape-via-obstacle:"),
  )
  expect(vias).toHaveLength(1)

  // The electrical destination is inner1, but the drill spans all four
  // layers because allowBlindAndBuriedVias is false.
  expect({ layers: vias[0]!.layers, zLayers: vias[0]!.__zLayers }).toEqual({
    layers: ["top", "inner1", "inner2", "bottom"],
    zLayers: [0, 1, 2, 3],
  })
})
