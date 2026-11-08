import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SimpleRouteJson } from "lib/types"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderPlanarShortcutView } from "../fixtures/renderPlanarShortcutView"

test("RVboy retains the VSEL escape when fixed power copper closes the ordinary exit", async (): Promise<void> => {
  // Complete captured final-phase input, including all 97 retained traces.
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-fixed-copper-terminal-escape.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const original = JSON.stringify(input)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    effort: 5,
    cacheProvider: null,
  })
  while (!solver.portPointPathingSolver?.solved && !solver.failed) solver.step()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.portPointPathingSolver!.solved).toBeTrue()
  const connection = solver.srjWithPointPairs!.connections.find((connection) =>
    connection.pointsToConnect.some((point) => point.pointId === "pcb_port_43"),
  )!
  const plannedSegments = solver
    .portPointPathingSolver!.getOutput()
    .nodesWithPortPoints.map((node) =>
      node.portPoints.filter(
        (point) => point.connectionName === connection.name,
      ),
    )
    .filter((points) => points.length > 0)
  expect(plannedSegments.length).toBeGreaterThan(1)
  const bridge = solver
    .availableSegmentPointSolver!.getOutput()
    .find(
      (segment) =>
        segment.crossesNumericalGap &&
        segment.isActiveTerminalEscape &&
        Math.abs(segment.start.y + 31.84757895) < 1e-6 &&
        segment.start.x < -33.4 &&
        segment.end.x > -33.4,
    )
  expect(bridge).toBeDefined()
  expect(input.traces).toHaveLength(97)
  expect(JSON.stringify(input)).toBe(original)
  for (const state of ["before", "after"] as const) {
    const graphics = convertSrjToGraphicsObject({
      ...input,
      obstacles: input.obstacles.filter((obstacle) => !obstacle.isCopperPour),
      connections: [],
    })
    for (const point of connection.pointsToConnect) {
      graphics.circles!.push({
        center: point,
        radius: 0.12,
        fill: "white",
        stroke: state === "before" ? "#d21b27" : "#087f23",
      })
    }
    // Green segments are the solved routing graph, not fabricated copper.
    if (state === "after")
      for (const points of plannedSegments)
        graphics.lines!.push({
          points,
          strokeColor: "#087f23",
          strokeWidth: 0.07,
        })
    await expect(
      renderPlanarShortcutView(graphics, {
        minX: -34.1,
        maxX: -32.8,
        minY: -32.5,
        maxY: -31.3,
      }),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: state })
  }
})
