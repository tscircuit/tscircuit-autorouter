import { expect, test, describe } from "bun:test"
import { CapacityMeshSolver } from "../lib"
import { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "../lib"
import e2e3 from "examples/legacy/assets/e2e3.json"

describe("CapacityMeshSolver e2e3", () => {
  test("should solve e2e3 board and produce valid SimpleRouteJson output", async () => {
    const simpleSrj: SimpleRouteJson = e2e3 as any

    const solver = new CapacityMeshSolver(simpleSrj)

    // Run the solver until completion or failure
    solver.solve()

    // Verify solver completed successfully
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)

    // Get output SimpleRouteJson and verify it matches snapshot
    const result = solver.getOutputSimpleRouteJson()
    expect(convertSrjToGraphicsObject(result)).toMatchGraphicsSvg(
      import.meta.path,
    )
  }, 20_000)
})
