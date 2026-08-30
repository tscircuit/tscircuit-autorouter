import { expect, test } from "bun:test"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9_Networked rejects layer changes without a via", async () => {
  const node = createNetworkedNode({
    nodeId: "cmn_layer_transition_http",
    connectionName: "layer_transition_http",
  })
  const server = new ExampleHdCache2Server({
    batchItemMode: "solve",
    mapBatchLine: (line) => ({
      ...line,
      routes: Array.isArray(line.routes)
        ? line.routes.map((route) => {
            const typedRoute = route as {
              route: Array<Record<string, unknown>>
            }
            const start = typedRoute.route[0]!
            const end = typedRoute.route.at(-1)!
            return {
              ...(route as Record<string, unknown>),
              route: [start, { ...end, z: 1 }, end],
              vias: [],
            }
          })
        : line.routes,
    }),
  })
  try {
    const solver = createNetworkedHighDensitySolver({
      nodes: [node],
      hdCache2ServerUrl: server.url,
    })

    await solveNetworkedHighDensitySolver(solver)

    expect(solver.solved).toBeTrue()
    expect(solver.routes[0]!.route).toHaveLength(2)
    expect(solver.stats.remoteFallbackReasonCounts).toEqual({
      invalid_response: 1,
    })
  } finally {
    await server.close()
  }
})
