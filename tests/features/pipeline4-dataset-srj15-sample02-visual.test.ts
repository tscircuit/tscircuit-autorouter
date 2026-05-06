import { expect, test } from "bun:test"
import sample02 from "fixtures/datasets/dataset-srj15/sample02-region-reroute.srj.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg"

test("pipeline4 dataset-srj15 sample02 visual snapshot", () => {
  const solver = new AutoroutingPipelineSolver4(
    structuredClone(sample02 as SimpleRouteJson),
    { cacheProvider: null },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 120_000)
