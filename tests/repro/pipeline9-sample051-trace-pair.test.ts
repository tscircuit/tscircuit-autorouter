import { expect, test } from "bun:test"
import { sample051 } from "@tscircuit/dataset-srj33-drc-failures"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { safeTransparentize } from "lib/solvers/colors"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("Pipeline9 reproduces the solar charger's terminal trace-pair collision", async (): Promise<void> => {
  const input = structuredClone(sample051) as unknown as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 1,
  })
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const result = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }
  const { errors } = evaluateRelaxedDrc(result)
  expect(result.routedTraces.length).toBeGreaterThan(0)
  expect(errors).toHaveLength(2)
  expect(errors).toContainEqual(
    expect.objectContaining({
      type: "pcb_trace_error",
      pcb_trace_error_id: "overlap_source_net_25_0_source_net_2_mst1_0",
    }),
  )
  expect(errors).toContainEqual(
    expect.objectContaining({
      pcb_trace_error_id: "overlap_source_net_25_0_pcb_smtpad_9.800_2.600",
    }),
  )
  expect(input).toEqual(sample051 as unknown as SimpleRouteJson)
  const traceA = result.routedTraces.find(
    (trace) => trace.pcb_trace_id === "source_net_25_0",
  )!
  const traceB = result.routedTraces.find(
    (trace) => trace.pcb_trace_id === "source_net_2_mst1_0",
  )!
  // Lowering the DRC count by moving a terminal off its original center is
  // not a valid repair. Keep both traces connected at their input coordinates.
  const inputPoints = input.connections.flatMap(
    (connection) => connection.pointsToConnect,
  )
  for (const trace of [traceA, traceB]) {
    const terminalPoints = inputPoints.filter(
      (point) =>
        point.pcb_port_id !== undefined &&
        trace.connectsTo?.includes(point.pcb_port_id),
    )
    expect(terminalPoints).toHaveLength(2)
    for (const point of terminalPoints) {
      expect([trace.route[0], trace.route.at(-1)]).toContainEqual(
        expect.objectContaining({
          x: point.x,
          y: point.y,
          layer: point.layer,
        }),
      )
    }
    for (const point of trace.route) {
      if (point.route_type === "wire") {
        expect(point.width).toBe(input.minTraceWidth)
      }
    }
  }
  let minimumPairClearance = Number.POSITIVE_INFINITY
  for (let i = 1; i < traceA.route.length; i++) {
    const a = traceA.route[i - 1]!
    const b = traceA.route[i]!
    if (a.route_type !== "wire" || b.route_type !== "wire") continue
    if (a.layer !== b.layer) continue
    for (let j = 1; j < traceB.route.length; j++) {
      const c = traceB.route[j - 1]!
      const d = traceB.route[j]!
      if (c.route_type !== "wire" || d.route_type !== "wire") continue
      if (c.layer !== d.layer || a.layer !== c.layer) continue
      minimumPairClearance = Math.min(
        minimumPairClearance,
        segmentToSegmentMinDistance(a, b, c, d) -
          Math.max(a.width, b.width) / 2 -
          Math.max(c.width, d.width) / 2,
      )
    }
  }
  // The DRC message reports the first contact, not the worst contact. Check
  // copper geometry too, so changing an error ID cannot make this repro pass.
  expect(minimumPairClearance).toBeLessThan(0.1)
  await expect(
    getBugReportSnapshotSvg(result, { roundTraceCaps: true }).replace(
      /[ \t]+$/gm,
      "",
    ),
  ).toMatchSvgSnapshot(import.meta.path)
  const detail = convertSrjToGraphicsObject(
    {
      ...input,
      bounds: { minX: 8.3, maxX: 10.7, minY: 1.5, maxY: 4.5 },
      obstacles: input.obstacles.filter(
        (obstacle) => obstacle.componentId === "pcb_component_12",
      ),
      traces: result.routedTraces
        .filter((trace) =>
          ["source_net_25_0", "source_net_2_mst1_0"].includes(
            trace.pcb_trace_id,
          ),
        )
        .map((trace) => ({
          ...trace,
          route: trace.route.filter(
            (point) =>
              "x" in point &&
              point.x >= 8.3 &&
              point.x <= 10.7 &&
              point.y >= 1.5 &&
              point.y <= 4.5,
          ),
        })),
    },
    { traceColorMode: "net" },
  )
  detail.points = []
  // Normalize HSL net colors for the SVG rasterizer used by the matcher.
  for (const line of detail.lines) {
    line.strokeColor = safeTransparentize(line.strokeColor!, 0)
  }
  for (const circle of detail.circles) {
    circle.fill = safeTransparentize(circle.fill!, 0)
  }
  await expect(
    getBugReportSnapshotSvg(result, {
      graphics: detail,
      includeTextLabels: false,
      roundTraceCaps: true,
    }).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "terminal-detail" })
})
