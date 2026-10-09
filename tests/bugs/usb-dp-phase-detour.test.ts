import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import input from "../fixtures/bug-reports/usb-dp-phase-detour/input.json"

test("routes the full MIDI keyboard with preloaded USB traces", async (): Promise<void> => {
  const srj: SimpleRouteJson = structuredClone(input)
  const usbDpConnectionName = "source_net_69"
  const originalUsbDp = srj.traces!.find(
    (trace) => trace.connection_name === usbDpConnectionName,
  )!
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    effort: 1,
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.solved).toBeTrue()
  const output = solver.getOutputSimpleRouteJson()
  const usbDp = output.traces!.find(
    (trace) => trace.connection_name === usbDpConnectionName,
  )!
  expect(
    usbDp.route.filter((point) => point.route_type === "via"),
  ).toHaveLength(2)
  expect(usbDp.route[0]).toEqual(originalUsbDp.route[0])
  expect(usbDp.route.at(-1)).toEqual(originalUsbDp.route.at(-1))
  const drcInput = {
    inputSrj: output,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: [],
    includeBoardClearance: true,
  }
  expect(evaluateRelaxedDrc(drcInput).errors).toEqual([])
  let svgName: string | undefined
  if (process.platform === "linux") svgName = "linux"
  await expect(getBugReportSnapshotSvg(drcInput)).toMatchSvgSnapshot(
    import.meta.path,
    { svgName },
  )
})
