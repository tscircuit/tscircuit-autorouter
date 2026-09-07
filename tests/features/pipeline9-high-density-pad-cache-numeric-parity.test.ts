import { expect, test } from "bun:test"
import { checkPadTraceClearance } from "@tscircuit/checks"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPreparedPadTraceClearanceChecker } from "lib/testing/utils/createPreparedPadTraceClearanceChecker"

test("prepared pad dependencies distinguish nonfinite numbers, signed zero and opaque serialization tags", (): void => {
  const trace: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "signal",
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const pad: AnyCircuitElement = {
    type: "pcb_smtpad",
    pcb_smtpad_id: "pad",
    x: 0,
    y: 0.16,
    shape: "circle",
    radius: 0.1,
    layer: "top",
  }
  const connMap = new ConnectivityMap({})
  const options = { connMap, minClearance: 0.1 }
  const prepared = createPreparedPadTraceClearanceChecker()
  const widths = [Number.NaN, null, -0, 0, "number:NaN", undefined]
  for (const width of widths) {
    const board: AnyCircuitElement[] = [
      {
        ...trace,
        route: trace.route.map((point): unknown => ({ ...point, width })),
      } as unknown as PcbTrace,
      pad,
    ]
    const before = prepared.getStats()
    expect(prepared(board, options)).toEqual(checkPadTraceClearance(board, options))
    expect(prepared.getStats().nativeInvocationCount).toBe(
      before.nativeInvocationCount + 1,
    )
    expect(prepared(board, options)).toEqual(checkPadTraceClearance(board, options))
    expect(prepared.getStats().nativeInvocationCount).toBe(
      before.nativeInvocationCount + 1,
    )
  }
  // Infinite spatial-query margins do not terminate in the pinned native
  // index. Segment-free input exercises their distinct dependency keys via
  // the native early return, without launching any such spatial query.
  const pointOnly: AnyCircuitElement[] = [
    { ...trace, route: trace.route.slice(0, 1) },
    pad,
  ]
  for (const minClearance of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -0,
    0,
    undefined,
  ]) {
    const changedOptions = { connMap, minClearance }
    const before = prepared.getStats()
    expect(prepared(pointOnly, changedOptions)).toEqual(
      checkPadTraceClearance(pointOnly, changedOptions),
    )
    expect(prepared.getStats().nativeInvocationCount).toBe(
      before.nativeInvocationCount + 1,
    )
  }
})
