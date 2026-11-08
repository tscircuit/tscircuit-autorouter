import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { GraphicsObject } from "graphics-debug"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { SimpleRouteJson } from "lib/types"
import { renderPlanarShortcutView } from "../fixtures/renderPlanarShortcutView"

test("RVboy still checks physical port capacity when duplication cannot complete", async (): Promise<void> => {
  // Exact phase input, including every board obstacle and retained route.
  const srj: SimpleRouteJson = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-failed-duplication.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
    effort: 5,
  })
  while (!solver.highDensityRouteSolver && !solver.failed) solver.step()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  const pathing = solver.portPointPathingSolver!
  expect(pathing.stats.duplicateCongestedPortError).toContain(
    "could not be solved independently",
  )
  expect(solver.uniformPortDistributionSolver!.solved).toBeTrue()
  const blockedUses = pathing
    .getOutput()
    .nodesWithPortPoints.flatMap((node) => node.portPoints)
    .filter(
      (port) =>
        port.portPointId === "ce45069_pp0_z0_cramped::0" &&
        solver.connMap.areIdsConnected(port.connectionName, "source_trace_283"),
    )
  expect(blockedUses).toHaveLength(0)
  const geometry = pathing.getConstructorParams()[0].portGeometry!
  const copper = geometry.retainedRoutes
    .filter((route) => route.isFixed)
    .map((route) => getPipeline9RouteCopperGeometry(route, geometry))
  for (const state of ["before", "after"] as const) {
    const graphics: GraphicsObject = {
      rects: geometry.obstacles
        .filter((o) => o.layers.includes("top") && o.width < 10)
        .map((o) => ({
          center: o.center,
          width: o.width,
          height: o.height,
          fill: "#cbd5e1",
          stroke: "#64748b",
        })),
      lines: copper.flatMap((g) =>
        g.wireSegments
          .filter((w) => w.z === 0)
          .flatMap((w) => [
            {
              points: [w.start, w.end],
              strokeWidth:
                w.width + geometry.traceWidth + 2 * geometry.clearance,
              strokeColor: "#fed7aa",
            },
            {
              points: [w.start, w.end],
              strokeWidth: w.width,
              strokeColor: "#64748b",
            },
          ]),
      ),
      circles: copper.flatMap((g) =>
        g.viaSpans
          .filter((v) => v.minZ <= 0 && v.maxZ >= 0)
          .map((v) => ({
            center: v.center,
            radius: v.diameter / 2,
            fill: "#64748b",
            stroke: "none",
          })),
      ),
    }
    const color = state === "before" ? "#dc2626" : "#16a34a"
    graphics.lines!.push({
      points: [
        { x: 6.325, y: 6.665 },
        { x: 6.325, y: 6.835 },
      ],
      strokeColor: color,
      strokeWidth: 0.035,
    })
    graphics.circles!.push({
      center: { x: 6.325, y: 6.75 },
      radius: 0.04,
      fill: color,
      stroke: "white",
    })
    if (state === "after")
      graphics.lines!.push(
        {
          points: [
            { x: 6.275, y: 6.7 },
            { x: 6.375, y: 6.8 },
          ],
          strokeColor: "#166534",
          strokeWidth: 0.018,
        },
        {
          points: [
            { x: 6.275, y: 6.8 },
            { x: 6.375, y: 6.7 },
          ],
          strokeColor: "#166534",
          strokeWidth: 0.018,
        },
      )
    await expect(
      renderPlanarShortcutView(graphics, {
        minX: 5.55,
        maxX: 7.1,
        minY: 6.4,
        maxY: 7.6,
      }),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: state })
  }
}, 120000)
