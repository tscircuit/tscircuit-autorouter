import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "lib"
import srj from "../../fixtures/bug-reports/bugreport93-9667d7/bugreport93-9667d7.srj.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"

const simpleRouteJson = srj as SimpleRouteJson

test.skip("allwinner-f1c200s latest SRJ completes autorouting", () => {
  const solver = new AutoroutingPipelineSolver(simpleRouteJson)
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
})
