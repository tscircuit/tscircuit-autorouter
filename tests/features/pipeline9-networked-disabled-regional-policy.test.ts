import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-high-density-solver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"
import {
  createNetworkedHighDensitySolver,
  solveNetworkedHighDensitySolver,
} from "tests/fixtures/pipeline9-networked-fixtures"

test("Pipeline9 networked respects disabled regional fallback over HTTP", async () => {
  const portPoints = [
    { x: -1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 0, y: -1, z: 0, connectionName: "vertical" },
    { x: 0, y: 1, z: 0, connectionName: "vertical" },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_disabled_terminal_regional",
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
    colorMap: {},
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: { cmn_disabled_terminal_regional: 0.1 },
    enableRegionalFallback: false,
  })
  localSolver.solve()
  const server = new ExampleHdCache2Server({ batchItemMode: "solve" })
  try {
    const networkedSolver = createNetworkedHighDensitySolver({
      nodes: [node],
      hdCache2ServerUrl: server.url,
      enableRegionalFallback: false,
      traceWidth: 0.1,
    })
    await solveNetworkedHighDensitySolver(networkedSolver)

    expect(localSolver.failed).toBeTrue()
    expect(networkedSolver.failed).toBeTrue()
    expect(networkedSolver.error).toBe(localSolver.error)
    expect(networkedSolver.stats).toMatchObject({
      remoteOrdinaryResults: 1,
      remoteTransportFallbacks: 0,
    })
  } finally {
    await server.close()
  }
})
