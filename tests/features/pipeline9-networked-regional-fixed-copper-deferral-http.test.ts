import { expect, test } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedCrossingNode,
  createNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("fixed copper defers a remote regional result", async () => {
  const node = createNetworkedCrossingNode({
    nodeId: "cmn_other_layer_fixed_http",
  })
  const otherLayerFixedRoute: PreloadedHighDensityRoute = {
    connectionName: "fixed_foreign",
    rootConnectionName: "root_fixed_foreign",
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
  const server = new ExampleHdCache2Server({ batchItemMode: "solve" })
  try {
    const solver = createNetworkedHighDensitySolver({
      nodes: [node],
      fixedHdRoutes: [otherLayerFixedRoute],
      enableRegionalFallback: true,
      hdCache2ServerUrl: server.url,
      preserveTerminalPcbPortIds: false,
    })

    solver.step()
    await solver.pendingEffects![0]!.promise
    solver.step()

    expect(solver.routes).toEqual([])
    expect(solver.activeFallbackSolver).not.toBeNull()
    expect(solver.activeFallbackFixedObstacleRoutes).toEqual([
      otherLayerFixedRoute,
    ])
    expect(solver.stats.remoteRegionalFallbackResults).toBe(1)
    expect(solver.stats.remoteRegionalFallbackResultsApplied).toBe(0)
    expect(solver.stats.remoteRegionalFallbackResultsDeferredToLocal).toBe(1)
  } finally {
    await server.close()
  }
})
