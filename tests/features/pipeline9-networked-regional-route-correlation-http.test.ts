import { expect, test } from "bun:test"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedCrossingNode,
  createNetworkedHighDensitySolver,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9_Networked rejects uncorrelated regional routes", async () => {
  const node = createNetworkedCrossingNode({
    nodeId: "cmn_regional_route_correlation_http",
  })
  const server = new ExampleHdCache2Server({
    batchItemMode: "solve",
    mapBatchLine: (line) => ({
      ...line,
      routes: Array.isArray(line.routes)
        ? line.routes.map((route, index) => ({
            ...(route as Record<string, unknown>),
            route: [
              { x: 1000 + index * 10, y: 1000, z: 0 },
              { x: 1001 + index * 10, y: 1000, z: 0 },
            ],
            vias: [],
          }))
        : line.routes,
    }),
  })
  try {
    const solver = createNetworkedHighDensitySolver({
      nodes: [node],
      hdCache2ServerUrl: server.url,
      enableRegionalFallback: true,
      preserveTerminalPcbPortIds: false,
    })

    await solveNetworkedHighDensitySolver(solver)

    expect(solver.solved).toBeTrue()
    expect(
      solver.routes.every((route) => route.route.every(({ x }) => x < 100)),
    ).toBeTrue()
    expect(solver.stats).toMatchObject({
      fallbackNodeCount: 1,
      remoteRegionalFallbackResultsApplied: 0,
      remoteTransportFallbacks: 1,
      remoteFallbackReasonCounts: { invalid_response: 1 },
    })
  } finally {
    await server.close()
  }
})
