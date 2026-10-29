import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { coalescePipeline9LayerRegions } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/coalescePipeline9LayerRegions"
import { constrainPipeline9RegionLayerChanges } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constrainPipeline9RegionLayerChanges"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import type { HyperGraphHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

test("coalesced inner-layer travel still forbids foreign through-vias beneath a surface pad", () => {
  const originalSrj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: ["owner", "foreign"].map((name) => ({ name,
      pointsToConnect: [{ x: 4, y: 4, layer: "top", pcb_port_id: `${name}-port` }] })),
    obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 1.1, height: 0.3,
      layers: ["top"], connectedTo: ["owner-port"] }],
  }
  const nodes: CapacityMeshNode[] = [1, 2].map((z) => ({ capacityMeshNodeId: `inner${z}`,
    center: { x: 0, y: 0 }, width: 1, height: 0.2, layer: `z${z}`,
    availableZ: [z], _isComponentTopologyNode: true }))
  const coalesced = coalescePipeline9LayerRegions({ nodes, layerCount: originalSrj.layerCount, terminalConnections: originalSrj.connections })
  const graph: HyperGraphHg = { ports: [], regions: coalesced.nodes.map((node) => ({
    regionId: node.capacityMeshNodeId, d: node, ports: [] })) }
  const physicalOwnership = getPipeline9PhysicalOwnership({ originalSrj,
    routingConnMap: new ConnectivityMap({ "routing-owner": ["owner", "owner-port"],
      "routing-foreign": ["foreign", "foreign-port"] }) })
  expect(constrainPipeline9RegionLayerChanges({ graph, originalSrj, physicalOwnership,
    routingNetIds: ["routing-owner", "routing-foreign"], viaDiameter: 0.3 })).toBe(1)
  expect(graph.regions[0]!.d.availableZ).toEqual([1, 2])
  expect(graph.regions[0]!.d.layerChangeAllowedNetIds).toEqual(["routing-owner"])
  const validate = getPipeline9ViaPlacementValidator({ boardGeometry: originalSrj, boardObstacles: originalSrj.obstacles,
    physicalOwnership, layerCount: 4, clearance: 0.1 })
  const via = { x: 0, y: 0, zStart: 1, zEnd: 2, viaDiameter: 0.3 }
  expect(validate(via, "foreign")).toBe(false)
  expect(validate(via, "owner")).toBe(true)
})
