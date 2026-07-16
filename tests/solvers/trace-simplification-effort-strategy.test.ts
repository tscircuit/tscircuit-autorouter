import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("higher effort unlocks a wider same-net via merge strategy", () => {
  const makeViaRoute = (
    connectionName: string,
    x: number,
  ): HighDensityRoute => ({
    connectionName,
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x, y: 0, z: 0 },
      { x, y: 0, z: 1 },
    ],
    vias: [{ x, y: 0 }],
  })
  const hdRoutes = [makeViaRoute("route-a", 0), makeViaRoute("route-b", 0.85)]
  const connMap = new ConnectivityMap({
    net0: hdRoutes.map((route) => route.connectionName),
  })
  const createSolver = (effort: number) =>
    new TraceSimplificationSolver({
      hdRoutes,
      obstacles: [],
      connMap,
      colorMap: {},
      defaultViaDiameter: 0.3,
      layerCount: 2,
      effort,
      drcEvaluator: () => [],
    })

  const oneX = createSolver(1)
  oneX.solve()
  const fiveX = createSolver(5)
  fiveX.solve()

  const countPhysicalVias = (routes: HighDensityRoute[]) =>
    new Set(
      routes.flatMap((route) =>
        route.route.flatMap((point, index, points) => {
          const previousPoint = points[index - 1]
          return previousPoint && previousPoint.z !== point.z
            ? [`${point.x.toFixed(3)}:${point.y.toFixed(3)}`]
            : []
        }),
      ),
    ).size
  expect(countPhysicalVias(oneX.simplifiedHdRoutes)).toBe(2)
  expect(countPhysicalVias(fiveX.simplifiedHdRoutes)).toBe(1)
  expect(fiveX.simplificationPipelineLoops).toBeGreaterThan(
    oneX.simplificationPipelineLoops,
  )
})
