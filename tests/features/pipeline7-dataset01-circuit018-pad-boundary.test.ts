import { expect, test } from "bun:test"
import * as dataset01 from "@tscircuit/autorouting-dataset-01"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

test("pipeline7 dataset01 circuit018 accepts a preloaded trace on the pad boundary", () => {
  const circuit018 = (dataset01 as Record<string, unknown>)
    .circuit018 as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(circuit018),
    { cacheProvider: null },
  )

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.srjWithPointPairs).toBeDefined()

  const { errors } = evaluateRelaxedDrc({
    inputSrj: circuit018,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })

  expect(errors).toHaveLength(0)
})
