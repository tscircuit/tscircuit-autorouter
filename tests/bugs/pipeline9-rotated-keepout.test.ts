import { expect, test } from "bun:test"
import type { Point } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import srjJson from "../../fixtures/bug-reports/pipeline9-rotated-keepout/pipeline9-rotated-keepout.srj.json" with {
  type: "json",
}

test("Pipeline9 reproduces routing through an unconnected rotated keepout", async (): Promise<void> => {
  const input = structuredClone(srjJson) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(1)
  const route = traces[0]!.route
  expect(route.length).toBeGreaterThanOrEqual(2)
  expect(route[0]).toMatchObject({ x: -2, y: 0.5, layer: "top" })
  expect(route.at(-1)).toMatchObject({ x: 2, y: 0.5, layer: "top" })

  // Measure emitted copper against the ORIGINAL keepout, not the rectangles
  // produced by the preprocessing helper under test. Transforming to the
  // keepout's local coordinates allows exact segment/edge distance checks.
  const keepout = input.obstacles[0]!
  const radians = (keepout.ccwRotationDegrees! * Math.PI) / 180
  const toLocal = (point: Point): Point => {
    const dx = point.x - keepout.center.x
    const dy = point.y - keepout.center.y
    return {
      x: dx * Math.cos(radians) + dy * Math.sin(radians),
      y: -dx * Math.sin(radians) + dy * Math.cos(radians),
    }
  }
  const halfWidth = keepout.width / 2
  const halfHeight = keepout.height / 2
  const corners: Point[] = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]
  let minimumCopperClearance = Infinity
  for (let index = 1; index < route.length; index++) {
    const start = route[index - 1]!
    const end = route[index]!
    if (start.route_type !== "wire" || end.route_type !== "wire") {
      throw new Error("The single-layer reproduction must contain only wires")
    }
    expect(start.layer).toBe("top")
    expect(end.layer).toBe("top")
    expect(start.width).toBeGreaterThanOrEqual(input.minTraceWidth)
    expect(end.width).toBeGreaterThanOrEqual(input.minTraceWidth)
    const localStart = toLocal(start)
    const localEnd = toLocal(end)
    const endpointInside = [localStart, localEnd].some(
      (point) =>
        Math.abs(point.x) <= halfWidth && Math.abs(point.y) <= halfHeight,
    )
    const distance = endpointInside
      ? 0
      : Math.min(
          ...corners.map((corner, cornerIndex) =>
            minimumDistanceBetweenSegments(
              localStart,
              localEnd,
              corner,
              corners[(cornerIndex + 1) % corners.length]!,
            ),
          ),
        )
    minimumCopperClearance = Math.min(
      minimumCopperClearance,
      distance - Math.max(start.width, end.width) / 2,
    )
  }
  // Record the current bug. The stacked fix changes this assertion to require
  // the declared clearance and updates this same snapshot with a legal route.
  expect(minimumCopperClearance).toBeLessThan(0)

  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
    }).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path)
})
