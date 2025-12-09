import { describe, expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "../../examples/bug-reports/bugreport09-618e09/bugreport09-618e09.json" assert {
  type: "json",
}

const srj = bugReport.simple_route_json as SimpleRouteJson

// This bug report previously caused the DeadEndSolver to crash when processing a
// leaf whose neighbour had already been removed from the adjacency map.
describe("bugreport9-618e09", () => {
  test("dead end solver handles already removed neighbours", () => {
    const solver = new AutoroutingPipelineSolver(srj)

    expect(() => solver.solveUntilPhase("initialPathingSolver")).not.toThrow()

    expect(solver.failed).toBeFalse()
    expect(solver.deadEndSolver).toBeDefined()
    expect(solver.deadEndSolver?.removedNodeIds.size).toBeGreaterThanOrEqual(0)
  })
})
