import { expect, test } from "bun:test"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import fixture from "../fixtures/assets/a64-foreign-pad-escape.json"

test(
  "reference DRC retains source pads outside the routed net without losing terminal ownership",
  (): void => {
    const srj = structuredClone(fixture.srj) as SimpleRouteJson
    const validation = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: [fixture.trace as SimplifiedPcbTrace],
      drcOptions: { includeTraceContinuity: false },
    })
    const pads = validation.circuitJson.filter(
      (element) => element.type === "pcb_smtpad",
    )
    expect(pads).toHaveLength(2)
    expect(pads).toContainEqual(
      expect.objectContaining({
        pcb_smtpad_id: "U2.D3",
        shape: "circle",
        x: 132.6,
        y: -85.4,
        radius: 0.2,
      }),
    )
    expect(pads).toContainEqual(
      expect.objectContaining({
        pcb_smtpad_id: "U2.E3",
        pcb_port_id: "U2.E3",
        shape: "circle",
      }),
    )
    const connMap = getFullConnectivityMapFromCircuitJson(validation.circuitJson)
    const traceId = fixture.trace.pcb_trace_id
    expect(connMap.areIdsConnected("U2.E3", traceId)).toBeTrue()
    expect(connMap.areIdsConnected("U2.D3", traceId)).toBeFalse()
    expect(validation.errors.length).toBeGreaterThan(0)
    expect(
      validation.errors.every((error) => !error.message.includes('"U2.E3"')),
    ).toBeTrue()
    expect(srj).toEqual(fixture.srj)
  },
)
