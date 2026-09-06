import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Pipeline9HighDensityForceContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceObstacles"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

type RepairContextAccess = {
  activeConnectionNames: Set<string>
  attemptedNodeIdsAtCurrentRevision: Set<string>
  getNodeRepairObstacles: (node: NodeWithPortPoints) => Obstacle[]
  invalidateChangedNodeContexts: (nextRoutes: HighDensityRoute[]) => void
  getNextAffectedNode: () => NodeWithPortPoints | undefined
}

test("Pipeline9 indexes copper and retries across the native port-point domain", (): void => {
  const nodes: NodeWithPortPoints[] = [
    {
      capacityMeshNodeId: "node-a",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      portPoints: [
        { x: -4, y: 0, z: 0, connectionName: "A" },
        { x: 1, y: 0, z: 0, connectionName: "A" },
      ],
    },
    {
      capacityMeshNodeId: "node-b",
      center: { x: -3, y: 0 },
      width: 1,
      height: 2,
      portPoints: [
        { x: -3, y: -1, z: 0, connectionName: "B" },
        { x: -3, y: 1, z: 0, connectionName: "B" },
      ],
    },
    {
      capacityMeshNodeId: "node-c",
      center: { x: 10, y: 0 },
      width: 2,
      height: 2,
      portPoints: [
        { x: 9, y: 0, z: 0, connectionName: "C" },
        { x: 11, y: 0, z: 0, connectionName: "C" },
      ],
    },
  ]
  const routes: HighDensityRoute[] = nodes.map((node) => ({
    connectionName: node.portPoints[0]!.connectionName,
    rootConnectionName: node.portPoints[0]!.connectionName,
    regionId: node.capacityMeshNodeId,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { ...node.portPoints[0]! },
      { ...node.center, z: 0 },
      { ...node.portPoints[1]! },
    ],
    vias: [],
  }))
  const fixedRoute: HighDensityRoute = {
    connectionName: "D",
    rootConnectionName: "D",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: -1, z: 0 },
      { x: -2, y: 1, z: 0 },
    ],
    vias: [],
  }
  const originalInputs = structuredClone({ nodes, routes, fixedRoute })
  const drcEvaluator = Object.assign(
    (): never => {
      throw new Error("The context-index regression must not evaluate DRCs")
    },
    {
      getForceContext: (): Pipeline9HighDensityForceContext => ({
        connMap: new ConnectivityMap({
          A: ["A", "A_0"],
          B: ["B", "B_0"],
          C: ["C", "C_0"],
          D: ["D"],
        }),
        obstacles: [],
      }),
    },
  )
  const solver = new Pipeline9HighDensityDrcRepairSolver({
    nodePortPoints: nodes,
    hdRoutes: routes,
    fixedHdRoutes: [fixedRoute],
    newConnections: nodes.map((node) => ({
      name: node.portPoints[0]!.connectionName,
      pointsToConnect: node.portPoints.map((point) => ({
        x: point.x,
        y: point.y,
        layer: "top",
      })),
    })),
    // This focused index regression does not run repair or assign DRC scores.
    drcEvaluator,
    connMap: new ConnectivityMap({
      A: ["A"],
      B: ["B"],
      C: ["C"],
      D: ["D"],
    }),
    colorMap: {},
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    drcClearance: 0.1,
    effort: 1,
  })
  const context = solver as unknown as RepairContextAccess
  context.activeConnectionNames.add("A")
  const obstacles = context.getNodeRepairObstacles(nodes[0]!)
  const obstacleConnections = new Set(
    obstacles.flatMap((obstacle) => obstacle.connectedTo),
  )
  expect(obstacleConnections.has("B")).toBe(true)
  expect(obstacleConnections.has("D")).toBe(true)
  expect(obstacleConnections.has("A")).toBe(false)
  expect(obstacleConnections.has("C")).toBe(false)

  // A changed fragment at x=-3 is outside A's nominal rectangle but inside its
  // actual routing domain. It must reopen A's context without retrying C.
  solver.currentErrors = [{ pcb_trace_id: "A_0" }, { pcb_trace_id: "C_0" }]
  for (const node of nodes) {
    context.attemptedNodeIdsAtCurrentRevision.add(node.capacityMeshNodeId)
  }
  expect(context.getNextAffectedNode()).toBeUndefined()
  solver.activeNode = nodes[1]!
  const changedRoute = structuredClone(routes[1]!)
  changedRoute.route[1]!.x = -2.8
  context.invalidateChangedNodeContexts([routes[0]!, changedRoute, routes[2]!])
  expect(context.attemptedNodeIdsAtCurrentRevision.has("node-a")).toBe(false)
  expect(context.attemptedNodeIdsAtCurrentRevision.has("node-b")).toBe(false)
  expect(context.attemptedNodeIdsAtCurrentRevision.has("node-c")).toBe(true)
  expect(context.getNextAffectedNode()).toBe(nodes[0])
  expect({ nodes, routes, fixedRoute }).toEqual(originalInputs)
})
