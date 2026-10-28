import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { constrainPipeline9RegionLayerChanges } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constrainPipeline9RegionLayerChanges"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import type { HyperGraphHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("a union of separate pad shadows blocks only owners with no via-center witness", () => {
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: ["left", "right", "foreign"].map((name) => ({ name,
      pointsToConnect: [{ x: 4, y: 4, layer: "top", pcb_port_id: `${name}-port` }] })),
    obstacles: [-0.4, 0.4].map((x, index) => ({ type: "rect", center: { x, y: 0 },
      width: 0.5, height: 0.3, layers: [index === 0 ? "top" : "bottom"],
      connectedTo: [`${index === 0 ? "left" : "right"}-port`] })),
  }
  const graph: HyperGraphHg = { ports: [], regions: [{ regionId: "union", ports: [],
    d: { capacityMeshNodeId: "union", center: { x: 0, y: 0 }, width: 1,
      height: 0.2, layer: "inner1", availableZ: [1] } }] }
  const physicalOwnership = getPipeline9PhysicalOwnership({ originalSrj: srj,
    routingConnMap: new ConnectivityMap({ "routing-left": ["left", "left-port"],
      "routing-right": ["right", "right-port"], "routing-foreign": ["foreign", "foreign-port"] }) })
  expect(constrainPipeline9RegionLayerChanges({ graph, originalSrj: srj, physicalOwnership,
    routingNetIds: ["routing-left", "routing-right", "routing-foreign", "unknown"],
    viaDiameter: 0.3 })).toBe(1)
  // Neither pad alone covers the region. Waiving either owner supplies a legal
  // witness near that owner's side, while a third owner has no free center.
  expect(graph.regions[0]!.d.layerChangeAllowedNetIds).toEqual([
    "routing-left", "routing-right", "unknown",
  ])
  expect(graph.regions[0]!.d.availableZ).toEqual([1])
})
