import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("STMP157 native DDR preloads carry their fixed policy into the graph", async (): Promise<void> => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../fixtures/assets/stmp157-native-ddr-preloads.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const originalInput = structuredClone(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
    effort: 1,
  })
  while (
    !solver.failed &&
    !solver.solved &&
    !solver.preloadedTraceGraphSolver?.solved
  ) {
    solver.step()
  }
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.preloadedTraceGraphSolver?.solved).toBeTrue()
  const assignments =
    solver.sharedEdgeSegmentsWithNecessaryCrampedPortPoints!.flatMap(
      (segment) =>
        segment.portPoints.flatMap(
          (port) => port._preloadedTracePortAssignments ?? [],
        ),
    )
  const fixedAssignmentCount = assignments.filter(
    (assignment) => "isFixed" in assignment && assignment.isFixed === true,
  ).length
  let assignmentColor = "red"
  if (fixedAssignmentCount === assignments.length) assignmentColor = "green"
  const graphics: GraphicsObject = convertSrjToGraphicsObject(input)
  const minX = Math.min(
    ...input.obstacles.map(
      (obstacle) => obstacle.center.x - obstacle.width / 2,
    ),
  )
  const maxY = Math.max(
    ...input.obstacles.map(
      (obstacle) => obstacle.center.y + obstacle.height / 2,
    ),
  )
  graphics.texts = [
    {
      x: minX,
      y: maxY + 3,
      text: "STMP157 DDR INPUT: 32 completed DQ traces; DQM0 not routed",
      fontSize: 0.65,
      anchorSide: "center_left",
    },
    {
      x: minX,
      y: maxY + 1.5,
      text: `Native preloads: ${solver.preloadedTraceGraphSolver!.stats.preloadedTraceCount}; fixed graph assignments: ${fixedAssignmentCount}/${assignments.length}`,
      fontSize: 0.65,
      anchorSide: "center_left",
      color: assignmentColor,
    },
  ]
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(input.obstacles).toHaveLength(710)
  expect(input.connections).toHaveLength(1)
  expect(input.traces).toHaveLength(32)
  expect(
    new Set(assignments.map((assignment) => assignment.traceId)).size,
  ).toBe(32)
  expect(solver.srj.traces).toEqual(input.traces)
  expect(input).toEqual(originalInput)
})
