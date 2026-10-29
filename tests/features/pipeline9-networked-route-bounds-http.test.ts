import { expect, test } from "bun:test"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9_Networked rejects route points outside the solver envelope", async () => {
  const node = createNetworkedNode({
    nodeId: "cmn_route_bounds_http",
    connectionName: "route_bounds_http",
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
            return {
              ...(route as Record<string, unknown>),
              route: [
                typedRoute.route[0],
                { x: 1000, y: 1000, z: 0 },
                typedRoute.route.at(-1),
              ],
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
