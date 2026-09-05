import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteConnection } from "lib/types/srj-types"

const portPoints: NodeWithPortPoints["portPoints"] = [
  { x: -4, y: -2, z: 0, connectionName: "A", rootConnectionName: "A" },
  { x: 4, y: -2, z: 0, connectionName: "A", rootConnectionName: "A" },
  { x: -4, y: 2, z: 0, connectionName: "B", rootConnectionName: "B" },
  { x: 4, y: 2, z: 0, connectionName: "B", rootConnectionName: "B" },
  { x: -4, y: 0, z: 1, connectionName: "C", rootConnectionName: "C" },
  { x: 4, y: 0, z: 1, connectionName: "C", rootConnectionName: "C" },
]

const node: NodeWithPortPoints = {
  capacityMeshNodeId: "repair-node",
  center: { x: 0, y: 0 },
  width: 8,
  height: 6,
  availableZ: [0, 1],
  portPoints,
  portPointsInPairs: [
    [portPoints[0]!, portPoints[1]!],
    [portPoints[2]!, portPoints[3]!],
    [portPoints[4]!, portPoints[5]!],
  ],
}

const connections: SimpleRouteConnection[] = [
  {
    name: "A",
    pointsToConnect: [
      { x: -4, y: -2, layer: "top" },
      { x: 4, y: -2, layer: "top" },
    ],
  },
  {
    name: "B",
    pointsToConnect: [
      { x: -4, y: 2, layer: "top" },
      { x: 4, y: 2, layer: "top" },
    ],
  },
  {
    name: "C",
    pointsToConnect: [
      { x: -4, y: 0, layer: "bottom" },
      { x: 4, y: 0, layer: "bottom" },
    ],
  },
]

const inputRoutes: HighDensityRoute[] = [
  {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: node.capacityMeshNodeId,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -4, y: -2, z: 0 },
      { x: 0, y: 2, z: 0 },
      { x: 4, y: -2, z: 0 },
    ],
    vias: [],
  },
  {
    connectionName: "B",
    rootConnectionName: "B",
    regionId: node.capacityMeshNodeId,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -4, y: 2, z: 0 },
      { x: 0, y: -2, z: 0 },
      { x: 4, y: 2, z: 0 },
    ],
    vias: [],
  },
  {
    connectionName: "C",
    rootConnectionName: "C",
    regionId: node.capacityMeshNodeId,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -4, y: 0, z: 1 },
      { x: 4, y: 0, z: 1 },
    ],
    vias: [],
  },
]

const drcEvaluator: DrcEvaluator = ({ hdRoutes, routes }) => {
  const evaluatedRoutes = hdRoutes ?? routes ?? []
  const routeA = evaluatedRoutes.find((route) => route.connectionName === "A")
  const routeB = evaluatedRoutes.find((route) => route.connectionName === "B")
  const hasCrossingInputGeometry =
    routeA?.route[1]?.x === 0 &&
    routeA.route[1]?.y === 2 &&
    routeB?.route[1]?.x === 0 &&
    routeB.route[1]?.y === -2
  const errors = hasCrossingInputGeometry
    ? [
        {
          type: "pcb_trace_error",
          pcb_trace_id: "A_0",
          pcb_trace_ids: ["A_0", "B_0"],
          pcb_trace_error_id: "overlap_A_0_B_0",
          center: { x: 0, y: 0 },
          message: "crossing high-density routes",
        },
      ]
    : []
  return { errors, errorsWithCenters: errors }
}

test("Pipeline9 reroutes DRC-bearing high-density nodes before stitching", (): void => {
  const solver = new Pipeline9HighDensityDrcRepairSolver({
    nodePortPoints: [node],
    hdRoutes: inputRoutes,
    fixedHdRoutes: [],
    newConnections: connections,
    drcEvaluator,
    connMap: new ConnectivityMap({ A: ["A"], B: ["B"], C: ["C"] }),
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
    initialDrcIssueCount: 1,
    finalDrcIssueCount: 0,
    attemptedNodeCount: 1,
    acceptedNodeCount: 1,
    exhaustedNodeCount: 0,
  })
  expect(solver.getOutput()).not.toEqual(inputRoutes)
  expect(
    solver.getOutput().find((route) => route.connectionName === "C"),
  ).toEqual(inputRoutes.find((route) => route.connectionName === "C"))
})
