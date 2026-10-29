import { expect, test } from "bun:test"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedHighDensitySolver,
  createNetworkedNode,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9_Networked rejects ordinary routes outside assigned layers", async () => {
  const node = createNetworkedNode({
    nodeId: "cmn_ordinary_layer_assignment_http",
    connectionName: "ordinary_layer_assignment_http",
  })
  node.availableZ = [0]
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
              route: [start, { ...start, z: 1 }, { ...end, z: 1 }, end],
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
    expect(
      solver.routes.flatMap((route) => route.route).every(({ z }) => z === 0),
    ).toBeTrue()
    expect(solver.stats.remoteFallbackReasonCounts).toEqual({
      invalid_response: 1,
    })
  } finally {
    await server.close()
  }
})
