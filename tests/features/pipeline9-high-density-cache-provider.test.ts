import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { InMemoryCache } from "lib/cache/InMemoryCache"

test("Pipeline9 passes its cache provider to intra-node routing", () => {
  const cacheProvider = new InMemoryCache()
  const solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "cache-propagation-node",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        availableZ: [0],
        portPoints: [
          { x: -1, y: 0, z: 0, connectionName: "signal" },
          { x: 1, y: 0, z: 0, connectionName: "signal" },
        ],
      },
    ],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({}),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 0.1,
    cacheProvider,
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(cacheProvider.cacheMisses).toBeGreaterThan(0)
  expect(cacheProvider.getAllCacheKeys().length).toBeGreaterThan(0)
})
