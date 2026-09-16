import { expect, test } from "bun:test"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedCrossingNode,
  createNetworkedHighDensitySolver,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 rejects a remote ordinary failure when another layer remains untried", async (): Promise<void> => {
  const node = createNetworkedCrossingNode({
    nodeId: "untried-regional-layer",
  })
  const server = new ExampleHdCache2Server({
    batchItemMode: "solve",
    mapBatchLine: ({ ordinaryFailure, routes, ...line }) => ({
      ...line,
      solutionStage: "ordinary",
      status: "failed",
      error: "Ordinary routing failed before trying the remaining layer",
    }),
  })
  try {
    const solver = createNetworkedHighDensitySolver({
      nodes: [node],
      hdCache2ServerUrl: server.url,
      enableRegionalFallback: true,
      layerCount: 2,
      traceWidth: 0.1,
    })

    await solveNetworkedHighDensitySolver(solver)

    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.stats).toMatchObject({
      fallbackNodeCount: 1,
      remoteFailedResults: 0,
      remoteTransportFallbacks: 1,
      remoteFallbackReasonCounts: { invalid_response: 1 },
    })
    expect(
      solver.routes.some((route) =>
        route.route.some((point) => point.z === 1),
      ),
    ).toBeTrue()
  } finally {
    await server.close()
  }
})
