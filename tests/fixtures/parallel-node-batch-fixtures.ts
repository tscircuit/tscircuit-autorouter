import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { ParallelForceImproveNodeJob, ParallelRepairNodeJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerTypes"

export function createParallelNodeBatchFixture(count: number = 134): {
  nodes: NodeWithPortPoints[]; routes: HighDensityRoute[];
  forceJobs: ParallelForceImproveNodeJob[]; repairJobs: ParallelRepairNodeJob[];
} {
  const nodes: NodeWithPortPoints[] = []
  const routes: HighDensityRoute[] = []
  const forceJobs: ParallelForceImproveNodeJob[] = []
  const repairJobs: ParallelRepairNodeJob[] = []
  for (let index = 0; index < count; index++) {
    const node: NodeWithPortPoints = {
      capacityMeshNodeId: `batch-node-${index}`, center: { x: index * 10, y: 0 },
      width: 6, height: 6, availableZ: [0, 1], portPoints: [],
    }
    const pointCount = index % 33 === 1 ? 41 : 2
    const route: HighDensityRoute = {
      connectionName: `batch-signal-${index}`, rootConnectionName: `batch-root-${index}`,
      regionId: node.capacityMeshNodeId, traceThickness: 0.15, viaDiameter: 0.3,
      startPcbPortId: `batch-start-${index}`, endPcbPortId: `batch-end-${index}`, vias: [],
      route: Array.from({ length: pointCount }, (_, pointIndex) => ({
        x: node.center.x - 2 + 4 * pointIndex / (pointCount - 1), y: 0, z: 0,
      })),
    }
    nodes.push(node)
    routes.push(route)
    forceJobs.push({ kind: "forceImproveNode", nodeWithPortPoints: node, hdRoutes: [route],
      totalStepsPerNode: 0, nodeAssignmentMargin: 0.2 })
    repairJobs.push({ kind: "repairNode", margin: 0.2, sample: {
      nodeWithPortPoints: node, nodeHdRoutes: [{ ...route, capacityMeshNodeId: node.capacityMeshNodeId }],
      fixedHdRoutes: [], adjacentObstacles: [], clearanceObstacles: [],
    } })
  }
  return { nodes, routes, forceJobs, repairJobs }
}
