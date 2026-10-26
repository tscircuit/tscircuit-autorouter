import { expect, test } from "bun:test"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("a routed endpoint cannot electrically merge a foreign pad on another layer", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 8,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.3,
    bounds: { minX: -2, minY: -2, maxX: 5, maxY: 2 },
    connections: [
      {
        name: "own_mst0",
        __rootConnectionNames: ["own"],
        pointsToConnect: [
          { x: 0, y: 0, layer: "inner1", pcb_port_id: "pcb_port_own" },
          { x: 3, y: 0, layer: "inner2", pcb_port_id: "pcb_port_end" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layers: ["inner1"],
        connectedTo: ["pcb_smtpad_own", "pcb_port_own", "own"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_own",
          pcb_port_id: "pcb_port_own",
        },
      },
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["pcb_smtpad_foreign", "pcb_port_foreign", "foreign"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_foreign",
          pcb_port_id: "pcb_port_foreign",
        },
      },
    ],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "owned_trace",
    connection_name: "own_mst0",
    route: [
      {
        route_type: "wire",
        x: 0,
        y: 0,
        layer: "inner1",
        width: 0.1,
        start_pcb_port_id: "pcb_port_own",
      },
      {
        route_type: "via",
        x: 0.3,
        y: 0,
        from_layer: "inner1",
        to_layer: "inner2",
      },
      {
        route_type: "wire",
        x: 3,
        y: 0,
        layer: "inner2",
        width: 0.1,
        end_pcb_port_id: "pcb_port_end",
      },
    ],
  }
  const result = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [trace],
    drcOptions: { includeTraceContinuity: false },
  })
  const connectivity = getFullConnectivityMapFromCircuitJson(result.circuitJson)
  expect(connectivity.areIdsConnected("own", "pcb_smtpad_foreign")).toBe(false)
  expect(connectivity.areIdsConnected("own", "pcb_smtpad_own")).toBe(true)
  const errors = result.errors.filter(
    (error) => error.type === "pcb_pad_pad_clearance_error",
  )
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({
    pcb_pad_ids: ["via_0", "pcb_smtpad_foreign"],
    pcb_trace_id: "owned_trace",
  })
})
