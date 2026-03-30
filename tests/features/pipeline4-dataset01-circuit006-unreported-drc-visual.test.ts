import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "tests/fixtures/getLastStepSvg"

test("pipeline4 dataset01 circuit006 visual snapshot", () => {
  const circuit006 = (dataset01 as Record<string, unknown>)
    .circuit006 as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver4(circuit006)

  solver.solve()

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
}, 60_000)
