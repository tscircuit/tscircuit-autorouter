import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { getAllowedLayersByConnection } from "lib/utils/getAllowedLayersByConnection"

test("bus layers intersect and survive point-pair connection names", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    obstacles: [],
    connections: [
      {
        name: "data_mst0",
        __rootConnectionNames: ["data"],
        pointsToConnect: [],
      },
      { name: "clock", pointsToConnect: [] },
    ],
    buses: [
      {
        busId: "outer",
        connectionNames: ["data"],
        allowedLayers: ["top", "bottom"],
      },
      { busId: "top", connectionNames: ["data"], allowedLayers: ["top"] },
      { busId: "unrestricted", connectionNames: ["clock"] },
    ],
  }
  const layers = getAllowedLayersByConnection(input)
  expect([...layers.get("data_mst0")!]).toEqual([0])
  expect(layers.has("clock")).toBe(false)
  input.buses![1]!.allowedLayers = ["inner1"]
  expect(() => getAllowedLayersByConnection(input)).toThrow(
    'Connection "data_mst0" has no allowed bus routing layers',
  )
})
