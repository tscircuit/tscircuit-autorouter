import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import input from "../../fixtures/repro/pocket-mic-rx/pocket-mic-rx.srj.json" with {
  type: "json",
}

function hasNonOctilinearSegment(route: SimplifiedPcbTrace["route"]): boolean {
  const tolerance = 0.005 // mm
  return route.slice(1).some((end, index) => {
    const start = route[index]!
    if (start.route_type !== "wire" || end.route_type !== "wire") return false
    const dx = Math.abs(end.x - start.x)
    const dy = Math.abs(end.y - start.y)
    return Math.min(dx, dy) > tolerance && Math.abs(dx - dy) > tolerance
  })
}

test("reproduces doglegs introduced by Pipeline 9 power expansion on Pocket Mic RX", async (): Promise<void> => {
  const inputSrj = input as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)

  const before = solver.getNewTracesBeforePowerExpansion()
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  // V3V3 branches from CPVDD to AVDD and from AVDD to the bypass capacitor.
  for (const terminal of ["pcb_port_172", "pcb_port_204"]) {
    const narrowRoute = before.find(
      (trace) =>
        trace.connectsTo?.includes("pcb_port_179") &&
        trace.connectsTo.includes(terminal),
    )!.route
    const wideRoute = routedTraces.find(
      (trace) =>
        trace.connectsTo?.includes("pcb_port_179") &&
        trace.connectsTo.includes(terminal),
    )!.route
    expect(
      wideRoute.every(
        (point) =>
          point.route_type === "wire" &&
          point.layer === "top" &&
          point.width === 0.3,
      ),
    ).toBe(true)
    expect(hasNonOctilinearSegment(narrowRoute)).toBe(false)
    expect(hasNonOctilinearSegment(wideRoute)).toBe(true)
  }
  await expect(
    getBugReportSnapshotSvg({
      inputSrj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
