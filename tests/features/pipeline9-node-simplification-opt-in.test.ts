import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegularNodeSolver"
import { createNetworkedNode } from "tests/fixtures/pipeline9-networked-fixtures"

test("node simplification is opt-in and default routing uses the original solver", () => {
  const params = {
    nodeWithPortPoints: createNetworkedNode({ nodeId: "node", connectionName: "a", xOffset: 0 }),
    connMap: new ConnectivityMap({}), colorMap: {}, viaDiameter: 0.6,
    traceWidth: 0.2, obstacleMargin: 0.2, effort: 1, nodePfById: {}, obstacles: [], layerCount: 2,
  }
  const normal = createPipeline9RegularNodeSolver(params)
  const experimental = createPipeline9RegularNodeSolver({ ...params, enableNodeSimplification: true })
  expect(normal).not.toBeInstanceOf(Pipeline9RegularNodeSolver)
  expect(experimental).toBeInstanceOf(Pipeline9RegularNodeSolver)
  normal.solve()
  experimental.solve()
  expect(normal.solved).toBeTrue()
  expect(experimental.solved).toBeTrue()
  expect(normal.stats.nodeSimplification).toBeUndefined()
  expect(experimental.stats.nodeSimplification.routeCount).toBeGreaterThan(0)
})
