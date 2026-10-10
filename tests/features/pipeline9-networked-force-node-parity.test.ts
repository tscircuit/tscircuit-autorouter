import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { forceImprovePipeline9HighDensityNodeRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/forceImprovePipeline9HighDensityNodeRoutes"
import { materializePipeline9HdRouteVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { simplifyPipeline9CollinearRoutePoints } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/simplifyPipeline9CollinearRoutePoints"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { createPipeline9NetworkedForceFixture } from "../fixtures/pipeline9-networked-force-fixtures"

class CompletedNodeCollector extends Pipeline9HighDensitySolver {
  collectNode(
    node: NodeWithPortPoints,
    routes: HighDensityIntraNodeRoute[],
  ): void {
    this.activeNode = node
    this.finishActiveNode(routes)
  }
}

test("networked per-node force improvement preserves global geometry and terminal metadata", (): void => {
  const { nodes, routes } = createPipeline9NetworkedForceFixture()
  const originalInput = structuredClone(routes)
  const collector = new CompletedNodeCollector({
    nodePortPoints: nodes,
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({}),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    preserveTerminalPcbPortIds: true,
  })
  const remotelyImproved: HighDensityIntraNodeRoute[] = []
  for (const node of nodes) {
    const nodeRoutes = routes.filter(
      (route) => route.regionId === node.capacityMeshNodeId,
    )
    collector.collectNode(node, nodeRoutes)
    remotelyImproved.push(
      ...forceImprovePipeline9HighDensityNodeRoutes({
        nodeWithPortPoints: node,
        hdRoutes: nodeRoutes,
        colorMap: {},
        totalStepsPerNode: 20,
        nodeAssignmentMargin: 0.15,
        preserveTerminalPcbPortIds: true,
      }),
    )
  }
  const globalForce = new HighDensityForceImproveSolver({
    nodeWithPortPoints: nodes,
    hdRoutes: simplifyPipeline9CollinearRoutePoints(
      materializePipeline9HdRouteVias(collector.routes),
    ),
    colorMap: {},
    totalStepsPerNode: 20,
    nodeAssignmentMargin: 0.15,
  })
  globalForce.solve()
  expect(globalForce.solved).toBeTrue()
  expect(remotelyImproved).toEqual(globalForce.getOutput())
  expect(remotelyImproved[0]!.route[0]!.x).toBe(-2)
  expect(remotelyImproved[0]!.startPcbPortId).toBe("signal_a_port_0")
  expect(remotelyImproved[0]!.rootConnectionName).toBe("original_signal_a")
  expect(remotelyImproved[0]!.vias.length).toBe(2)
  expect(routes).toEqual(originalInput)
  expect(() =>
    forceImprovePipeline9HighDensityNodeRoutes({
      nodeWithPortPoints: nodes[0]!,
      hdRoutes: [routes[1]!],
      colorMap: {},
      totalStepsPerNode: 20,
      nodeAssignmentMargin: 0.15,
      preserveTerminalPcbPortIds: true,
    }),
  ).toThrow('does not belong to node "node_a"')
})
