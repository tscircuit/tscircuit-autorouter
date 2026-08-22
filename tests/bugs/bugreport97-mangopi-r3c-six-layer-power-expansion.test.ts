import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import srjJson from "../../fixtures/bug-reports/bugreport97-mangopi-r3c-six-layer-power-expansion/bugreport97-mangopi-r3c-six-layer-power-expansion.srj.json" with {
  type: "json",
}

const srj = srjJson as SimpleRouteJson

test.skip("bugreport97 routes the six-layer MangoPi R3C board", () => {
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
