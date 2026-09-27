import { expect, test } from "bun:test"
import { pointToBoxDistance } from "@tscircuit/math-utils"
import input from "../../../fixtures/features/pour-via-escape/escape-via-through-hole-clearance.json"
import { EscapeViaLocationSolver } from "../../../lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import type { SimpleRouteJson } from "../../../lib/types"

test("through-hole escape vias clear existing bottom-layer signal copper", (): void => {
  const srj = structuredClone(input) as SimpleRouteJson
  const bottomSignal = srj.obstacles.find(
    (obstacle) => obstacle.obstacleId === "bottom-signal",
  )!
  const solver = new EscapeViaLocationSolver(srj)
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const vias = solver.getOutputSimpleRouteJson().obstacles.filter((obstacle) =>
    obstacle.obstacleId?.startsWith("escape-via-obstacle:"),
  )
  expect(vias).toHaveLength(1)

  // The rectangle represents a 0.2 mm pre-routed bottom signal trace.
  // Its clearance must be checked even though the GND pour is on inner1.
  const clearance =
    pointToBoxDistance(vias[0]!.center, bottomSignal) - input.minViaPadDiameter / 2
  expect(clearance).toBeGreaterThanOrEqual(
    input.minViaEdgeToPadEdgeClearance - 1e-4,
  )
})
