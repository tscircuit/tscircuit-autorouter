import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import srj from "../../fixtures/bug-reports/bugreport73-qfp16/bugreport73-qfp16.srj.json" with {
  type: "json",
}

const bugreport73Qfp16Srj = srj as SimpleRouteJson

test("bugreport73 Pipeline 7 remains DRC-clean", (): void => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(bugreport73Qfp16Srj),
    {
      cacheProvider: null,
    },
  )

  solver.solve()

  const circuitJson = convertToCircuitJson(
    solver.srjWithPointPairs!,
    solver.getOutputSimplifiedPcbTraces(),
    {
      minTraceWidth: bugreport73Qfp16Srj.minTraceWidth,
      minViaDiameter: bugreport73Qfp16Srj.minViaDiameter,
    },
  )
  const drcResult = getDrcErrors(circuitJson, RELAXED_DRC_OPTIONS)

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(drcResult.errors).toEqual([])
})
