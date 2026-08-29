import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-high-density-solver"
import { solvePipeline9NetworkedHighDensityNode } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/solve-pipeline9-networked-high-density-node"
import { PIPELINE9_NETWORKED_SOLVE_POLICY } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9-networked-types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("Pipeline9 networked terminal helper matches local ordinary plus regional fallback", () => {
  const portPoints = [
    { x: -1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 0, y: -1, z: 0, connectionName: "vertical" },
    { x: 0, y: 1, z: 0, connectionName: "vertical" },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_terminal_regional_parity",
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
    colorMap: { horizontal: "red", vertical: "blue" },
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    nodePfById: { cmn_terminal_regional_parity: 0.1 },
  })

  localSolver.solve()
  const remoteResult = solvePipeline9NetworkedHighDensityNode({
    solvePolicy: PIPELINE9_NETWORKED_SOLVE_POLICY,
    enableRegionalFallback: true,
    nodeWithPortPoints: node,
    connectivityNetMap: connMap.netMap,
    colorMap: { horizontal: "red", vertical: "blue" },
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
    obstacles: [],
    regionalObstacles: [],
    layerCount: 2,
    nodePf: 0.1,
  })

  expect(localSolver.solved).toBeTrue()
  expect(localSolver.stats.fallbackNodeCount).toBe(1)
  expect(remoteResult).toEqual({
    status: "solved",
    solutionStage: "regional-fallback",
    ordinaryFailure: expect.any(String),
    routes: localSolver.routes,
  })
})
