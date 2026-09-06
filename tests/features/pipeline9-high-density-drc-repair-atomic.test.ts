import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types/srj-types"

const createNode = (
  nodeId: string,
  connectionName: string,
  y: number,
): NodeWithPortPoints => ({
  capacityMeshNodeId: nodeId,
  center: { x: 0, y },
  width: 4,
  height: 2,
  availableZ: [0, 1],
  portPoints: [
    { x: -2, y, z: 0, connectionName, rootConnectionName: connectionName },
    { x: 2, y, z: 0, connectionName, rootConnectionName: connectionName },
  ],
})

const nodes = [createNode("node-a", "A", -2), createNode("node-b", "B", 2)]
const connections: SimpleRouteConnection[] = nodes.map((node) => ({
  name: node.portPoints[0]!.connectionName,
  pointsToConnect: node.portPoints.map((point) => ({
    x: point.x,
    y: point.y,
    layer: "top",
  })),
}))
const inputRoutes: HighDensityRoute[] = nodes.map((node) => ({
  connectionName: node.portPoints[0]!.connectionName,
  rootConnectionName: node.portPoints[0]!.connectionName,
  regionId: node.capacityMeshNodeId,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: node.portPoints.map((point) => ({ x: point.x, y: point.y, z: 0 })),
  vias: [],
}))
const obstacles: Obstacle[] = nodes.map((node) => ({
  obstacleId: `obstacle-${node.capacityMeshNodeId}`,
  type: "rect",
  layers: ["top"],
  center: node.center,
  width: 0.2,
  height: 0.2,
  connectedTo: [],
}))
test("Pipeline9 retains a local repair while independent node DRCs remain", (): void => {
  const connMap = new ConnectivityMap({ A: ["A"], B: ["B"] })
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -3, maxX: 3, minY: -4, maxY: 4 },
    connections,
    obstacles,
  }
  const drcEvaluator = createPipeline9HighDensityDrcEvaluator({
    connections,
    originalConnections: connections,
    hdRoutes: inputRoutes,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    originalSrj: srj,
    srjWithPointPairs: srj,
    layerCount: 2,
    obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
  })
  const solver = new Pipeline9HighDensityDrcRepairSolver({
    nodePortPoints: nodes,
    hdRoutes: inputRoutes,
    fixedHdRoutes: [],
    newConnections: connections,
    drcEvaluator,
    connMap,
    colorMap: {},
    obstacles,
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    drcClearance: 0.1,
    effort: 0.1,
  })

  solver.step()
  const initialDrcIssueCount = Number(solver.stats.initialDrcIssueCount)
  while (
    !solver.solved &&
    !solver.failed &&
    solver.currentErrors.length >= initialDrcIssueCount
  ) {
    solver.step()
  }

  expect(Number(solver.stats.acceptedRepairCount)).toBeGreaterThan(0)
  expect(solver.currentErrors.length).toBeGreaterThan(0)
  expect(solver.currentErrors.length).toBeLessThan(
    initialDrcIssueCount,
  )
  expect(solver.outputHdRoutes[1]).toBe(inputRoutes[1])

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats).toMatchObject({
    finalDrcIssueCount: 0,
    attemptedNodeCount: 2,
    acceptedNodeCount: 2,
  })
  expect(solver.getOutput()).not.toEqual(inputRoutes)
})
