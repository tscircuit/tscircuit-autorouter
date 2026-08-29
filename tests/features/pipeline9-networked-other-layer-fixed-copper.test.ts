import { expect, test } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"
import {
  asNetworkedFetch,
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  createNetworkedResponse,
  createNetworkedRoute,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 networked defers a terminal regional result when fixed copper overlaps only its opened layers", async () => {
  const node = createNetworkedNode({
    nodeId: "cmn_other_layer_fixed_copper",
    connectionName: "A",
  })
  node.availableZ = [0]
  const otherLayerFixedRoute: PreloadedHighDensityRoute = {
    connectionName: "fixed_on_z1",
    rootConnectionName: "fixed_on_z1",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: -2, z: 1 },
      { x: 0, y: 2, z: 1 },
    ],
    vias: [],
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
  }
  const solver = createNetworkedHighDensitySolver({
    nodes: [node],
    fixedHdRoutes: [otherLayerFixedRoute],
    fetchImpl: asNetworkedFetch(async () =>
      createNetworkedResponse({
        status: "solved",
        solutionStage: "regional-fallback",
        ordinaryFailure: "ordinary solver could not cross on z0",
        routes: [createNetworkedRoute(node)],
      }),
    ),
    enableRegionalFallback: true,
  })

  solver.step()
  await solver.pendingEffects![0]!.promise
  solver.step()

  expect(solver.routes).toEqual([])
  expect(solver.activeRegularSolver).toBeNull()
  expect(solver.activeFallbackSolver).not.toBeNull()
  expect(solver.activeFallbackFixedObstacleRoutes).toEqual([
    otherLayerFixedRoute,
  ])
  expect(solver.stats.remoteRegionalFallbackResults).toBe(1)
  expect(solver.stats.remoteRegionalFallbackResultsApplied).toBe(0)
  expect(solver.stats.remoteRegionalFallbackResultsDeferredToLocal).toBe(1)
  expect(solver.stats.remoteTransportFallbacks).toBe(0)
})
