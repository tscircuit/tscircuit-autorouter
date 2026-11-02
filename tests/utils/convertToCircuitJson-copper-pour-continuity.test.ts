import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { checkTraceContinuity } from "lib/utils/autorouting-drc/checkTraceContinuity"

test("retained copper-pour strips physically join traces ending at separate vias", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 5, minY: -2, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.4,
    minViaHoleDiameter: 0.2,
    connections: [
      {
        name: "ground",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "left" },
          { x: 4, y: 0, layer: "top", pcb_port_id: "right" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["left"],
      },
      {
        type: "rect",
        center: { x: 4, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["right"],
      },
      {
        type: "rect",
        center: { x: 1.5, y: 0 },
        width: 1,
        height: 0.6,
        layers: ["bottom"],
        connectedTo: ["ground", "left", "right"],
        isCopperPour: true,
      },
      {
        type: "rect",
        center: { x: 2.5, y: 0 },
        width: 1,
        height: 0.6,
        layers: ["bottom"],
        connectedTo: ["ground", "left", "right"],
        isCopperPour: true,
      },
    ],
  }
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "left_route",
      connection_name: "ground",
      route: [
        { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.15 },
        { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.15 },
        {
          route_type: "via",
          x: 1,
          y: 0,
          from_layer: "top",
          to_layer: "bottom",
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "right_route",
      connection_name: "ground",
      route: [
        {
          route_type: "via",
          x: 3,
          y: 0,
          from_layer: "bottom",
          to_layer: "top",
        },
        { route_type: "wire", x: 3, y: 0, layer: "top", width: 0.15 },
        { route_type: "wire", x: 4, y: 0, layer: "top", width: 0.15 },
      ],
    },
  ]
  const original = structuredClone(srj)
  const result = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: traces,
  })
  expect(result.errors).toHaveLength(0)
  expect(checkTraceContinuity(result.circuitJson)).toHaveLength(0)
  const pours = result.circuitJson.filter(
    (element) => element.type === "pcb_copper_pour",
  )
  expect(pours).toHaveLength(2)
  expect(srj).toEqual(original)
})
