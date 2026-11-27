import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import inputJson from "../../fixtures/bug-reports/icepi-ram-capacitor-via/icepi-ram-capacitor-via.srj.json"

test("iCE/Pi RAM H2 and C58 need a via beside fixed DDR copper", async (): Promise<void> => {
  const input = structuredClone(inputJson) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.getCurrentPhase()).toBe("portPointPathingSolver")
  expect(solver.error).toContain("No path for 0 (source_net_50)")
  await expect(
    getSvgFromGraphicsObject(convertSrjToGraphicsObject(input), {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)

  const withoutFixedCopper: SimpleRouteJson = { ...input, traces: [] }
  const control = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    withoutFixedCopper,
    { cacheProvider: null },
  )
  control.solve()
  expect(control.solved).toBe(true)
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: withoutFixedCopper,
      srjWithPointPairs: control.srjWithPointPairs!,
      routedTraces: control.getOutputSimplifiedPcbTraces(),
    }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "without-fixed-copper" })
})
