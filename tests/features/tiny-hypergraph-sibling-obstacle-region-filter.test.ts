import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"

const createRegion = ({
  regionId,
  pointIds,
  containsObstacle = false,
  containsTarget = false,
  centerX,
  obstacleRootIds,
}: {
  regionId: string
  pointIds: string[]
  containsObstacle?: boolean
  containsTarget?: boolean
  centerX: number
  obstacleRootIds?: string[]
}): SerializedHyperGraph["regions"][number] => ({
  regionId,
  pointIds,
  d: {
    center: { x: centerX, y: 0 },
    width: 1,
    height: 1,
    _containsObstacle: containsObstacle,
    _containsTarget: containsTarget,
    _obstacleRootIds: obstacleRootIds,
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

test("tiny-hypergraph keeps sibling obstacle regions only when they share an obstacle root id", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      createRegion({
        regionId: "endpoint-obstacle",
        pointIds: ["endpoint-target-port", "endpoint-sibling-port"],
        containsObstacle: true,
        centerX: 0,
        obstacleRootIds: ["pad-a"],
      }),
      createRegion({
        regionId: "sibling-obstacle",
        pointIds: ["endpoint-sibling-port"],
        containsObstacle: true,
        centerX: 1,
        obstacleRootIds: ["pad-a"],
      }),
      createRegion({
        regionId: "adjacent-but-unrelated-obstacle",
        pointIds: ["unrelated-port"],
        containsObstacle: true,
        centerX: 2,
        obstacleRootIds: ["pad-b"],
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
      createPort({
        portId: "unrelated-port",
        region1Id: "endpoint-obstacle",
        region2Id: "adjacent-but-unrelated-obstacle",
        x: 0.9,
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

test("tiny-hypergraph does not preserve disjoint multi-root obstacle regions", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      createRegion({
        regionId: "endpoint-obstacle",
        pointIds: ["endpoint-target-port", "shared-port"],
        containsObstacle: true,
        centerX: 0,
        obstacleRootIds: ["pad-a", "pad-b"],
      }),
      createRegion({
        regionId: "unrelated-multi-root-obstacle",
        pointIds: ["shared-port"],
        containsObstacle: true,
        centerX: 1,
        obstacleRootIds: ["pad-c", "pad-d"],
      }),
      createRegion({
        regionId: "target",
        pointIds: ["endpoint-target-port"],
        containsTarget: true,
        centerX: 2,
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
        portId: "shared-port",
        region1Id: "endpoint-obstacle",
        region2Id: "unrelated-multi-root-obstacle",
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

  expect(getSerializedRegionIds(graph)).toEqual(["endpoint-obstacle", "target"])
})

test("tiny-hypergraph does not preserve target-containing multi-root sibling obstacle regions", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      createRegion({
        regionId: "endpoint-obstacle",
        pointIds: ["endpoint-target-port", "shared-port"],
        containsObstacle: true,
        centerX: 0,
        obstacleRootIds: ["pad-a", "pad-b"],
      }),
      createRegion({
        regionId: "target-sibling-obstacle",
        pointIds: ["shared-port", "sibling-target-port"],
        containsObstacle: true,
        containsTarget: true,
        centerX: 1,
        obstacleRootIds: ["pad-a", "pad-b"],
      }),
      createRegion({
        regionId: "target",
        pointIds: ["endpoint-target-port"],
        containsTarget: true,
        centerX: 2,
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
        portId: "shared-port",
        region1Id: "endpoint-obstacle",
        region2Id: "target-sibling-obstacle",
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

  expect(getSerializedRegionIds(graph)).toEqual(["endpoint-obstacle", "target"])
})

test("tiny-hypergraph preserves target-containing sibling obstacle regions for a single shared root", () => {
  const graph: SerializedHyperGraph = {
    regions: [
      createRegion({
        regionId: "endpoint-obstacle",
        pointIds: ["endpoint-target-port", "shared-port"],
        containsObstacle: true,
        centerX: 0,
        obstacleRootIds: ["pad-a"],
      }),
      createRegion({
        regionId: "target-sibling-obstacle",
        pointIds: ["shared-port", "sibling-target-port"],
        containsObstacle: true,
        containsTarget: true,
        centerX: 1,
        obstacleRootIds: ["pad-a"],
      }),
      createRegion({
        regionId: "target",
        pointIds: ["endpoint-target-port"],
        containsTarget: true,
        centerX: 2,
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
        portId: "shared-port",
        region1Id: "endpoint-obstacle",
        region2Id: "target-sibling-obstacle",
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
    "target-sibling-obstacle",
    "target",
  ])
})
