import { expect, test } from "bun:test"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("multilayer obstacles become plated holes and use the nearest pcb_port_id", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -1, y: 1 },
        width: 0.8,
        height: 0.95,
        connectedTo: [
          "pcb_smtpad_0",
          "pcb_port_top",
          "pcb_plated_hole_shared",
          "pcb_port_hole",
        ],
      },
      {
        type: "rect",
        layers: ["top", "inner1", "inner2", "bottom"],
        center: { x: 2, y: -2 },
        width: 1.5,
        height: 1.5,
        connectedTo: [
          "pcb_smtpad_0",
          "pcb_port_top",
          "pcb_plated_hole_shared",
          "pcb_port_hole",
        ],
      },
    ],
    connections: [
      {
        name: "net_a",
        pointsToConnect: [
          {
            x: -1,
            y: 1,
            layer: "top",
            pointId: "pcb_port_top",
            pcb_port_id: "pcb_port_top",
          },
          {
            x: 2,
            y: -2,
            layer: "top",
            pointId: "pcb_port_hole",
            pcb_port_id: "pcb_port_hole",
          },
        ],
      },
    ],
  }

  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "net_a_0",
      connection_name: "net_a",
      route: [
        {
          route_type: "wire",
          x: -1,
          y: 1,
          width: 0.15,
          layer: "top",
        },
        {
          route_type: "wire",
          x: 2,
          y: -2,
          width: 0.15,
          layer: "top",
        },
      ],
    },
  ]

  const circuitJson = convertToCircuitJson(srj, traces, srj.minTraceWidth)

  const smtPads = circuitJson.filter((element) => element.type === "pcb_smtpad")
  const platedHoles = circuitJson.filter(
    (element) => element.type === "pcb_plated_hole",
  )

  expect(smtPads).toHaveLength(1)
  expect(platedHoles).toHaveLength(1)

  expect(smtPads[0]).toMatchObject({
    type: "pcb_smtpad",
    pcb_smtpad_id: "pcb_smtpad_0",
    pcb_port_id: "pcb_port_top",
    x: -1,
    y: 1,
  })

  expect(platedHoles[0]).toMatchObject({
    type: "pcb_plated_hole",
    pcb_plated_hole_id: "pcb_plated_hole_shared",
    pcb_port_id: "pcb_port_hole",
    x: 2,
    y: -2,
    layers: ["top", "inner1", "inner2", "bottom"],
  })
})
