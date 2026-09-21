import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import {
  convertToCircuitJson,
  createPcbBoardElement,
} from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import board from "../fixtures/stm32-full-board-disconnected.json"

test("STM32 full board reproduces disconnected LED_GREEN fragments", async (): Promise<void> => {
  // Full 80 x 60 mm board, reconstructed from its saved routing result.
  // Output traces were removed; the original run had no preloaded traces.
  const input: SimpleRouteJson = structuredClone(board)
  expect(input.connections).toHaveLength(57)
  expect(input.obstacles).toHaveLength(224)
  expect(input.traces).toEqual([])

  const solver = new AutoroutingPipelineSolver7_MultiGraph(input)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()

  const traces = solver.getOutputSimplifiedPcbTraces()
  const ledGreenTraces = traces.filter(
    (trace) => trace.connection_name === "source_net_2",
  )
  // The pin-to-pin path exists, but two additional copper islands remain.
  expect(ledGreenTraces).toHaveLength(3)
  expect(ledGreenTraces.map((trace) => trace.route[0])).toMatchObject([
    { x: -7.817, y: 2.5, layer: "bottom" },
    { x: 1.25, y: -4.15, layer: "top" },
    { x: -11.056, y: 2.5, layer: "top" },
  ])
  expect(ledGreenTraces[1]!.route.at(-1)).toMatchObject({
    x: -16.825,
    y: 11,
    layer: "top",
  })

  const circuitJson = [
    createPcbBoardElement(solver.originalSrj),
    ...convertToCircuitJson(solver.srjWithPointPairs!, traces, {
      originalSrj: solver.originalSrj,
    }),
  ]
  await expect(
    convertCircuitJsonToPcbSvg(circuitJson, {
      width: 1200,
      height: 900,
      includeVersion: false,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
