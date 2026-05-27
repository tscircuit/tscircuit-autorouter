import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"

const createRegion = ({
  regionId,
  pointIds,
  containsObstacle = false,
  containsTarget = false,
  centerX,
}: {
  regionId: string
  pointIds: string[]
  containsObstacle?: boolean
  containsTarget?: boolean
  centerX: number
}): SerializedHyperGraph["regions"][number] => ({
  regionId,
  pointIds,
  d: {
    center: { x: centerX, y: 0 },
    width: 1,
    height: 1,
    _containsObstacle: containsObstacle,
    _containsTarget: containsTarget,
  },
})

const createPort = ({
  portId,
  region1Id,
  region2Id,
  x,
}: {
  portId: string
  region1Id: string
  region2Id: string
  x: number
}): SerializedHyperGraph["ports"][number] => ({
  portId,
  region1Id,
  region2Id,
  d: {
    x,
    y: 0,
    z: 0,
  },
})

const getSerializedRegionIds = (graph: SerializedHyperGraph) => {
  const { topology } = loadSerializedHyperGraph(graph)
  return (topology.regionMetadata ?? []).map(
    (metadata) =>
      (metadata as { serializedRegionId?: string }).serializedRegionId,
  )
}

test("tiny-hypergraph keeps sibling obstacle regions connected to an endpoint obstacle region", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      createRegion({
        regionId: "endpoint-obstacle",
        pointIds: ["endpoint-target-port", "endpoint-sibling-port"],
        containsObstacle: true,
        centerX: 0,
      }),
      createRegion({
        regionId: "sibling-obstacle",
        pointIds: ["endpoint-sibling-port"],
        containsObstacle: true,
        centerX: 1,
      }),
      createRegion({
        regionId: "isolated-obstacle",
        pointIds: [],
        containsObstacle: true,
        centerX: 2,
      }),
      createRegion({
        regionId: "target",
        pointIds: ["endpoint-target-port"],
        containsTarget: true,
        centerX: 3,
      }),
    ],
    ports: [
      createPort({
        portId: "endpoint-target-port",
        region1Id: "endpoint-obstacle",
        region2Id: "target",
        x: 0.25,
      }),
      createPort({
        portId: "endpoint-sibling-port",
        region1Id: "endpoint-obstacle",
        region2Id: "sibling-obstacle",
        x: 0.75,
      }),
    ],
    connections: [
      {
        connectionId: "route-1",
        startRegionId: "endpoint-obstacle",
        endRegionId: "target",
        mutuallyConnectedNetworkId: "net-1",
      },
    ],
  }

  expect(getSerializedRegionIds(graph)).toEqual([
    "endpoint-obstacle",
    "sibling-obstacle",
    "target",
  ])
})
