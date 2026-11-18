import { expect, test } from "bun:test"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {
  convertToCircuitJson,
  createPcbBoardElement,
} from "lib/utils/convertToCircuitJson"
import {
  h616ViaTopologyInput,
  h616ViaTopologyLabels,
} from "tests/fixtures/h616PreloadedViaTopology"

test("Pipeline9 reproduces the blocked H616 RAM corner", async (): Promise<void> => {
  const input = structuredClone(h616ViaTopologyInput)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.failed).toBe(true)
  const circuitJson = convertToCircuitJson(input, input.traces!, {
    originalSrj: input,
    includeOriginalConnections: true,
  })

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
