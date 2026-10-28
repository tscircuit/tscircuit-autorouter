import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import type { Pipeline9ViaPlacementContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"

export const createPipeline9ViaPlacementProposalHarness = (): {
  input: HighDensityIntraNodeRoute
  proposal: HighDensityIntraNodeRoute
  node: NodeWithPortPoints
  srj: SimpleRouteJson
  context: Pipeline9ViaPlacementContext
} => {
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    connections: [{ name: "signal", pointsToConnect: [{ x: -2, y: 0, layer: "inner1", pcb_port_id: "a" },
      { x: 2, y: 0, layer: "bottom", pcb_port_id: "b" }] }],
    obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 0.6, height: 0.6,
      layers: ["top"], connectedTo: ["foreign-pad"] }],
  }
  const input: HighDensityIntraNodeRoute = { connectionName: "signal", regionId: "node", traceThickness: 0.15,
    viaDiameter: 0.3, vias: [{ x: -0.8, y: 0 }],
    route: [{ x: -2, y: 0, z: 1 }, { x: -0.8, y: 0, z: 1 },
      { x: -0.8, y: 0, z: 3 }, { x: 2, y: 0, z: 3 }] }
  const proposal = structuredClone(input)
  proposal.vias[0]!.x = 0
  proposal.route[1]!.x = 0
  proposal.route[2]!.x = 0
  return { input, proposal, srj,
    node: { capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 6, height: 4,
      availableZ: [1, 3], portPoints: [{ x: -2, y: 0, z: 1, connectionName: "signal" },
        { x: 2, y: 0, z: 3, connectionName: "signal" }] },
    context: { boardObstacles: srj.obstacles, physicalOwnership: getPipeline9PhysicalOwnership({ originalSrj: srj }),
      layerCount: 4, clearance: 0.1 },
  }
}
