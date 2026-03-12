import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver3_HgPortPointPathing"
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg"
import circuit18 from "./srj/hypergraph-not-using-poitToCOnnect.srj.json" with {
  type: "json",
}

test("repro: hypergraph-not-using-poitToCOnnect (circuit18)", () => {
  const solver = new AutoroutingPipelineSolver3_HgPortPointPathing(
    circuit18 as SimpleRouteJson,
  )

  solver.solve()

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 30_000)
