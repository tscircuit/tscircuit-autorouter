import { checkViaPadClearance } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { addAutoroutingViaTraceIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("reference DRC detects through-via clearance to pads using the board rule", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    allowBlindAndBuriedVias: false,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaEdgeToPadEdgeClearance: 0.15,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pcb_port_id: "signal_start" },
          { x: 2, y: 0, layer: "inner1", pcb_port_id: "signal_end" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: -2, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["signal", "signal_start"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "start_pad",
          pcb_port_id: "signal_start",
        },
      },
      {
        type: "rect",
        center: { x: 2, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["inner1"],
        connectedTo: ["signal", "signal_end"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "end_pad",
          pcb_port_id: "signal_end",
        },
      },
      {
        type: "rect",
        center: { x: 0, y: 0.54 },
        width: 0.5,
        height: 0.5,
        layers: ["bottom"],
        connectedTo: ["other_net"],
        circuitJsonMetadata: { pcb_smtpad_id: "other_pad" },
      },
    ],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "signal_trace",
    connection_name: "signal",
    route: [
      { route_type: "wire", x: -2, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      {
        route_type: "via",
        x: 0,
        y: 0,
        from_layer: "top",
        to_layer: "inner1",
        via_diameter: 0.3,
      },
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "inner1" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "inner1" },
    ],
  }
  const input = { inputSrj: srj, srjWithPointPairs: srj, routedTraces: [trace] }
  const result = evaluateRelaxedDrc(input)
  const connMap = getFullConnectivityMapFromCircuitJson(result.circuitJson)
  const expected = checkViaPadClearance(result.circuitJson, {
    connMap,
    minClearance: srj.minViaEdgeToPadEdgeClearance,
  })
  expect(expected).toHaveLength(1)
  expect(expected[0]!.actual_clearance).toBeCloseTo(0.14)
  expect(result.errors).toEqual(expected)
  const repairErrors = addAutoroutingViaTraceIds({
    errors: result.errors as unknown as Array<Record<string, unknown>>,
    circuitJson: result.circuitJson,
    evaluatedTraceIds: new Set([trace.pcb_trace_id]),
  })
  expect(repairErrors[0]!.pcb_via_ids).toEqual(["via_0"])
  expect(repairErrors[0]!.pcb_trace_ids).toEqual([trace.pcb_trace_id])

  const blindSrj = { ...srj, allowBlindAndBuriedVias: true }
  expect(
    evaluateRelaxedDrc({
      ...input,
      inputSrj: blindSrj,
      srjWithPointPairs: blindSrj,
    }).errors,
  ).toEqual([])
})
