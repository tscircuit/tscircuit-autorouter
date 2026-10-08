import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import input from "../fixtures/bug-reports/stm32-sram-bus-allowed-layers/input.json"

test("rejects forbidden copper instead of reporting a successful board", () => {
  const srj = structuredClone(input) as SimpleRouteJson
  const solver = new Pipeline9(srj, { cacheProvider: null })
  expect(() => solver.solve()).toThrow(
    'Pipeline9 bus "CONTROL" routed on forbidden layer "inner1"',
  )
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  srj.buses![0]!.allowedLayers = ["top", "inner1", "inner2", "bottom"]
  expect(() => new Pipeline9(srj)).not.toThrow()
  delete srj.buses![0]!.allowedLayers
  expect(() => new Pipeline9(srj)).not.toThrow()
})
