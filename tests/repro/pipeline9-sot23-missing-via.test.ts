import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {
  combinePreloadedAndRoutedTraces,
  evaluateRelaxedDrc,
} from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"
import capturedInput from "./assets/pipeline9-sot23-missing-via.json"

test("preserves vias while completing SOT-23 breakout routing", async (): Promise<void> => {
  const input = structuredClone(capturedInput) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const repairedTraces = solver.getUpdatedPreloadedTraces()
  const affectedTrace = repairedTraces.find(
    (trace) =>
      trace.pcb_trace_id ===
      "source_trace_0__breakout:pcb_breakout_point_2_mst1_0",
  )!
  const missingTransitions = affectedTrace.route.flatMap((point, index, route) => {
    const nextPoint = route[index + 1]
    return point.route_type === "wire" &&
      nextPoint?.route_type === "wire" &&
      point.layer !== nextPoint.layer
      ? [{ x: point.x, y: point.y }]
      : []
  })
  expect(missingTransitions).toHaveLength(0)
  const transitionVias = affectedTrace.route.filter(
    (point) => point.route_type === "via",
  )
  expect(transitionVias).toHaveLength(2)

  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const snapshotInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  }
  expect(evaluateRelaxedDrc(snapshotInput).errors).toEqual([])
  await expect(getBugReportSnapshotSvg(snapshotInput)).toMatchSvgSnapshot(
    import.meta.path,
    { svgName: "routed-board" },
  )

  const inputGraphics = convertSrjToGraphicsObject(input)
  const routedGraphics = convertSrjToGraphicsObject({
    ...input,
    traces: combinePreloadedAndRoutedTraces(input.traces ?? [], routedTraces),
  })
  inputGraphics.points = []
  routedGraphics.points = []
  routedGraphics.circles = [
    ...(routedGraphics.circles ?? []),
    ...transitionVias.map((via) => ({
      center: { x: via.x, y: via.y },
      radius: 0.45,
      stroke: "#166534",
      fill: "transparent",
    })),
  ]
  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "INPUT: valid top-layer breakout copper",
          step: "start",
          graphics: inputGraphics,
        },
        {
          name: "FIXED: both circled transitions have vias; routing completes",
          pipeline: "end",
          graphics: routedGraphics,
        },
      ],
      columns: 2,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
