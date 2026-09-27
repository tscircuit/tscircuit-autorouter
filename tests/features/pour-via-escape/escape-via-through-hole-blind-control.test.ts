import { expect, test } from "bun:test"
import { pointToBoxDistance } from "@tscircuit/math-utils"
import input from "../../../fixtures/features/pour-via-escape/escape-via-through-hole-clearance.json"
import { EscapeViaLocationSolver } from "../../../lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import type { SimpleRouteJson } from "../../../lib/types"

test("an explicitly allowed blind escape via may overlap bottom copper in XY", (): void => {
  const srj = {
    ...structuredClone(input),
    allowBlindAndBuriedVias: true,
  } as SimpleRouteJson
  const solver = new EscapeViaLocationSolver(srj)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const vias = solver.getOutputSimpleRouteJson().obstacles.filter((obstacle) =>
    obstacle.obstacleId?.startsWith("escape-via-obstacle:"),
  )
  expect(vias).toHaveLength(1)
  expect({ layers: vias[0]!.layers, zLayers: vias[0]!.__zLayers }).toEqual({
    layers: ["top", "inner1"],
    zLayers: [0, 1],
  })

  const bottomSignal = srj.obstacles.find(
    (obstacle) => obstacle.obstacleId === "bottom-signal",
  )!
  const clearance =
    pointToBoxDistance(vias[0]!.center, bottomSignal) - input.minViaPadDiameter / 2
  expect(clearance).toBeLessThan(0)
})
