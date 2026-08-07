import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import srj from "../../fixtures/bug-reports/bugreport85-pico-usb-differential-pair/bugreport85-pico-usb-differential-pair.srj.json" with {
  type: "json",
}

test("bugreport85 Pico USB differential-pair length matching failure", (): void => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(srj) as SimpleRouteJson,
    { cacheProvider: null },
  )

  expect(() => solver.solve()).toThrow(
    "LengthMatchingSolver: linear regression exhausted all segment/tooth combinations",
  )

  expect(solver.failed).toBe(true)
  expect(String(solver.error)).toContain(
    "LengthMatchingSolver: linear regression exhausted all segment/tooth combinations",
  )
})
