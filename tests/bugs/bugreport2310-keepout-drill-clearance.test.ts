import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { RELAXED_DRC_OPTIONS } from "lib/utils/drcPresets"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import bugReportSrj from "../../fixtures/bug-reports/bugreport2310-keepout-drill-clearance/bugreport2310.srj.json" with {
  type: "json",
}

test("Pipeline9 DRC evaluator detects wire and via clearance violations on unconnected keepouts and holes", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.6,
    minTraceToPadEdgeClearance: 0.15,
    minViaEdgeToPadEdgeClearance: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [],
    obstacles: [
      {
        obstacleId: "keepout_0",
        type: "rect",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        layers: ["top", "bottom"],
        connectedTo: [],
      },
      {
        obstacleId: "fanout_keepout_0",
        isFanoutSourceKeepout: true,
        type: "rect",
        center: { x: 3, y: 0 },
        width: 1,
        height: 1,
        layers: ["top", "bottom"],
        connectedTo: [],
      },
    ],
  }

  const grazingTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "trace_grazing",
    connection_name: "net_a",
    route: [
      { route_type: "wire", x: -2, y: 1.05, width: 0.15, layer: "top" },
      { route_type: "wire", x: 2, y: 1.05, width: 0.15, layer: "top" },
      { route_type: "wire", x: 2.5, y: 0, width: 0.15, layer: "top" },
      { route_type: "wire", x: 3.5, y: 0, width: 0.15, layer: "top" },
    ],
  }

  const evaluate = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: srj,
    srjWithPointPairs: srj,
    drcOptions: { includeTraceContinuity: false },
  })
  const result = evaluate([grazingTrace])

  expect(result.errors).toHaveLength(1)
  expect(result.errors[0]).toMatchObject({
    type: "pcb_trace_error",
    drc_source: "fixed_copper",
    pcb_obstacle_id: "keepout_0",
  })
})

test("Pipeline9 maintains clearance from unconnected drill holes and keepouts (#2310)", (): void => {
  const input = structuredClone(bugReportSrj) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const traces = solver.getOutputSimplifiedPcbTraces()

  const pipeline9Drc = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
  })(traces)
  expect(pipeline9Drc.errors).toEqual([])

  expect(
    evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
    }).errors,
  ).toEqual([])

  const requiredClearance =
    input.minTraceToPadEdgeClearance ??
    input.defaultObstacleMargin ??
    RELAXED_DRC_OPTIONS.traceClearance

  const unconnectedObstacles = input.obstacles.filter(
    (obstacle) =>
      obstacle.connectedTo.length === 0 &&
      !obstacle.isCopperPour &&
      !obstacle.isFanoutSourceKeepout,
  )
  expect(unconnectedObstacles.length).toBeGreaterThan(0)

  let minimumClearance = Infinity
  for (const obstacle of unconnectedObstacles) {
    const halfWidth = obstacle.width / 2
    const halfHeight = obstacle.height / 2
    const corners = [
      { x: obstacle.center.x - halfWidth, y: obstacle.center.y - halfHeight },
      { x: obstacle.center.x + halfWidth, y: obstacle.center.y - halfHeight },
      { x: obstacle.center.x + halfWidth, y: obstacle.center.y + halfHeight },
      { x: obstacle.center.x - halfWidth, y: obstacle.center.y + halfHeight },
    ]
    for (const trace of traces) {
      for (let index = 0; index < trace.route.length; index++) {
        const point = trace.route[index]!
        if (point.route_type === "via") {
          const dx = Math.max(
            0,
            Math.abs(point.x - obstacle.center.x) - halfWidth,
          )
          const dy = Math.max(
            0,
            Math.abs(point.y - obstacle.center.y) - halfHeight,
          )
          const clearance =
            Math.hypot(dx, dy) -
            (point.via_diameter ?? input.minViaDiameter ?? 0.6) / 2
          minimumClearance = Math.min(minimumClearance, clearance)
        }
        if (index + 1 < trace.route.length) {
          const start = trace.route[index]!
          const end = trace.route[index + 1]!
          if (start.route_type !== "wire" || end.route_type !== "wire") continue
          if (!obstacle.layers.includes(start.layer)) continue
          const endpointInside = [start, end].some(
            (pt) =>
              Math.abs(pt.x - obstacle.center.x) <= halfWidth &&
              Math.abs(pt.y - obstacle.center.y) <= halfHeight,
          )
          const distance = endpointInside
            ? 0
            : Math.min(
                ...corners.map((corner, cornerIndex) =>
                  minimumDistanceBetweenSegments(
                    start,
                    end,
                    corner,
                    corners[(cornerIndex + 1) % corners.length]!,
                  ),
                ),
              )
          minimumClearance = Math.min(
            minimumClearance,
            distance - Math.max(start.width, end.width) / 2,
          )
        }
      }
    }
  }

  expect(minimumClearance).toBeGreaterThanOrEqual(requiredClearance - 1e-6)
})
