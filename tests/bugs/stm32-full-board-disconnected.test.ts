import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { areNodePortPointPairsConnectedByRoutes } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import type { SimpleRouteJson } from "lib/types"
import board from "../fixtures/stm32-full-board-disconnected.json"

test("STM32 full board routes LED_GREEN without disconnected fragments", async (): Promise<void> => {
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
  expect(ledGreenTraces).toHaveLength(1)
  expect(ledGreenTraces[0]!.route[0]).toMatchObject({
    x: 1.25,
    y: -4.15,
    layer: "top",
  })
  expect(ledGreenTraces[0]!.route.at(-1)).toMatchObject({
    x: -16.825,
    y: 11,
    layer: "top",
  })

  const revisitedNode = solver.highDensityNodePortPoints!.find(
    (node) => node.capacityMeshNodeId === "cmn_39",
  )!
  expect(
    areNodePortPointPairsConnectedByRoutes(
      solver.highDensityRouteSolver!.routes,
      revisitedNode,
    ),
  ).toBeTrue()

  await expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
