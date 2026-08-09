import { expect, test } from "bun:test"
import type { SimplifiedPcbTraces } from "lib/types"
import { addViaArraysToWideTraces } from "lib/utils/add-via-arrays-to-wide-traces"

test("adds a perpendicular via array across a wide trace", () => {
  const traces: SimplifiedPcbTraces = [
    {
      type: "pcb_trace",
      pcb_trace_id: "wide_trace",
      connection_name: "POWER",
      route: [
        { route_type: "wire", x: -2, y: 0, width: 1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 1, layer: "top" },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
          via_diameter: 0.45,
          via_hole_diameter: 0.3,
        },
        { route_type: "wire", x: 0, y: 0, width: 1, layer: "bottom" },
        { route_type: "wire", x: 2, y: 0, width: 1, layer: "bottom" },
      ],
    },
  ]

  const output = addViaArraysToWideTraces({
    traces,
    defaultViaDiameter: 0.45,
  })
  const vias = output[0]!.route.filter(
    (point) => point.route_type === "via",
  )

  expect(vias).toHaveLength(3)
  expect(vias.map(({ x, y }) => ({ x, y }))).toEqual([
    { x: 0, y: -0.45 },
    { x: 0, y: 0 },
    { x: 0, y: 0.45 },
  ])
  expect(
    traces[0]!.route.filter((point) => point.route_type === "via"),
  ).toHaveLength(1)
})
