import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import phase1Input from "../fixtures/bug-reports/usb-dp-phase-detour/input.json"
import phase0Input from "../fixtures/bug-reports/usb-dp-phase-detour/phase-0.input.json"

test("routes the USB shield through both MIDI keyboard phases", async (): Promise<void> => {
  const phase0Srj: SimpleRouteJson = structuredClone(phase0Input)
  const phase0 = new AutoroutingPipelineSolver9_PreloadedTraceGraph(phase0Srj, {
    effort: 1,
    cacheProvider: null,
  })
  phase0.solve()
  expect(phase0.solved).toBeTrue()
  const phase0Output = phase0.getOutputSimpleRouteJson()
  expect(phase0Output.traces).toHaveLength(21)
  const shield = phase0Output.traces!.find(
    (trace) => trace.pcb_trace_id === "source_net_16_mst4_0",
  )!
  expect(shield.connectsTo).toEqual(["pcb_port_32", "pcb_port_30"])
  const wirePoints = shield.route.filter((point) => point.route_type === "wire")
  expect(wirePoints).toHaveLength(shield.route.length)
  let shieldLength = 0
  for (let index = 1; index < wirePoints.length; index++) {
    const previous = wirePoints[index - 1]!
    const point = wirePoints[index]!
    shieldLength += Math.hypot(point.x - previous.x, point.y - previous.y)
  }
  const maximumShieldLength = 10
  expect(shieldLength).toBeLessThan(maximumShieldLength)
  const phase0Drc = {
    inputSrj: phase0Output,
    srjWithPointPairs: phase0.srjWithPointPairs!,
    routedTraces: [],
    includeBoardClearance: true,
  }
  expect(evaluateRelaxedDrc(phase0Drc).errors).toEqual([])
  let phase0SvgName = "phase-0"
  let finalSvgName = "final"
  if (process.platform === "linux") {
    phase0SvgName = "phase-0-linux"
    finalSvgName = "final-linux"
  }
  await expect(getBugReportSnapshotSvg(phase0Drc)).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: phase0SvgName },
  )

  const phase1Srj: SimpleRouteJson = structuredClone(phase1Input)
  phase1Srj.traces = phase0Output.traces
  const phase1 = new AutoroutingPipelineSolver9_PreloadedTraceGraph(phase1Srj, {
    effort: 1,
    cacheProvider: null,
  })
  phase1.solve()
  expect(phase1.solved).toBeTrue()
  const output = phase1.getOutputSimpleRouteJson()
  expect(
    output.traces!.find((trace) => trace.pcb_trace_id === shield.pcb_trace_id),
  ).toEqual(shield)
  const finalDrc = {
    inputSrj: output,
    srjWithPointPairs: phase1.srjWithPointPairs!,
    routedTraces: [],
    includeBoardClearance: true,
  }
  expect(evaluateRelaxedDrc(finalDrc).errors).toEqual([])
  await expect(getBugReportSnapshotSvg(finalDrc)).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: finalSvgName },
  )
})
