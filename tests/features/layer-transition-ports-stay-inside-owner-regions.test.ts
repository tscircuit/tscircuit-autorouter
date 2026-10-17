import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import type { CapacityMeshNode, SimpleRouteConnection } from "lib/types"

test("a via cannot attach its center to a nearby region outside that region's bounds", (): void => {
  const nodes: CapacityMeshNode[] = [0, 1].flatMap((z) =>
    [-1, 1].map((x) => ({
      capacityMeshNodeId: `${x < 0 ? "left" : "right"}-${z}`,
      center: { x, y: 0 },
      width: 2,
      height: 2,
      availableZ: [z],
      layer: `z${z}`,
    })),
  )
  const connections: SimpleRouteConnection[] = [
    {
      name: "signal",
      pointsToConnect: [
        { x: -1, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "bottom" },
      ],
    },
  ]
  const connectivityMap = new ConnectivityMap({})
  connectivityMap.addConnections([["signal"]])
  const { graph } = buildHyperGraph({
    capacityMeshNodes: nodes,
    segmentPortPoints: [],
    layerCount: 2,
    simpleRouteJsonConnections: connections,
    connectivityMap,
    viaDiameter: 0.4,
    layerTransitionPoints: [{ x: -0.05, y: 0, connectionName: "signal" }],
  })
  const transition = graph.regions.find((region) => region.d.isLayerTransition)!
  expect(transition.ports).toHaveLength(2)
  expect(transition.ports.map((port) => port.region1.regionId).sort()).toEqual([
    "left-0",
    "left-1",
  ])
  for (const port of transition.ports) {
    expect(Math.abs(port.d.x - port.region1.d.center.x)).toBeLessThanOrEqual(
      port.region1.d.width / 2,
    )
    expect(Math.abs(port.d.y - port.region1.d.center.y)).toBeLessThanOrEqual(
      port.region1.d.height / 2,
    )
  }
})
