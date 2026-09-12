import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

type CoreDrcViaSpanFixture = {
  srj: SimpleRouteJson
  traces: SimplifiedPcbTrace[]
}

/** Board-world coordinates in mm; +X is right and +Y is up. */
export const createCoreDrcViaSpanFixture = ({
  allowBlindAndBuriedVias,
  sameNet = false,
}: {
  allowBlindAndBuriedVias?: boolean
  sameNet?: boolean
}): CoreDrcViaSpanFixture => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.4,
    minViaHoleDiameter: 0.2,
    allowBlindAndBuriedVias,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: -1 },
        width: 0.3,
        height: 0.3,
        layers: ["top"],
        connectedTo: ["via_start_port", "VCC"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "via_start_pad",
          pcb_port_id: "via_start_port",
        },
      },
      {
        type: "rect",
        center: { x: 0, y: 1 },
        width: 0.3,
        height: 0.3,
        layers: ["top", "inner1", "inner2", "bottom"],
        connectedTo: ["via_end_port", "VCC"],
        circuitJsonMetadata: {
          pcb_plated_hole_id: "via_end_pad",
          pcb_port_id: "via_end_port",
        },
      },
      {
        type: "rect",
        center: { x: -1, y: 0 },
        width: 0.3,
        height: 0.3,
        layers: ["bottom"],
        connectedTo: ["bottom_start_port", sameNet ? "VCC" : "BOTTOM_SIGNAL"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "bottom_start_pad",
          pcb_port_id: "bottom_start_port",
        },
      },
      {
        type: "rect",
        center: { x: 1, y: 0 },
        width: 0.3,
        height: 0.3,
        layers: ["bottom"],
        connectedTo: ["bottom_end_port", sameNet ? "VCC" : "BOTTOM_SIGNAL"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "bottom_end_pad",
          pcb_port_id: "bottom_end_port",
        },
      },
    ],
    connections: [
      {
        name: "via_connection",
        __netConnectionName: "VCC",
        pointsToConnect: [
          { x: 0, y: -1, layer: "top", pcb_port_id: "via_start_port" },
          {
            x: 0,
            y: 1,
            layers: ["top", "inner1", "inner2", "bottom"],
            pcb_port_id: "via_end_port",
          },
        ],
      },
      {
        name: "bottom_connection",
        __netConnectionName: sameNet ? "VCC" : "BOTTOM_SIGNAL",
        pointsToConnect: [
          { x: -1, y: 0, layer: "bottom", pcb_port_id: "bottom_start_port" },
          { x: 1, y: 0, layer: "bottom", pcb_port_id: "bottom_end_port" },
        ],
      },
    ],
  }
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "via_trace",
      connection_name: "via_connection",
      route: [
        {
          route_type: "wire",
          x: 0,
          y: -1,
          width: 0.1,
          layer: "top",
          start_pcb_port_id: "via_start_port",
        },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner2",
        },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "inner2" },
        {
          route_type: "wire",
          x: 0,
          y: 1,
          width: 0.1,
          layer: "inner2",
          end_pcb_port_id: "via_end_port",
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "bottom_trace",
      connection_name: "bottom_connection",
      route: [
        {
          route_type: "wire",
          x: -1,
          y: 0,
          width: 0.1,
          layer: "bottom",
          start_pcb_port_id: "bottom_start_port",
        },
        {
          route_type: "wire",
          x: 1,
          y: 0,
          width: 0.1,
          layer: "bottom",
          end_pcb_port_id: "bottom_end_port",
        },
      ],
    },
  ]
  return { srj, traces }
}
