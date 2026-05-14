import { expect, test } from "bun:test"
import sample06 from "fixtures/datasets/dataset-srj15/sample06-region-reroute.srj.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"

test("pipeline4 dataset-srj15 sample06 completes", () => {
  const solver = new AutoroutingPipelineSolver4(
    structuredClone(sample06 as SimpleRouteJson),
    { cacheProvider: null },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
}, 120_000)
