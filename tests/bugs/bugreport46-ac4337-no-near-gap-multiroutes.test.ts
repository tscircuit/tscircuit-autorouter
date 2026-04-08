import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { MAX_STITCH_GAP_DISTANCE_3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import bugReport from "../../fixtures/bug-reports/bugreport46-ac4337/bugreport46-ac4337-arduino-uno.json" with {
  type: "json",
}

test("bugreport46 stitch does not leave stitchable same-layer gaps at effort 2x", () => {
  const pipeline = new AutoroutingPipelineSolver4(
    structuredClone(bugReport.simple_route_json as any),
    { effort: 2 },
  )

  pipeline.solve()

  const hdRoutes = pipeline.traceSimplificationSolver?.simplifiedHdRoutes ?? []
  const routesByConnection = new Map<string, typeof hdRoutes>()

  for (const route of hdRoutes) {
    const routes = routesByConnection.get(route.connectionName) ?? []
    routes.push(route)
    routesByConnection.set(route.connectionName, routes)
  }

  const nearGapConnections = [...routesByConnection.entries()]
    .filter(([, routes]) => routes.length > 1)
    .map(([connectionName, routes]) => {
      let bestGap = Number.POSITIVE_INFINITY

      for (let i = 0; i < routes.length; i++) {
        for (let j = i + 1; j < routes.length; j++) {
          const endpointsA = [routes[i]!.route[0]!, routes[i]!.route.at(-1)!]
          const endpointsB = [routes[j]!.route[0]!, routes[j]!.route.at(-1)!]

          for (const endpointA of endpointsA) {
            for (const endpointB of endpointsB) {
              if (endpointA.z !== endpointB.z) continue
              bestGap = Math.min(
                bestGap,
                Math.hypot(
                  endpointB.x - endpointA.x,
                  endpointB.y - endpointA.y,
                ),
              )
            }
          }
        }
      }

      return { connectionName, bestGap }
    })
    .filter(({ bestGap }) => bestGap <= MAX_STITCH_GAP_DISTANCE_3)

  expect(nearGapConnections).toEqual([])
}, 120_000)
