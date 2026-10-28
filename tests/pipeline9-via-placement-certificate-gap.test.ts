import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { constrainPipeline9RegionLayerChanges } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constrainPipeline9RegionLayerChanges"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import type { HyperGraphHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("a small open strip between pad shadows prevents a whole-region certificate", () => {
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [{ name: "signal", pointsToConnect: [{ x: 4, y: 4, layer: "top" }] }],
    obstacles: [-0.5, 0.5].map((x, index) => ({ type: "rect", center: { x, y: 0 },
      width: 0.5, height: 0.5, layers: [index === 0 ? "top" : "bottom"],
      connectedTo: [`pad-${index}`] })),
  }
  const graph: HyperGraphHg = { ports: [], regions: [{ regionId: "gap", ports: [],
    d: { capacityMeshNodeId: "gap", center: { x: 0, y: 0 }, width: 1, height: 0.2,
      layer: "inner1", availableZ: [1] } }] }
  const physicalOwnership = getPipeline9PhysicalOwnership({ originalSrj: srj,
    routingConnMap: new ConnectivityMap({ signal: ["signal"] }) })
  expect(constrainPipeline9RegionLayerChanges({ graph, originalSrj: srj, physicalOwnership,
    routingNetIds: ["signal"], viaDiameter: 0.3 })).toBe(0)
  expect(graph.regions[0]!.d.layerChangeAllowedNetIds).toBeUndefined()
})
