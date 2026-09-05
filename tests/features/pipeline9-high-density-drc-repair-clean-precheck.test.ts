import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteConnection } from "lib/types/srj-types"

const node: NodeWithPortPoints = {
  capacityMeshNodeId: "node-a",
  center: { x: 0, y: 0 },
  width: 4,
  height: 2,
  availableZ: [0, 1],
  portPoints: [
    { x: -2, y: 0, z: 0, connectionName: "A", rootConnectionName: "A" },
    { x: 2, y: 0, z: 0, connectionName: "A", rootConnectionName: "A" },
  ],
}
const connections: SimpleRouteConnection[] = [
  {
    name: "A",
    pointsToConnect: [
      { x: -2, y: 0, layer: "top" },
      { x: 2, y: 0, layer: "top" },
    ],
  },
]
const inputRoutes: HighDensityRoute[] = [
  {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "node-a",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  },
]

test("Pipeline9 skips the full DRC evaluator for clean high-density copper", (): void => {
  let evaluatorCallCount = 0
  const drcEvaluator: DrcEvaluator = () => {
    evaluatorCallCount += 1
    return { errors: [], errorsWithCenters: [] }
  }
  const solver = new Pipeline9HighDensityDrcRepairSolver({
    nodePortPoints: [node],
    hdRoutes: inputRoutes,
    fixedHdRoutes: [],
    newConnections: connections,
    drcEvaluator,
    connMap: new ConnectivityMap({ A: ["A"] }),
    colorMap: {},
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    drcClearance: 0.1,
    effort: 0.1,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(evaluatorCallCount).toBe(0)
  expect(solver.stats.drcPrecheckFoundPotentialIssue).toBe(false)
  expect(solver.getOutput()).toBe(inputRoutes)
})
