import { expect, test } from "bun:test"
import { ConnectionPointRegionIndex } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/ConnectionPointRegionIndex"
import { checkIfConnectionPointIsInRegion } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/checkIfConnectionPointIsInRegion"
import type { RegionHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { CapacityMeshNode, ConnectionPoint } from "lib/types"

const createRegion = (params: {
  regionId: string
  x: number
  y?: number
  availableZ: number[]
}): RegionHg => ({
  regionId: params.regionId,
  ports: [],
  d: {
    capacityMeshNodeId: params.regionId,
    center: { x: params.x, y: params.y ?? 0 },
    width: 2,
    height: 2,
    availableZ: params.availableZ,
  } as CapacityMeshNode,
})

test("connection point region index preserves linear scan results and order", () => {
  const regions = [
    createRegion({ regionId: "outside", x: -3, availableZ: [0] }),
    createRegion({ regionId: "first", x: 0, availableZ: [0] }),
    createRegion({ regionId: "wrong-layer", x: 0, availableZ: [1] }),
    createRegion({ regionId: "near-boundary", x: 1.0005, availableZ: [0] }),
    createRegion({ regionId: "second", x: 0.5, availableZ: [0, 1] }),
  ]
  const point: ConnectionPoint = { x: 0, y: 0, layer: "top" }
  const layerCount = 2

  const expected = regions.filter((region) =>
    checkIfConnectionPointIsInRegion({ point, region, layerCount }),
  )
  const index = new ConnectionPointRegionIndex(regions, layerCount)

  expect(index.getRegionsContainingPoint(point)).toEqual(expected)
  expect(
    new ConnectionPointRegionIndex([], layerCount).getRegionsContainingPoint(
      point,
    ),
  ).toEqual([])
})
