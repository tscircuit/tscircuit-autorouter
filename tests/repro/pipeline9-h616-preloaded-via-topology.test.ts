import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { checkTraceContinuity } from "lib/utils/autorouting-drc/checkTraceContinuity"
import {
  convertToCircuitJson,
  createPcbBoardElement,
} from "lib/utils/convertToCircuitJson"
import {
  h616ViaTopologyInput,
  h616ViaTopologyLabels,
} from "tests/fixtures/h616PreloadedViaTopology"

test("Pipeline9 routes the H616 RAM corner", async (): Promise<void> => {
  const input = structuredClone(h616ViaTopologyInput)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  const output = solver.getOutputSimpleRouteJson()
  const circuitJson = convertToCircuitJson(input, output.traces!, {
    originalSrj: input,
    includeOriginalConnections: true,
  })
  expect(checkTraceContinuity(circuitJson)).toEqual([])
  expect(output.traces!.map((trace) => trace.pcb_trace_id)).toEqual(
    expect.arrayContaining(input.traces!.map((trace) => trace.pcb_trace_id)),
  )
  expect(
    output.traces!
      .flatMap((trace) => trace.route)
      .some((point) => point.route_type === "through_obstacle"),
  ).toBe(false)

  await expect(
    convertCircuitJsonToPcbSvg(
      [
        ...circuitJson,
        createPcbBoardElement(input),
        ...h616ViaTopologyLabels,
      ],
      {
        width: 1200,
        height: 1200,
        backgroundColor: "white",
        includeVersion: false,
        shouldDrawErrors: false,
        drawPaddingOutsideBoard: false,
        renderSolderMask: false,
        colorOverrides: { silkscreen: { top: "#334155", bottom: "#334155" } },
      },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
})
