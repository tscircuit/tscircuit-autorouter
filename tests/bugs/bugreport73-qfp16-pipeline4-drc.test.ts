import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import srj from "../../fixtures/bug-reports/bugreport73-qfp16/bugreport73-qfp16.srj.json" with {
  type: "json",
}

const bugreport73Qfp16Srj = srj as SimpleRouteJson

test("bugreport73 Pipeline 4 keeps a DRC-clean route unchanged", (): void => {
  const solver = new AutoroutingPipelineSolver4(
    structuredClone(bugreport73Qfp16Srj),
    {
      cacheProvider: null,
    },
  )

  solver.solve()

  const traces = solver.getOutputSimplifiedPcbTraces()
  const circuitJson = convertToCircuitJson(solver.srjWithPointPairs!, traces, {
    minTraceWidth: bugreport73Qfp16Srj.minTraceWidth,
    minViaDiameter: bugreport73Qfp16Srj.minViaDiameter,
  })
  const drcResult = getDrcErrors(circuitJson, RELAXED_DRC_OPTIONS)

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    solver.globalDrcForceImproveSolver?.stats
      .globalDrcForceImproveSkippedCleanInput,
  ).toBe(true)
  expect(drcResult.errors).toEqual([])
})
