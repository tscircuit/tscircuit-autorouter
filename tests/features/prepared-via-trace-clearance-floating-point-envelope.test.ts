import { expect, test } from "bun:test"
import { checkViaTraceClearance } from "@tscircuit/checks"
import type { AnyCircuitElement, PcbTrace, PcbVia } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPreparedViaTraceClearanceChecker } from "lib/testing/utils/createPreparedViaTraceClearanceChecker"

test("prepared via-trace bounds retain native reconstructed endpoint clearance", (): void => {
  const trace: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "signal",
    route: [
      { route_type: "wire", x: -1e16, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const distant: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "distant",
    route: [
      { route_type: "wire", x: -1, y: 20, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 20, width: 0.1, layer: "top" },
    ],
  }
  const via: PcbVia = {
    type: "pcb_via",
    pcb_via_id: "via",
    x: 0.2,
    y: 0,
    hole_diameter: 0.1,
    outer_diameter: 0.2,
    layers: ["top", "bottom"],
  }
  const board: AnyCircuitElement[] = [trace, via, distant]
  const original = structuredClone(board)
  const options = { connMap: new ConnectivityMap({}), minClearance: 0.1 }
  // Native computes start + t * (end - start). At t=1 cancellation produces
  // x=0 here, rather than the declared endpoint x=-1. It reports a real typed
  // error in its arithmetic, which endpoint-only boxes would incorrectly omit.
  const expected = checkViaTraceClearance(board, options)
  expect(expected).toHaveLength(1)
  expect(expected[0]!.pcb_trace_id).toBe("signal")
  const prepared = createPreparedViaTraceClearanceChecker()
  expect(prepared(board, options)).toEqual(expected)
  expect(prepared.getStats()).toMatchObject({
    evaluationCount: 1,
    partitionedEvaluationCount: 1,
    nativeInvocationCount: 1,
    totalViaTracePairCount: 2,
    selectedViaTracePairCount: 1,
    totalViaSegmentPairCount: 2,
    selectedViaSegmentPairCount: 1,
  })
  expect(board).toEqual(original)
})
