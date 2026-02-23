import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline1Solver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline1/AssignableAutoroutingPipeline1Solver"
import type { SimpleRouteJson } from "lib/types"
import { simpleRouteJson } from "../../fixtures/unassigned-obstacles/AssignableViaAutoroutingPipelineSolver/AssignableViaAutoroutingPipelineSolver03.fixture"

test(
  "AssignableAutoroutingPipeline1Solver solves and does not mutate input SRJ",
  () => {
    const srj = structuredClone(simpleRouteJson as SimpleRouteJson)
    const before = structuredClone(srj)

    const solver = new AssignableAutoroutingPipeline1Solver(srj)
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(srj).toEqual(before)
  },
  { timeout: 180_000 },
)
