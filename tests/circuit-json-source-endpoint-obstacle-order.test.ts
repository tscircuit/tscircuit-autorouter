import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("source-trace endpoint obstacle lookup preserves exact boundary membership and original order", (): void => {
  const obstacle = (
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Obstacle => ({
    type: "rect",
    center: { x, y },
    width,
    height,
    layers: ["top"],
    connectedTo: ["signal", name],
  })
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
    obstacles: [
      obstacle("end-first-in-input", 2, 0, 0.2, 0.2),
      obstacle("start-wide", -2.5, 0, 1, 1),
      obstacle("start-point", -2, 0, 0, 0),
      obstacle("outside", -2 - 1e-12, 0, 0, 0),
      obstacle("shared", 0, 0, 4, 0.1),
      obstacle("start-negative-width", -1.5, 0, -1, 1),
      ...Array.from({ length: 128 }, (_, index) =>
        obstacle(`remote-${index}`, 100 + index, 100, 0.1, 0.1),
      ),
    ],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pointId: "start" },
          { x: 2, y: 0, layer: "top", pointId: "end" },
        ],
      },
    ],
  }
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -2, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
  }
  const before = structuredClone({ srj, route })
  const sourceTrace = convertToCircuitJson(srj, [route]).find(
    (element) => element.type === "source_trace",
  )
  expect(sourceTrace).toEqual({
    type: "source_trace",
    source_trace_id: "signal",
    connected_source_port_ids: [],
    connected_source_net_ids: [
      "signal",
      "start-wide",
      "start-point",
      "shared",
      "end-first-in-input",
      "start",
      "end",
    ],
  })
  expect({ srj, route }).toEqual(before)

  // Squaring a subnormal distance can underflow to zero in the existing exact
  // predicate. Its conservative broad phase must retain that membership.
  const tiny = structuredClone(srj)
  tiny.obstacles = [obstacle("subnormal", 1e-200, 0, 0, 0)]
  const tinyRoute = structuredClone(route)
  tinyRoute.route[0] = { x: 0, y: 0, z: 0 }
  const tinySourceTrace = convertToCircuitJson(tiny, [tinyRoute]).find(
    (element) => element.type === "source_trace",
  )
  expect(tinySourceTrace).toEqual({
    type: "source_trace",
    source_trace_id: "signal",
    connected_source_port_ids: [],
    connected_source_net_ids: ["signal", "subnormal", "start", "end"],
  })
})
