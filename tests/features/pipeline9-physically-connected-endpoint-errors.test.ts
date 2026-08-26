import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { filterPipeline9PhysicallyConnectedEndpointErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/filter-pipeline9-physically-connected-endpoint-errors"
import type { SimplifiedPcbTrace } from "lib/types"

test("Pipeline9 only removes disconnected endpoints with exact same-net layer contact", () => {
  const connMap = new ConnectivityMap({})
  connMap.addConnections([
    ["rerouted", "fixed", "net_a"],
    ["wrong_layer", "wrong_layer_fixed", "net_b"],
    ["wrong_net", "net_c"],
    ["wrong_net_fixed", "net_d"],
    ["thin_rerouted", "thin_fixed", "net_e"],
  ])
  const evaluatedTraces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "rerouted_trace",
      connection_name: "rerouted",
      route: [
        { route_type: "wire", x: 0, y: 0, width: 0.15, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.15, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "fixed_trace",
      connection_name: "fixed",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.15, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.15, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "wrong_layer_trace",
      connection_name: "wrong_layer",
      route: [
        { route_type: "wire", x: 0, y: 2, width: 0.15, layer: "top" },
        { route_type: "wire", x: 1, y: 2, width: 0.15, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "wrong_layer_fixed_trace",
      connection_name: "wrong_layer_fixed",
      route: [
        {
          route_type: "wire",
          x: -1,
          y: 2,
          width: 0.15,
          layer: "bottom",
        },
        {
          route_type: "wire",
          x: 0,
          y: 2,
          width: 0.15,
          layer: "bottom",
        },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "wrong_net_trace",
      connection_name: "wrong_net",
      route: [
        { route_type: "wire", x: 0, y: 4, width: 0.15, layer: "top" },
        { route_type: "wire", x: 1, y: 4, width: 0.15, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "wrong_net_fixed_trace",
      connection_name: "wrong_net_fixed",
      route: [
        { route_type: "wire", x: -1, y: 4, width: 0.15, layer: "top" },
        { route_type: "wire", x: 0, y: 4, width: 0.15, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "thin_rerouted_trace",
      connection_name: "thin_rerouted",
      route: [
        { route_type: "wire", x: 0, y: 6, width: 0.0001, layer: "top" },
        { route_type: "wire", x: 1, y: 6, width: 0.0001, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "thin_fixed_trace",
      connection_name: "thin_fixed",
      route: [
        {
          route_type: "wire",
          x: -1,
          y: 6,
          width: 0.0001,
          layer: "top",
        },
        {
          route_type: "wire",
          x: 0.0005,
          y: 6,
          width: 0.0001,
          layer: "top",
        },
      ],
    },
  ]
  const errors = [
    {
      pcb_trace_id: "rerouted_trace",
      pcb_trace_error_id: "disconnected_endpoint_rerouted_trace_start",
      center: { x: 0, y: 0 },
    },
    {
      pcb_trace_id: "wrong_layer_trace",
      pcb_trace_error_id: "disconnected_endpoint_wrong_layer_trace_start",
      center: { x: 0, y: 2 },
    },
    {
      pcb_trace_id: "wrong_net_trace",
      pcb_trace_error_id: "disconnected_endpoint_wrong_net_trace_start",
      center: { x: 0, y: 4 },
    },
    {
      pcb_trace_id: "rerouted_trace",
      pcb_trace_error_id: "overlap_rerouted_trace_fixed_trace",
      center: { x: 0, y: 0 },
    },
    {
      pcb_trace_id: "thin_rerouted_trace",
      pcb_trace_error_id: "disconnected_endpoint_thin_rerouted_trace_start",
      center: { x: 0, y: 6 },
    },
  ]

  expect(
    filterPipeline9PhysicallyConnectedEndpointErrors({
      errors,
      evaluatedTraces,
      connMap,
    }).map((error) => error.pcb_trace_error_id),
  ).toEqual([
    "disconnected_endpoint_wrong_layer_trace_start",
    "disconnected_endpoint_wrong_net_trace_start",
    "overlap_rerouted_trace_fixed_trace",
    "disconnected_endpoint_thin_rerouted_trace_start",
  ])
})
