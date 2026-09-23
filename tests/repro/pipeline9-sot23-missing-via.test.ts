import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"
import capturedInput from "./assets/pipeline9-sot23-missing-via.json"

test("reproduces a missing via in a repaired SOT-23 breakout trace", async (): Promise<void> => {
  const input = structuredClone(capturedInput) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("changes layer without a transition")
  const repairedTraces = solver.getUpdatedPreloadedTraces()
  const affectedTrace = repairedTraces.find(
    (trace) =>
      trace.pcb_trace_id ===
      "source_trace_0__breakout:pcb_breakout_point_2_mst1_0",
  )!
  const missingTransition = affectedTrace.route.find((point, index, route) => {
    const nextPoint = route[index + 1]
    return point.route_type === "wire" && nextPoint?.route_type === "wire" &&
      point.layer !== nextPoint.layer
  })!
  expect(missingTransition).toBeDefined()

  const inputGraphics = convertSrjToGraphicsObject(input)
  const failedGraphics = convertSrjToGraphicsObject({
    ...input,
    traces: repairedTraces,
  })
  inputGraphics.points = []
  failedGraphics.points = []
  failedGraphics.circles = [
    ...(failedGraphics.circles ?? []),
    { center: { x: 0.1996162861946772, y: 3.0796535377487517 }, radius: 0.45, stroke: "#b91c1c", fill: "transparent" },
  ]
  await expect(getGraphicsSvgFrames({
    frames: [
      { name: "INPUT: seven valid breakout traces; the affected route stays on top", pipeline: "start", graphics: inputGraphics },
      { name: "BUG: red circle marks a top/bottom jump with no via; routing aborts", pipeline: "end", graphics: failedGraphics },
    ],
    columns: 2,
    backgroundColor: "white",
  })).toMatchSvgSnapshot(import.meta.path)
})
