import { expect, test } from "bun:test"
import type { HighDensityRoute } from "@tscircuit/trace-simplification-solver"
import { Pipeline9LayerPreservingPathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9LayerPreservingPathSolver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import rawFixture from "../fixtures/pipeline9-path-layer-transition.json" with { type: "json" }

type CapturedPathFixture = {
  inputRoute: HighDensityRoute
  outline: Array<{ x: number; y: number }>
  minBoardEdgeClearance: number
  connMap: Record<string, string[]>
  obstacleSegments: Array<HighDensityRoute["route"]>
  vias: Array<{ x: number; y: number; diameter: number }>
  obstacles: ConstructorParameters<
    typeof Pipeline9LayerPreservingPathSolver
  >[0]["obstacles"]
}
const fixture = rawFixture as CapturedPathFixture

test("the captured Bug94 path pass preserves every physical via and its layer transition", () => {
  const routes = [structuredClone(fixture.inputRoute)]
  const original = structuredClone(routes)
  const otherHdRoutes: HighDensityRoute[] = [
    ...fixture.obstacleSegments.map((route, index) => ({
      connectionName: `foreign-wire-${index}`,
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route,
      vias: [],
    })),
    ...fixture.vias.map((via, index) => ({
      connectionName: `foreign-via-${index}`,
      traceThickness: 0.15,
      viaDiameter: via.diameter,
      route: [],
      vias: [{ x: via.x, y: via.y }],
    })),
  ]
  const solver = new Pipeline9LayerPreservingPathSolver({
    unsimplifiedHdRoutes: routes,
    otherHdRoutes,
    obstacles: fixture.obstacles,
    connMap: new ConnectivityMap(fixture.connMap),
    outline: fixture.outline,
    minBoardEdgeClearance: fixture.minBoardEdgeClearance,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.simplifiedHdRoutes).toHaveLength(original.length)
  for (const [index, route] of solver.simplifiedHdRoutes.entries()) {
    expect(route.vias).toEqual(original[index]!.vias)
    expect(route.route[0]).toEqual(original[index]!.route[0])
    expect(route.route.at(-1)).toEqual(original[index]!.route.at(-1))
    for (let pointIndex = 1; pointIndex < route.route.length; pointIndex++) {
      const previous = route.route[pointIndex - 1]!,
        point = route.route[pointIndex]!
      if (
        previous.z === point.z ||
        previous.toNextSegmentType === "through_obstacle"
      )
        continue
      expect(point.x).toBe(previous.x)
      expect(point.y).toBe(previous.y)
    }
  }
  const target = solver.simplifiedHdRoutes[0]!
  expect(target.connectionName).toBe("source_trace_163")
  expect(target.vias).toHaveLength(4)
  expect(
    target.route.some(
      (point, index) =>
        index > 0 &&
        point.x === 4.095284595958737 &&
        point.y === -17.159258416066958 &&
        point.z === 1 &&
        target.route[index - 1]!.z === 0,
    ),
  ).toBe(true)
  expect(routes).toEqual(original)
})
