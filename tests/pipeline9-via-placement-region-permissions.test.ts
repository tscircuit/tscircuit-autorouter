import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { constrainPipeline9RegionLayerChanges } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constrainPipeline9RegionLayerChanges"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import type { HyperGraphHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("only fully covered original regions restrict foreign layer changes and retain owner permission", () => {
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [
      { name: "pad-owner", pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "pad-port" }] },
      { name: "signal", pointsToConnect: [{ x: -4, y: 0, layer: "inner1", pcb_port_id: "signal-port" }] },
    ],
    obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 1, height: 1,
      layers: ["top"], connectedTo: ["pad-port"] }],
  }
  const graph: HyperGraphHg = { ports: [], regions: [0.5, 2].map((width, index) => ({
    regionId: `region-${index}`, ports: [],
    d: { capacityMeshNodeId: `region-${index}`, center: { x: 0, y: 0 }, width,
      height: 0.5, layer: "inner1,bottom", availableZ: [1, 3] },
  })) }
  const connMap = new ConnectivityMap({ "routing-owner": ["pad-owner", "pad-port"],
    "routing-signal": ["signal", "signal-port"] })
  const physicalOwnership = getPipeline9PhysicalOwnership({ originalSrj: srj, routingConnMap: connMap })
  const originalSecondNode = graph.regions[1]!.d
  expect(constrainPipeline9RegionLayerChanges({ viaDiameter: 0.3, graph, originalSrj: srj, physicalOwnership,
    routingNetIds: ["routing-owner", "routing-signal"] })).toBe(1)
  expect(graph.regions[0]!.d.layerChangeAllowedNetIds).toEqual(["routing-owner"])
  expect(graph.regions[0]!.d.availableZ).toEqual([1, 3])
  expect(graph.regions[1]!.d).toBe(originalSecondNode)
  expect(graph.regions[1]!.d.layerChangeAllowedNetIds).toBeUndefined()
  const blindGraph = structuredClone(graph)
  blindGraph.regions[0]!.d.layerChangeAllowedNetIds = undefined
  expect(constrainPipeline9RegionLayerChanges({ viaDiameter: 0.3, graph: blindGraph,
    originalSrj: { ...srj, allowBlindAndBuriedVias: true }, physicalOwnership,
    routingNetIds: ["routing-owner", "routing-signal"] })).toBe(0)
  expect(blindGraph.regions[0]!.d.layerChangeAllowedNetIds).toBeUndefined()
  expect(constrainPipeline9RegionLayerChanges({ viaDiameter: 0.3, graph: blindGraph,
    originalSrj: { ...srj, layerCount: 2 }, physicalOwnership,
    routingNetIds: ["routing-owner", "routing-signal"] })).toBe(0)
  expect(blindGraph.regions[0]!.d.layerChangeAllowedNetIds).toBeUndefined()
})
