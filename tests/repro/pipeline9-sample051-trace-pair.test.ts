import { expect, test } from "bun:test"
import { sample051 } from "@tscircuit/dataset-srj33-drc-failures"
import { getSvgFromGraphicsObject } from "graphics-debug"
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
  expect(errors).toContainEqual(
    expect.objectContaining({
      type: "pcb_trace_error",
      pcb_trace_error_id: "overlap_source_net_25_0_source_net_2_mst1_0",
    }),
  )
  await expect(getBugReportSnapshotSvg(result)).toMatchSvgSnapshot(
    import.meta.path,
  )
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
    getSvgFromGraphicsObject(detail, {
      backgroundColor: "white",
      includeTextLabels: false,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "terminal-detail" })
})
