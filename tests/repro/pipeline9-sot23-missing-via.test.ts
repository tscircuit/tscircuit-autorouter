import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {
  combinePreloadedAndRoutedTraces,
  evaluateRelaxedDrc,
} from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { getGraphicsSvgFrames } from "../fixtures/solver-svg-frames"
import capturedInput from "./assets/pipeline9-sot23-missing-via.json"

test("completes connected SOT-23 breakout routing with at most two detour vias", async (): Promise<void> => {
  const input = structuredClone(capturedInput) as SimpleRouteJson
  const originalTrace = input.traces!.find(
    (trace) =>
      trace.pcb_trace_id ===
      "source_trace_0__breakout:pcb_breakout_point_2_mst1_0",
  )
  if (!originalTrace) throw new Error("Captured SOT-23 breakout trace is missing")
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
  )
  if (!affectedTrace) throw new Error("Repaired SOT-23 breakout trace is missing")
  expect(affectedTrace.route[0]).toEqual(originalTrace.route[0])
  expect(affectedTrace.route.at(-1)).toEqual(originalTrace.route.at(-1))
  expect(affectedTrace.connectsTo).toEqual(originalTrace.connectsTo)
  expect(affectedTrace.__replaces_pcb_trace_id).toBe(originalTrace.pcb_trace_id)
  const missingTransitions = affectedTrace.route.flatMap(
    (point, index, route) => {
      const nextPoint = route[index + 1]
      return point.route_type === "wire" &&
        nextPoint?.route_type === "wire" &&
        point.layer !== nextPoint.layer
        ? [{ x: point.x, y: point.y }]
        : []
    },
  )
  expect(missingTransitions).toHaveLength(0)
  const transitionVias = affectedTrace.route.filter(
    (point) => point.route_type === "via",
  )
  // Same-layer routing can eliminate the old detour while preserving its pads.
  expect(transitionVias.length).toBeLessThanOrEqual(2)
  const viaDimensions = getViaDimensions(input)
  for (const [index, point] of affectedTrace.route.entries()) {
    if (point.route_type !== "via") continue
    const before = affectedTrace.route[index - 1]
    const after = affectedTrace.route[index + 1]
    if (before?.route_type !== "wire" || after?.route_type !== "wire") {
      throw new Error("Physical detour via must join two wires")
    }
    expect(point.via_diameter).toBe(viaDimensions.padDiameter)
    expect(point.via_hole_diameter).toBe(viaDimensions.holeDiameter)
    expect([point.from_layer, point.to_layer].sort()).toEqual([
      "bottom",
      "top",
    ])
    expect(before.layer).toBe(point.from_layer)
    expect(after.layer).toBe(point.to_layer)
    expect({ x: before.x, y: before.y }).toEqual({ x: point.x, y: point.y })
    expect({ x: after.x, y: after.y }).toEqual({ x: point.x, y: point.y })
    if (point.layers !== undefined) {
      expect([...point.layers].sort()).toEqual(["bottom", "top"])
    }
  }

  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const snapshotInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  }
  const drc = evaluateRelaxedDrc(snapshotInput)
  expect(drc.errors).toEqual([])
  expect(getDrcErrors(drc.circuitJson).errors).toEqual([])
  expect(
    getDrcErrors(drc.circuitJson, {
      traceClearance: input.minTraceToPadEdgeClearance,
      holeClearance: input.minTraceToHoleEdgeClearance,
      viaClearance: input.minViaHoleEdgeToViaHoleEdgeClearance,
    }).errors,
  ).toEqual([])
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
          name: "FIXED: connected breakout uses at most two detour vias",
          pipeline: "end",
          graphics: routedGraphics,
        },
      ],
      columns: 2,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
