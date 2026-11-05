import { expect, test } from "bun:test"
import { measureRouteConstraint } from "lib/solvers/ConstrainedRouteSolver/measureRouteConstraint"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("route limits measure the constrained path across fragments without counting unrelated net branches", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    boardThickness: 1.6,
    bounds: { minX: -1, maxX: 20, minY: -1, maxY: 20 },
    obstacles: [],
    connections: [
      {
        name: "clock",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "a" },
          { x: 4, y: 0, layer: "bottom", pointId: "b" },
          { x: 2, y: 10, layer: "top", pointId: "c" },
        ],
      },
    ],
  }
  const wire = (
    x: number,
    y: number,
    layer: string,
  ): SimplifiedPcbTrace["route"][number] => ({
    route_type: "wire",
    x,
    y,
    layer,
    width: 0.1,
  })
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "first",
      connection_name: "clock",
      route: [wire(0, 0, "top"), wire(2, 0, "top")],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "second",
      connection_name: "clock",
      route: [
        wire(2, 0, "top"),
        {
          route_type: "via",
          x: 2,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
        },
        wire(2, 0, "bottom"),
        wire(4, 0, "bottom"),
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "branch",
      connection_name: "clock",
      route: [wire(2, 0, "top"), wire(2, 10, "top")],
    },
  ]
  const rule = {
    connectionName: "clock",
    sourceTraceId: "rule",
    pointIds: ["a", "b"],
    maxLength: 6,
    maxViaCount: 1,
  }
  expect(measureRouteConstraint(input, traces, rule)).toEqual({
    length: 5.6,
    vias: 1,
    satisfied: true,
  })
  expect(
    measureRouteConstraint(input, traces, { ...rule, maxViaCount: 0 })
      .satisfied,
  ).toBe(false)
  expect(
    measureRouteConstraint(input, traces, { ...rule, maxLength: 5 }).satisfied,
  ).toBe(false)
  expect(
    measureRouteConstraint(input, traces, { ...rule, pointIds: ["a"] })
      .satisfied,
  ).toBe(true)
  // Via coordinates need not also appear as duplicated wire vertices.
  const compact = [
    {
      ...traces[0]!,
      route: [
        wire(0, 0, "top"),
        {
          route_type: "via" as const,
          x: 2,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
        },
        wire(4, 0, "bottom"),
      ],
    },
  ]
  expect(measureRouteConstraint(input, compact, rule)).toEqual({
    length: 5.6,
    vias: 1,
    satisfied: true,
  })
})
