import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { GraphicsObject } from "graphics-debug"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

type Capture = {
  input: ConstructorParameters<typeof MultipleHighDensityRouteStitchSolver3>[0]
  before: HighDensityRoute[]
  obstacles: SimpleRouteJson["obstacles"]
}

test("RVboy stitching follows existing copper to SD_CLK instead of a synthetic shortcut into a dead end", async (): Promise<void> => {
  // Full captured board input, including foreign routes used by clearance.
  // Only the drawing is cropped; no route or obstacle is removed from the solve.
  const capture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-stitch-copper-path.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as Capture
  const original = structuredClone(capture.input)
  const solver = new MultipleHighDensityRouteStitchSolver3(capture.input)
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  expect(capture.input).toEqual(original)
  const after = solver.mergedHdRoutes.filter(
    (route) => route.connectionName === "source_net_32",
  )
  const before = capture.before.filter(
    (route) => route.connectionName === "source_net_32",
  )
  expect(after).toHaveLength(1)
  expect(before).toHaveLength(1)
  expect(before[0]!.route.at(-1)).not.toEqual({ x: -6, y: 12.525, z: 0 })
  expect(after[0]!.route[0]).toEqual({ x: -10.31, y: 15.5, z: 0 })
  expect(after[0]!.route.at(-1)).toEqual({ x: -6, y: 12.525, z: 0 })
  expect(after[0]!.startPcbPortId).toBe("pcb_port_599")
  expect(after[0]!.endPcbPortId).toBe("pcb_port_176")
  expect(after[0]!.route).not.toContainEqual({ x: -6.6725, y: 14.595, z: 3 })
  const viewbox = { minX: -11, maxX: -5.4, minY: 11.5, maxY: 16.2 }
  for (const [name, routes] of [
    ["before", before],
    ["after", after],
  ] as const) {
    const graphics: GraphicsObject = convertSrjToGraphicsObject({
      bounds: viewbox,
      layerCount: 4,
      minTraceWidth: 0.1,
      connections: [],
      obstacles: capture.obstacles.filter(
        (o) =>
          !o.isCopperPour &&
          o.center.x + o.width / 2 >= viewbox.minX &&
          o.center.x - o.width / 2 <= viewbox.maxX &&
          o.center.y + o.height / 2 >= viewbox.minY &&
          o.center.y - o.height / 2 <= viewbox.maxY,
      ),
      traces: routes.map((route) => ({
        type: "pcb_trace" as const,
        pcb_trace_id: route.connectionName,
        connection_name: route.connectionName,
        route: convertHdRouteToSimplifiedRoute(route, 4),
      })),
    })
    graphics.lines = [
      ...(graphics.lines ?? []),
      {
        points: Array.from({ length: 65 }, (_, index) => ({
          x: -6 + 0.3 * Math.cos((index * Math.PI) / 32),
          y: 12.525 + 0.3 * Math.sin((index * Math.PI) / 32),
        })),
        strokeColor: "#119944",
        strokeWidth: 0.03,
        label: "SD_CLK pad",
      },
    ]
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        "RVboy: SD clock terminal stitching",
        name === "before"
          ? "Before: route follows a bottom-layer dead end; green-ringed pad is open"
          : "After: existing copper reaches the green-ringed top-layer pad",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
