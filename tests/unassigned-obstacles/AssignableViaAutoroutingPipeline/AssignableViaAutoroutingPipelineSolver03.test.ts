import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline1Solver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline1/AssignableAutoroutingPipeline1Solver"
import type { SimpleRouteJson } from "lib/types"
import { simpleRouteJson } from "../../../examples/unassigned-obstacles/AssignableViaAutoroutingPipelineSolver/AssignableViaAutoroutingPipelineSolver03.fixture"
import { getSvgFromGraphicsObject } from "graphics-debug"

test("assignable via pipeline solves complex two-layer obstacle routing", () => {
  const solver = new AssignableAutoroutingPipeline1Solver(simpleRouteJson)

  const MAX_STEPS = 50_000
  for (let i = 0; i < MAX_STEPS; i++) {
    if (solver.initialPathingSolver?.solved || solver.failed) {
      break
    }
    solver.step()
  }

  expect(
    getSvgFromGraphicsObject(solver.visualize(), {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(solver.failed).toBe(false)
})
