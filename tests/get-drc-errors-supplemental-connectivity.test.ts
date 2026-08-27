import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getDrcErrors } from "lib/testing/getDrcErrors"

const crossingTraces: AnyCircuitElement[] = [
  {
    type: "pcb_trace",
    pcb_trace_id: "trace_horizontal",
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  },
  {
    type: "pcb_trace",
    pcb_trace_id: "trace_vertical",
    route: [
      { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
    ],
  },
]

const getTraceErrors = (
  supplementalConnMap?: ConnectivityMap,
): ReturnType<typeof getDrcErrors>["errors"] =>
  getDrcErrors(crossingTraces, {
    includeTraceContinuity: false,
    includeTypedTraceClearance: false,
    supplementalConnMap,
  }).errors.filter((error) => error.type === "pcb_trace_error")

test("supplemental connectivity only suppresses connected trace violations", (): void => {
  const supplementalConnMap = new ConnectivityMap({
    routing_net: ["trace_horizontal", "trace_vertical"],
  })

  expect(getTraceErrors()).toHaveLength(1)
  expect(getTraceErrors(supplementalConnMap)).toHaveLength(0)

  const unrelatedConnMap = new ConnectivityMap({
    unrelated_routing_net: ["trace_horizontal", "trace_not_in_circuit_json"],
  })
  const errors = getTraceErrors(unrelatedConnMap)

  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({
    pcb_trace_error_id: "overlap_trace_horizontal_trace_vertical",
  })
})
