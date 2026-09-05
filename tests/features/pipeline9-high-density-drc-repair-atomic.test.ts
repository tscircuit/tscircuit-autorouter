import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteConnection } from "lib/types/srj-types"

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
const drcEvaluator: DrcEvaluator = () => {
  const errors = inputRoutes.map((route, index) => ({
    type: "pcb_trace_error",
    pcb_trace_id: `${route.connectionName}_0`,
    pcb_trace_ids: [`${route.connectionName}_0`],
    pcb_trace_error_id: `error_${route.connectionName}_0`,
    center: { x: 0, y: index === 0 ? -2 : 2 },
    message: "independent high-density DRC",
  }))
  return { errors, errorsWithCenters: errors }
}

test("Pipeline9 preserves routes when no single node can clear every DRC", (): void => {
  const solver = new Pipeline9HighDensityDrcRepairSolver({
    nodePortPoints: nodes,
    hdRoutes: inputRoutes,
    newConnections: connections,
    drcEvaluator,
    connMap: new ConnectivityMap({ A: ["A"], B: ["B"] }),
    colorMap: {},
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 0.1,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats).toMatchObject({
    initialDrcIssueCount: 2,
    finalDrcIssueCount: 2,
    attemptedNodeCount: 0,
    acceptedNodeCount: 0,
  })
  expect(solver.getOutput()).toEqual(inputRoutes)
})
