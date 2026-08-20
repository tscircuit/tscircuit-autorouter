import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import srjJson from "../../fixtures/bug-reports/bugreport94-mangopi-r3c-monolithic-timeout/bugreport94-mangopi-r3c-monolithic-timeout.srj.json" with {
  type: "json",
}

const srj = srjJson as SimpleRouteJson

test.skip("bugreport94 routes the phase-free MangoPi R3C board", async () => {
  const { AutoroutingPipelineSolver7_MultiGraph } = await import(
    "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
  )
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(srj),
    {
      effort: 1,
      cacheProvider: null,
    },
  )

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
})
