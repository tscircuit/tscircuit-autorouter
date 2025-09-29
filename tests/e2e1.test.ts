import { expect, test, describe } from "bun:test"
import { CapacityMeshSolver } from "../lib"
import keyboardRoutes from "../examples/legacy/assets/growing-grid-keyboard-sample-sample95-unrouted_simple_route.json"
import type {
  SimpleRouteJson,
  SimplifiedPcbTraces,
  Obstacle,
} from "../lib/types"
import { Line, Rect } from "graphics-debug"
import { convertSrjToGraphicsObject } from "../lib"

test("should solve keyboard1 board and produce valid SimpleRouteJson output", async () => {
  // Create a solver with the keyboard1 input
  const solver = new CapacityMeshSolver(
    keyboardRoutes as unknown as SimpleRouteJson,
  )

  // Run the solver until completion or failure
  solver.solve()

  // Verify solver completed successfully
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  // Get output SimpleRouteJson
  const output = solver.getOutputSimpleRouteJson()

  // console.log(output.traces?.flatMap((t) => t.route))
  expect(convertSrjToGraphicsObject(output)).toMatchGraphicsSvg(
    import.meta.path,
  )
}, 20_000)
