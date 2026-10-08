import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import input from "../fixtures/bug-reports/stm32-sram-bus-allowed-layers/input.json"

test("rejects STM32 SRAM control copper on forbidden layers", () => {
  const srj = structuredClone(input) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })

  expect(srj.layerCount).toBe(4)
  expect(srj.buses).toHaveLength(1)
  expect(srj.buses![0]!.allowedLayers).toEqual(["top", "bottom"])
  expect(srj.buses![0]!.connectionNames).toHaveLength(5)
  expect(() => solver.solve()).toThrow(
    'Pipeline9 bus "CONTROL" routed on forbidden layer "inner1"',
  )
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow(
    "Cannot get output before solving is complete",
  )
})
