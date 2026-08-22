import { expect, test } from "bun:test"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { restrictCapacityNodesToRoutingLayers } from "lib/utils/routing-layer-constraints"

test("capacity candidates are limited to the allowed routing layers", () => {
  const srj = {
    layerCount: 4,
    routingLayers: ["top", "bottom"],
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [],
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
  } satisfies SimpleRouteJson
  const nodes = [
    {
      capacityMeshNodeId: "all-layers",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      layer: "top",
      availableZ: [0, 1, 2, 3],
      _containsObstacle: false,
      _containsTarget: false,
    },
    {
      capacityMeshNodeId: "reserved-layer-only",
      center: { x: 3, y: 0 },
      width: 2,
      height: 2,
      layer: "inner1",
      availableZ: [1, 2],
      _containsObstacle: false,
      _containsTarget: false,
    },
  ] satisfies CapacityMeshNode[]

  expect(restrictCapacityNodesToRoutingLayers(nodes, srj)).toEqual([
    expect.objectContaining({
      capacityMeshNodeId: "all-layers",
      availableZ: [0, 3],
    }),
  ])
})
