import { expect, test } from "bun:test"
import { HyperAssignableViaCapacityPathingSolver } from "../../../lib/autorouter-pipelines/AssignableAutoroutingPipeline1/HyperAssignableViaCapacityPathingSolver"
import { getSvgFromGraphicsObject } from "graphics-debug"
import "../../../tests/fixtures/svg-matcher"
// @ts-ignore
import constructorInput from "../../../examples/unassigned-obstacles/AssignableViaCapacityPathingSolver_DirectiveSubOptimal/AssignableViaCapacityPathingSolver_DirectiveSubOptimal01.json"

test("HyperAssignableViaCapacityPathingSolver should solve DirectiveSubOptimal01 problem", async () => {
  // Create hyper solver with the test input
  const solver = new HyperAssignableViaCapacityPathingSolver(
    (constructorInput as any)[0],
  )

  // Run the solver until completion or failure
  await solver.solve()

  // Verify solver completed successfully
  if (solver.failed) {
    console.log("Solver failed with error:", solver.error)
  }
  expect(solver.solved).toBe(true)

  // Generate SVG from visualization and match snapshot
  const graphics = solver.visualize()
  const svg = getSvgFromGraphicsObject(graphics, {
    includeTextLabels: true,
    backgroundColor: "white",
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
}, 120_000)
