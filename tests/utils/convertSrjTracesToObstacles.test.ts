import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import {
  convertSrjTracesToObstacles,
  getObstaclesFromSrjTraces,
} from "lib/utils/convertSrjTracesToObstacles"

const baseSrj: SimpleRouteJson = {
  layerCount: 4,
  minTraceWidth: 0.15,
  minViaDiameter: 0.3,
  obstacles: [
    {
      type: "rect",
      layers: ["top"],
      center: { x: 10, y: 10 },
      width: 1,
      height: 1,
      connectedTo: [],
    },
  ],
  connections: [],
  bounds: {
    minX: -5,
    maxX: 5,
    minY: -5,
    maxY: 5,
  },
  traces: [
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_0",
      connection_name: "net.GND",
      route: [
        {
          route_type: "wire",
          x: 0,
          y: 0,
          width: 0.15,
          layer: "top",
        },
        {
          route_type: "wire",
          x: 2,
          y: 0,
          width: 0.15,
          layer: "top",
        },
        {
          route_type: "via",
          x: 2,
          y: 0,
          from_layer: "top",
          to_layer: "inner2",
          via_diameter: 0.4,
        },
      ],
    },
  ],
}

test("getObstaclesFromSrjTraces converts wire segments and vias to obstacles", () => {
  const traceObstacles = getObstaclesFromSrjTraces(baseSrj)

  expect(traceObstacles).toHaveLength(2)
  expect(traceObstacles[0]).toMatchObject({
    type: "rect",
    layers: ["top", "inner1", "inner2"],
    center: { x: 2, y: 0 },
    width: 0.4,
    height: 0.4,
    connectedTo: [],
  })
  expect(traceObstacles[1]).toMatchObject({
    type: "rect",
    layers: ["top"],
    center: { x: 1, y: 0 },
    width: 2,
    height: 0.15,
    ccwRotationDegrees: 0,
    connectedTo: [],
  })
})
