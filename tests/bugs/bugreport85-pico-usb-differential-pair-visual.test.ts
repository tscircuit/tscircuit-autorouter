import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import srj from "../../fixtures/bug-reports/bugreport85-pico-usb-differential-pair/bugreport85-pico-usb-differential-pair.srj.json" with {
  type: "json",
}
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

test("bugreport85 Pico USB differential-pair best-effort visualization", (): void => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(srj) as SimpleRouteJson,
    { cacheProvider: null },
  )

  expect(() => solver.solve()).toThrow("Differential pair post-processing failed")
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.postProcessingErrors).toMatchObject([
    {
      stage: "differentialPairReroutingSolver",
      reason: "iteration-limit-exhausted",
    },
  ])

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
