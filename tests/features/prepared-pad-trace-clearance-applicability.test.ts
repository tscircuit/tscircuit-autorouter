import { expect, test } from "bun:test"
import { checkPadTraceClearance } from "@tscircuit/checks"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPreparedPadTraceClearanceChecker } from "lib/testing/utils/createPreparedPadTraceClearanceChecker"

test("prepared pad checks keep native computation for ambiguous identities and custom connectivity", (): void => {
  const first: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "first",
    route: [-1, 1].map((x): PcbTrace["route"][number] => ({
      route_type: "wire",
      x,
      y: 0,
      width: 0.1,
      layer: "top",
    })),
  }
  const second: PcbTrace = {
    ...first,
    pcb_trace_id: "second",
    route: first.route.map((point): PcbTrace["route"][number] => {
      if (point.route_type !== "wire") {
        throw new Error("The fixture requires wire points")
      }
      return { ...point, y: -0.02 }
    }),
  }
  const pad: AnyCircuitElement = {
    type: "pcb_smtpad",
    pcb_smtpad_id: "pad",
    pcb_component_id: "foreign-component",
    pcb_port_id: "foreign-port",
    shape: "rect",
    x: 0,
    y: 0.2,
    width: 0.2,
    height: 0.2,
    layer: "top",
  }
  const board: AnyCircuitElement[] = [first, pad, second]
  const options = { connMap: new ConnectivityMap({}), minClearance: 0.1 }
  const prepared = createPreparedPadTraceClearanceChecker()
  const baseline = checkPadTraceClearance([...board], options)
  expect(baseline).toHaveLength(2)
  expect(prepared(board, options)).toEqual(baseline)
  expect(prepared(board, options)).toEqual(baseline)
  expect(prepared.getStats()).toMatchObject({
    evaluationCount: 2,
    nativeInvocationCount: 1,
    cacheEligibleEvaluationCount: 2,
    totalTraceCount: 4,
    nativeCheckedTraceCount: 2,
    cachedTraceCount: 2,
  })

  const ambiguousInputs: AnyCircuitElement[][] = [
    [first, pad, { ...second, pcb_trace_id: first.pcb_trace_id }],
    [first, pad, second, { ...pad, x: 0.5 }],
    [{ ...first, pcb_trace_id: "pad" }, pad, second],
    [
      { ...first, pcb_trace_id: "a_t" },
      { ...pad, pcb_smtpad_id: "p" },
      { ...second, pcb_trace_id: "t" },
      { ...pad, pcb_smtpad_id: "p_a", x: 0.5 },
    ],
  ]
  for (const input of ambiguousInputs) {
    const before = prepared.getStats()
    const expected = checkPadTraceClearance([...input], options)
    expect(prepared(input, options)).toEqual(expected)
    expect(prepared(input, options)).toEqual(expected)
    expect(prepared.getStats().nativeInvocationCount).toBe(
      before.nativeInvocationCount + 2,
    )
    expect(prepared.getStats().cacheEligibleEvaluationCount).toBe(
      before.cacheEligibleEvaluationCount,
    )
  }

  // A caller-supplied predicate is not represented by idToNetMap. It must
  // execute natively on every call, even with identical serialized copper.
  const customMap = new ConnectivityMap({})
  let connected = true
  customMap.areIdsConnected = (): boolean => connected
  const customOptions = { connMap: customMap, minClearance: 0.1 }
  const beforeCustom = prepared.getStats()
  expect(prepared(board, customOptions)).toEqual([])
  connected = false
  expect(prepared(board, customOptions)).toEqual(
    checkPadTraceClearance([...board], customOptions),
  )
  expect(prepared.getStats().nativeInvocationCount).toBe(
    beforeCustom.nativeInvocationCount + 2,
  )
  expect(prepared.getStats().cacheEligibleEvaluationCount).toBe(
    beforeCustom.cacheEligibleEvaluationCount,
  )

  const beforeGeneral = prepared.getStats()
  expect(prepared(board, { minClearance: 0.1 })).toEqual(
    checkPadTraceClearance([...board], { minClearance: 0.1 }),
  )
  expect(prepared([pad], options)).toEqual(
    checkPadTraceClearance([pad], options),
  )
  expect(prepared.getStats().nativeInvocationCount).toBe(
    beforeGeneral.nativeInvocationCount + 2,
  )
})
