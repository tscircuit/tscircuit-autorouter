import { expect, test } from "bun:test"
import type { Point } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { filterObstaclesOutsideBoard } from "lib/utils/filterObstaclesOutsideBoard"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import srjJson from "../../fixtures/bug-reports/rotated-boundary-obstacle/rotated-boundary-obstacle.srj.json" with {
  type: "json",
}

test("repro: Pipeline9 drops a rotated boundary obstacle and routes through it", async (): Promise<void> => {
  for (const withOutline of [false, true]) {
    for (const axisAlignedControl of [false, true]) {
      const input = structuredClone(srjJson) as SimpleRouteJson
      if (!withOutline) delete input.outline
      if (axisAlignedControl) {
        // Exactly the same physical rectangle, expressed without rotation.
        input.obstacles[0] = {
          ...input.obstacles[0]!,
          width: 8,
          height: 1,
          ccwRotationDegrees: 0,
        }
      }
      const originalInput = structuredClone(input)
      const filtered = filterObstaclesOutsideBoard(input)
      expect(
        filtered.obstacles.some(
          (obstacle) => obstacle.obstacleId === "boundary_keepout",
        ),
      ).toBe(axisAlignedControl)
      expect(
        filtered.obstacles.filter((obstacle) =>
          obstacle.obstacleId?.startsWith("terminal_"),
        ),
      ).toHaveLength(2)

      // Run every normal stage, with the ORIGINAL input, not pre-filtered data.
      const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
        cacheProvider: null,
      })
      solver.solve()
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      expect(solver.error).toBeNull()
      expect(input).toEqual(originalInput)
      const traces = solver.getOutputSimplifiedPcbTraces()
      expect(traces).toHaveLength(1)
      const route = traces[0]!.route
      expect(route.length).toBeGreaterThanOrEqual(2)
      expect(route[0]).toMatchObject({ x: 2, y: -3, layer: "top" })
      expect(route.at(-1)).toMatchObject({ x: 2, y: 3, layer: "top" })

      // Independently test emitted centerlines against the ORIGINAL physical
      // exclusion: x=[1,9], y=[-0.5,0.5] in board-world mm (+X right, +Y up).
      // This does not reuse the preprocessing helper's incorrect bounds.
      const corners: Point[] = [
        { x: 1, y: -0.5 },
        { x: 9, y: -0.5 },
        { x: 9, y: 0.5 },
        { x: 1, y: 0.5 },
      ]
      let minimumCenterlineDistance = Infinity
      for (let index = 1; index < route.length; index++) {
        const start = route[index - 1]!
        const end = route[index]!
        if (start.route_type !== "wire" || end.route_type !== "wire") {
          throw new Error("This reproduction expects planar wires only")
        }
        expect(start.layer).toBe("top")
        expect(end.layer).toBe("top")
        expect(start.width).toBeGreaterThanOrEqual(input.minTraceWidth)
        const endpointInside = [start, end].some(
          (point) => point.x >= 1 && point.x <= 9 && Math.abs(point.y) <= 0.5,
        )
        minimumCenterlineDistance = Math.min(
          minimumCenterlineDistance,
          endpointInside
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
              ),
        )
      }
      // Characterize the bug: rotation loses the obstacle and permits a
      // centerline intersection; equivalent axis-aligned geometry does not.
      expect(minimumCenterlineDistance === 0).toBe(!axisAlignedControl)

      await expect(
        getBugReportSnapshotSvg({
          inputSrj: originalInput,
          srjWithPointPairs: solver.srjWithPointPairs!,
          routedTraces: traces,
        }).replace(/[ \t]+$/gm, ""),
      ).toMatchSvgSnapshot(import.meta.path, {
        svgName: `${withOutline ? "outline" : "bounds"}-${axisAlignedControl ? "control" : "bug"}`,
      })
    }
  }
})
