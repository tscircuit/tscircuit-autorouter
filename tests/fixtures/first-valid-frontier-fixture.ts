import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

export function createFirstValidFrontierFixture(nodeCount = 2): { params: Pipeline9HighDensitySolverParams; nodes: NodeWithPortPoints[]; routes: HighDensityIntraNodeRoute[][] } {
  const nodes = Array.from({ length: nodeCount }, (_, index): NodeWithPortPoints => ({
    capacityMeshNodeId: `frontier_${index}`, center: { x: index * 10, y: 0 }, width: 6, height: 6,
    availableZ: [0, 1], portPoints: [-1, 1].flatMap((y, pair) => [
      { connectionName: `connection_${index}_${pair}`, rootConnectionName: `root_${index}_${pair}`,
        x: index * 10 - 2, y, z: 0, pcb_port_id: `left_${index}_${pair}` },
      { connectionName: `connection_${index}_${pair}`, rootConnectionName: `root_${index}_${pair}`,
        x: index * 10 + 2, y, z: 0, pcb_port_id: `right_${index}_${pair}` },
    ]),
  }))
  const routes = nodes.map((node) => [0, 1].map((pair): HighDensityIntraNodeRoute => ({
    connectionName: `connection_${node.capacityMeshNodeId.split("_")[1]}_${pair}`,
    traceThickness: 0.15, viaDiameter: 0.3, vias: [],
    route: [node.portPoints[pair * 2]!, node.portPoints[pair * 2 + 1]!].map(({ x, y, z }) => ({ x, y, z })),
  })))
  const connMap = new ConnectivityMap(Object.fromEntries(nodes.flatMap((_, index) => [0, 1].map((pair) => [
    `root_${index}_${pair}`, [`root_${index}_${pair}`, `connection_${index}_${pair}`],
  ]))))
  return { nodes, routes, params: { nodePortPoints: nodes, fixedHdRoutes: [], connMap,
    obstacles: [], layerCount: 2, viaDiameter: 0.3, traceWidth: 0.15,
    obstacleMargin: 0.1, effort: 1, preserveTerminalPcbPortIds: true,
    nodePfById: new Map(nodes.map((node) => [node.capacityMeshNodeId, 0.5])) } }
}
