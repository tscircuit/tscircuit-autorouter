import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import input from "./srj/usb-c-ethernet-vbus.json"

test("USB-C Ethernet VBUS does not double back past the connector", async (): Promise<void> => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    input as SimpleRouteJson,
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const vbusTrace = routedTraces.find(
    (trace) =>
      trace.connectsTo?.includes("pcb_port_15") &&
      trace.connectsTo.includes("pcb_port_20"),
  )!
  // Version 0.0.941 doubled back to x=-23.494; the connector pin is at x=-19.826.
  const wirePoints = vbusTrace.route.filter((point) => point.route_type === "wire")
  expect(Math.min(...wirePoints.map((point) => point.x))).toBeGreaterThan(-20)
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input as SimpleRouteJson,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
