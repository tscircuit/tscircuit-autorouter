import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9NetworkedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/Pipeline9NetworkedHighDensitySolver"
import { PIPELINE9_NETWORKED_NODE_SIMPLIFICATION_SOLVE_POLICY, type Pipeline9NetworkedSolveBatchRequest } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import { createNetworkedNode, solveNetworkedHighDensitySolver } from "tests/fixtures/pipeline9-networked-fixtures"

test("experimental node shortcuts use a separate network policy and match local solving", async () => {
  const params = {
    nodePortPoints: [createNetworkedNode({ nodeId: "node", connectionName: "a", xOffset: 0 })],
    fixedHdRoutes: [], connMap: new ConnectivityMap({ root_a: ["a", "root_a"] }),
    colorMap: {}, obstacles: [], layerCount: 2, viaDiameter: 0.6, traceWidth: 0.2,
    obstacleMargin: 0.2, effort: 1, enableNodeSimplification: true,
  }
  const local = new Pipeline9HighDensitySolver(params)
  local.solve()
  const server = new ExampleHdCache2Server({ batchItemMode: "solve" })
  try {
    const remote = new Pipeline9NetworkedHighDensitySolver({
      ...params, autorouterVersion: AUTOROUTER_VERSION, hdCache2ServerUrl: server.url,
    })
    await solveNetworkedHighDensitySolver(remote)
    expect(remote.solved).toBeTrue()
    expect(remote.routes).toEqual(local.routes)
    expect(local.stats.nodeSimplification_routeCount).toBeGreaterThan(0)
    const request = server.batchRequests[0]!.body as Pipeline9NetworkedSolveBatchRequest
    expect(request.items[0]!.input.solvePolicy).toBe(PIPELINE9_NETWORKED_NODE_SIMPLIFICATION_SOLVE_POLICY)
  } finally {
    await server.close()
  }
})
