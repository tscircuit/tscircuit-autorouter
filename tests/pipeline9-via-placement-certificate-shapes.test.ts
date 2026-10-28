import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { constrainPipeline9RegionLayerChanges } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/constrainPipeline9RegionLayerChanges"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import type { HyperGraphHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { Obstacle, SimpleRouteJson } from "lib/types/srj-types"

test("hard certificates use convex guaranteed copper and leave holes or ambiguous outer areas unrestricted", () => {
  const base: Obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 1, height: 1,
    layers: ["top"], connectedTo: ["pad-owner"] }
  const scenarios: Array<{ obstacle: Obstacle; x: number; y: number; covered: boolean }> = [
    { obstacle: { ...base, type: "oval" } as unknown as Obstacle, x: 0.6, y: 0.6, covered: false },
    { obstacle: { ...base, type: "oval", width: 2, height: 0.4 } as unknown as Obstacle,
      x: 0.8, y: 0.3, covered: false },
    { obstacle: { ...base, type: "oval", width: 2, height: 0.4 } as unknown as Obstacle,
      x: 0.1, y: 0.1, covered: true },
    { obstacle: { ...base, height: 0.1, ccwRotationDegrees: 45 }, x: 0.5, y: 0.5, covered: true },
    { obstacle: { ...base, height: 0.1, ccwRotationDegrees: 45 }, x: 0.6, y: -0.6, covered: false },
    { obstacle: { ...base, isNonPlatedHole: true }, x: 0, y: 0, covered: false },
    { obstacle: { ...base, isCopperPour: true }, x: 0, y: 0, covered: false },
    { obstacle: { ...base, isFanoutSourceKeepout: true }, x: 0, y: 0, covered: false },
    { obstacle: { ...base, layers: ["top", "bottom"] }, x: 0, y: 0, covered: false },
  ]
  for (const { obstacle, x, y, covered } of scenarios) {
    const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15,
      bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
      connections: [{ name: "signal", pointsToConnect: [{ x: 4, y: 4, layer: "top" }] }],
      obstacles: [obstacle] }
    const graph: HyperGraphHg = { ports: [], regions: [{ regionId: "test", ports: [],
      d: { capacityMeshNodeId: "test", center: { x, y }, width: 0.01, height: 0.01,
        layer: "top", availableZ: [0] } }] }
    const physicalOwnership = getPipeline9PhysicalOwnership({ originalSrj: srj,
      routingConnMap: new ConnectivityMap({ signal: ["signal"] }) })
    expect(constrainPipeline9RegionLayerChanges({ graph, originalSrj: srj, physicalOwnership,
      routingNetIds: ["signal"], viaDiameter: 0.3 })).toBe(covered ? 1 : 0)
    expect(graph.regions[0]!.d.layerChangeAllowedNetIds).toEqual(covered ? [] : undefined)
  }
})
