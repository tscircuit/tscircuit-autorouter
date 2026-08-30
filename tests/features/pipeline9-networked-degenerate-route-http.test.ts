import { expect, test } from "bun:test"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9_Networked rejects a route that returns to the same terminal", async () => {
  const node = createNetworkedNode({
    nodeId: "cmn_degenerate_route_http",
    connectionName: "degenerate_route_http",
  })
  node.portPointsInPairs = [[node.portPoints[0]!, node.portPoints[1]!]]
  const server = new ExampleHdCache2Server({
    batchItemMode: "solve",
    mapBatchLine: (line) => ({
      ...line,
      routes: Array.isArray(line.routes)
        ? line.routes.map((route) => {
            const typedRoute = route as {
              route: Array<Record<string, unknown>>
            }
            return {
              ...(route as Record<string, unknown>),
              route: [typedRoute.route[0], typedRoute.route[0]],
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
    expect(solver.routes[0]!.route[0]).toMatchObject({ x: -2, y: 0, z: 0 })
    expect(solver.routes[0]!.route.at(-1)).toMatchObject({ x: 2, y: 0, z: 0 })
    expect(solver.stats.remoteFallbackReasonCounts).toEqual({
      invalid_response: 1,
    })
  } finally {
    await server.close()
  }
})
