import { expect, test } from "bun:test"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedCrossingNode,
  createNetworkedHighDensitySolver,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9_Networked rejects an extra uncorrelated regional route", async () => {
  const node = createNetworkedCrossingNode({
    nodeId: "cmn_regional_extra_route_http",
  })
  const server = new ExampleHdCache2Server({
    batchItemMode: "solve",
    mapBatchLine: (line) => {
      if (!Array.isArray(line.routes) || line.routes.length === 0) return line
      return {
        ...line,
        routes: [
          ...line.routes,
          {
            ...(line.routes[0] as Record<string, unknown>),
            route: [
              { x: 1000, y: 1000, z: 0 },
              { x: 1000, y: 1000, z: 0 },
            ],
            vias: [{ x: 1000, y: 1000 }],
          },
        ],
      }
    },
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
    expect(solver.stats.remoteFallbackReasonCounts).toEqual({
      invalid_response: 1,
    })
  } finally {
    await server.close()
  }
})
