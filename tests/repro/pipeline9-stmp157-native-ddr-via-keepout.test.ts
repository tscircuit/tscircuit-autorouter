import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"

test("BGA escape routes around a via-only keepout on the STM32MP157 DDR board", (): void => {
  const input: SimpleRouteJson = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../fixtures/assets/stmp157-native-ddr-via-space/input.srj.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  // This is an escape-via site selected by the unconstrained BGA solver.
  const center = { x: -10.13, y: -7.605 }
  const radius = 0.025
  input.viaKeepouts = [{ shape: "circle", center, radius, layers: ["top"] }]

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.highDensityRouteSolver?.completedBoardRoutes).toHaveLength(97)
  const routes = solver.getOutputSimplifiedPcbTraces()
  expect(routes).toHaveLength(97)
  expect(new Set(routes.map((trace) => trace.connection_name))).toEqual(
    new Set(input.connections.map((connection) => connection.name)),
  )
  const vias = routes.flatMap((trace) =>
    trace.route.filter((point) => point.route_type === "via"),
  )
  expect(vias.length).toBeGreaterThan(0)
  const { padDiameter } = getViaDimensions(input)
  for (const via of vias) {
    const copperRadius = (via.via_diameter ?? padDiameter) / 2
    const distance = Math.hypot(via.x - center.x, via.y - center.y)
    expect(distance).toBeGreaterThanOrEqual(radius + copperRadius - 1e-9)
  }
  expect(
    solver.getOutputSimpleRouteJson().traces?.filter((trace) => trace.isFixed),
  ).toEqual(input.traces)
})
