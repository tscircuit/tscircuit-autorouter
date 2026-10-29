import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedHighDensitySolver,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 terminal regional fallback matches the local solver over HTTP", async () => {
  const portPoints: NodeWithPortPoints["portPoints"] = [
    { x: -1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 0, y: -1, z: 0, connectionName: "vertical" },
    { x: 0, y: 1, z: 0, connectionName: "vertical" },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_http_terminal_regional",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints,
    portPointsInPairs: [
      [portPoints[0]!, portPoints[1]!],
      [portPoints[2]!, portPoints[3]!],
    ],
  }
  const connMap = new ConnectivityMap({
    horizontal: ["horizontal"],
    vertical: ["vertical"],
  })
  const localSolver = new Pipeline9HighDensitySolver({
    nodePortPoints: [node],
    fixedHdRoutes: [],
    connMap,
    colorMap: { horizontal: "blue", vertical: "blue" },
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: { [node.capacityMeshNodeId]: 0.1 },
    preserveTerminalPcbPortIds: false,
    enableRegionalFallback: true,
  })
  localSolver.solve()
  expect(localSolver.solved).toBeTrue()
  expect(localSolver.stats.fallbackNodeCount).toBe(1)

  const server = new ExampleHdCache2Server({ batchItemMode: "solve" })
  try {
    const solver = createNetworkedHighDensitySolver({
      nodes: [node],
      hdCache2ServerUrl: server.url,
      enableRegionalFallback: true,
      preserveTerminalPcbPortIds: false,
    })

    await solveNetworkedHighDensitySolver(solver)

    expect(solver.solved).toBeTrue()
    expect(server.batchRequests).toHaveLength(1)
    expect(server.solveRequests).toHaveLength(0)
    const localRoutesAfterJsonTransport = JSON.parse(
      JSON.stringify(localSolver.routes),
    )
    expect(solver.routes).toEqual(localRoutesAfterJsonTransport)
    expect(solver.stats).toMatchObject({
      fallbackNodeCount: 1,
      remoteRegionalFallbackResults: 1,
      remoteRegionalFallbackResultsApplied: 1,
      remoteRegionalFallbackResultsDeferredToLocal: 0,
      remoteSolverResults: 1,
      remoteTransportFallbacks: 0,
    })
  } finally {
    await server.close()
  }
})
