import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import circuit003 from "./pipeline7-dataset-srj23-sample003.srj.json" with {
  type: "json",
}

test("pipeline7 dataset-srj23 sample003 completes with physical net aliases", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(circuit003 as SimpleRouteJson),
    { cacheProvider: null },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.portPointPathingSolver?.solved).toBe(true)
  expect(solver.portPointPathingSolver?.failed).toBe(false)
})
