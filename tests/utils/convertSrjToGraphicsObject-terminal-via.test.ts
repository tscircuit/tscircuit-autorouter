import { expect, test } from "bun:test"
import { convertSrjToGraphicsObject } from "../../lib"
import type { SimpleRouteJson } from "../../lib/types"

test("convertSrjToGraphicsObject renders vias even when the via is the last route point", () => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    obstacles: [],
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
            x: 0,
            y: 1,
            width: 0.15,
            layer: "top",
          },
          {
            route_type: "via",
            x: 0,
            y: 1,
            from_layer: "top",
            to_layer: "inner2",
            via_diameter: 0.3,
          },
        ],
      },
    ],
  }

  const graphics = convertSrjToGraphicsObject(srj)

  expect(graphics.circles).toBeDefined()
  expect(graphics.circles).toHaveLength(1)
  expect(graphics.circles?.[0]?.center).toEqual({ x: 0, y: 1 })
  expect(graphics.circles?.[0]?.radius).toBe(0.15)
})

test("convertSrjToGraphicsObject uses per-via diameter before legacy srj minViaDiameter", () => {
  const graphics = convertSrjToGraphicsObject({
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    min_via_pad_diameter: 1.5,
    obstacles: [],
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
            route_type: "via",
            x: 0,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
            via_diameter: 0.52,
          },
        ],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "trace_1",
        connection_name: "net.VCC",
        route: [
          {
            route_type: "via",
            x: 1,
            y: 0,
            from_layer: "top",
            to_layer: "bottom",
          },
        ],
      },
    ],
  })

  expect(graphics.circles).toHaveLength(2)
  expect(graphics.circles?.[0]?.radius).toBe(0.26)
  expect(graphics.circles?.[1]?.radius).toBe(0.75)
})
