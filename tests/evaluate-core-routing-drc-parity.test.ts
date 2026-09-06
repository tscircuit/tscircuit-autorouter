import { expect, test } from "bun:test"
import {
  checkViasInPads,
  dedupePcbDrcErrors,
  runAllRoutingChecks,
} from "@tscircuit/checks"
import { evaluateCoreRoutingDrc } from "lib/testing/evaluate-core-routing-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("Core routing DRC parity preserves repair ownership", async () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaHoleDiameter: 0.15,
    minViaPadDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.1,
    minViaEdgeToPadEdgeClearance: 0.1,
    minPadEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    obstacles: [
      {
        type: "rect",
        center: { x: -2, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["start"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pad_start",
          pcb_port_id: "start",
        },
      },
      {
        type: "rect",
        center: { x: 2, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["end"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pad_end",
          pcb_port_id: "end",
        },
      },
      {
        type: "rect",
        center: { x: -0.45, y: 0.25 },
        width: 0.3,
        height: 0.3,
        layers: ["top"],
        connectedTo: ["foreign"],
        circuitJsonMetadata: { pcb_smtpad_id: "pad_foreign" },
      },
    ],
    connections: [
      {
        name: "signal",
        maxLength: 1,
        maxViaCount: 0,
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pcb_port_id: "start" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "end" },
        ],
      },
    ],
  }
  const routedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "signal_trace",
    connection_name: "signal",
    route: [
      {
        route_type: "wire",
        x: -2,
        y: 0,
        width: 0.1,
        layer: "top",
        start_pcb_port_id: "start",
      },
      { route_type: "wire", x: -0.5, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x: -0.5,
        y: 0,
        from_layer: "top",
        to_layer: "bottom",
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      },
      { route_type: "wire", x: 0.5, y: 0, width: 0.1, layer: "bottom" },
      {
        route_type: "via",
        x: 0.5,
        y: 0,
        from_layer: "bottom",
        to_layer: "top",
        via_diameter: 0.3,
        via_hole_diameter: 0.15,
      },
      {
        route_type: "wire",
        x: 2,
        y: 0,
        width: 0.1,
        layer: "top",
        end_pcb_port_id: "end",
      },
    ],
  }

  const result = evaluateCoreRoutingDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [routedTrace],
  })
  const coreRoutingResults = await runAllRoutingChecks(result.circuitJson)
  const expectedErrors = dedupePcbDrcErrors([
    ...coreRoutingResults.filter(
      (element) => element.type !== "pcb_trace_too_long_warning",
    ),
    ...checkViasInPads(result.circuitJson),
  ])
  const maxViaError = result.errors.find(
    (error) =>
      error.type === "pcb_trace_error" &&
      String(error.pcb_trace_error_id).startsWith("max_via_count_exceeded_"),
  )

  expect(result.errors).toHaveLength(expectedErrors.length)
  expect(result.warnings).toHaveLength(
    coreRoutingResults.filter(
      (element) => element.type === "pcb_trace_too_long_warning",
    ).length,
  )
  expect(maxViaError).toMatchObject({
    pcb_trace_id: "signal_trace",
    pcb_via_ids: ["via_0", "via_1"],
    pcb_via_id: "via_0",
    center: { x: -0.5, y: 0 },
  })
    expect(
      result.errors.some((error) => error.type === "pcb_pad_pad_clearance_error"),
    ).toBeTrue()
})
