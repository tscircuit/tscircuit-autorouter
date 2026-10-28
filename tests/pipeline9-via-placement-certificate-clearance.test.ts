import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { constrainPipeline9RegionLayerChanges } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constrainPipeline9RegionLayerChanges"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import type { HyperGraphHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("hard via-center cuts require violation beyond the original checker tolerance", () => {
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15,
    minViaEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [{ name: "signal", pointsToConnect: [{ x: 4, y: 4, layer: "top" }] }],
    obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 1, height: 1,
      layers: ["top"], connectedTo: ["pad-owner"] }],
  }
  const graph: HyperGraphHg = { ports: [], regions: [0.744, 0.746].map((x, index) => ({
    regionId: `${index}`, ports: [], d: { capacityMeshNodeId: `${index}`,
      center: { x, y: 0 }, width: 0.001, height: 0.001, layer: "top", availableZ: [0] },
  })) }
  const physicalOwnership = getPipeline9PhysicalOwnership({ originalSrj: srj,
    routingConnMap: new ConnectivityMap({ signal: ["signal"] }) })
  expect(constrainPipeline9RegionLayerChanges({ graph, originalSrj: srj, physicalOwnership,
    routingNetIds: ["signal"], viaDiameter: 0.3 })).toBe(1)
  expect(graph.regions[0]!.d.layerChangeAllowedNetIds).toEqual([])
  expect(graph.regions[1]!.d.layerChangeAllowedNetIds).toBeUndefined()
  const zeroClearanceGraph = structuredClone(graph)
  for (const region of zeroClearanceGraph.regions) {
    delete region.d.layerChangeAllowedNetIds
    region.d.center.x = 0.649
  }
  expect(constrainPipeline9RegionLayerChanges({ graph: zeroClearanceGraph,
    originalSrj: { ...srj, minViaEdgeToPadEdgeClearance: 0 }, physicalOwnership,
    routingNetIds: ["signal"], viaDiameter: 0.3 })).toBe(0)
  expect(zeroClearanceGraph.regions[0]!.d.layerChangeAllowedNetIds).toBeUndefined()
  expect(constrainPipeline9RegionLayerChanges({ graph: zeroClearanceGraph,
    originalSrj: { ...srj, minViaEdgeToPadEdgeClearance: 0.005 }, physicalOwnership,
    routingNetIds: ["signal"], viaDiameter: 0.3 })).toBe(0)
  expect(zeroClearanceGraph.regions[0]!.d.layerChangeAllowedNetIds).toBeUndefined()
})
