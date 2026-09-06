import { expect, test } from "bun:test"
import { checkViaTraceClearance } from "@tscircuit/checks"
import type { AnyCircuitElement, PcbTrace, PcbVia } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPreparedViaTraceClearanceChecker } from "lib/testing/utils/createPreparedViaTraceClearanceChecker"

type NativeOptions = NonNullable<Parameters<typeof checkViaTraceClearance>[1]>
type NativeOutcome =
  | { kind: "returned"; errors: ReturnType<typeof checkViaTraceClearance> }
  | { kind: "threw"; name: string; message: string }

test("nonpartitionable via-trace inputs preserve native computation and failures", (): void => {
  const trace: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "t",
    route: [
      { route_type: "wire", x: -1, y: 0.2, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0.2, width: 0.1, layer: "top" },
    ],
  }
  const via: PcbVia = {
    type: "pcb_via",
    pcb_via_id: "v",
    x: 0,
    y: 0,
    hole_diameter: 0.1,
    outer_diameter: 0.2,
    layers: ["top", "bottom"],
  }
  const connMap = new ConnectivityMap({})
  const options: NativeOptions = { connMap, minClearance: 0.1 }
  const cases: Array<{ input: AnyCircuitElement[]; options: NativeOptions }> = [
    { input: [trace, via], options: { minClearance: 0.1 } },
    {
      input: [trace, via],
      options: { connMap: null, minClearance: 0.1 } as unknown as NativeOptions,
    },
    { input: [trace, via], options: { connMap } },
    { input: [trace, via], options: { connMap, minClearance: Number.NaN } },
    {
      input: [trace, via],
      options: { connMap, minClearance: Number.POSITIVE_INFINITY },
    },
    { input: [trace, via], options: { connMap, minClearance: -1 } },
    { input: [trace, via, { ...via, x: 0.5 }], options },
    {
      input: [trace, via, { ...trace, route: [...trace.route].reverse() }],
      options,
    },
    {
      input: [
        trace,
        via,
        { ...trace, pcb_trace_id: "x_t" },
        { ...via, pcb_via_id: "v_x", x: 0.5 },
      ],
      options,
    },
    { input: [trace, { ...via, pcb_via_id: "t" }], options },
    { input: [trace, { ...via, x: Number.NaN }], options },
    {
      input: [trace, { ...via, outer_diameter: Number.POSITIVE_INFINITY }],
      options,
    },
    {
      input: [
        {
          ...trace,
          route: trace.route.map((point) => ({ ...point, width: Number.NaN })),
        },
        via,
      ],
      options,
    },
    {
      // Every coordinate/bound is finite, but native dot products overflow.
      input: [
        {
          ...trace,
          route: [0, 1e200].map((x) => ({
            route_type: "wire" as const,
            x,
            y: 0,
            width: 0.1,
            layer: "top" as const,
          })),
        },
        { ...via, x: 2e200 },
      ],
      options,
    },
    {
      // A nonzero segment can underflow its squared length to zero. Native
      // circle distance then has a different path than an exact point segment.
      input: [
        {
          ...trace,
          route: [0, 1e-200].map((x) => ({
            route_type: "wire" as const,
            x,
            y: 0,
            width: 0.1,
            layer: "top" as const,
          })),
        },
        { ...via, x: 20 },
      ],
      options,
    },
    {
      // Individually safe segments can still be far enough from a via that
      // their native point-distance squares overflow across the full domain.
      input: [trace, { ...via, x: 1e200 }],
      options,
    },
  ]
  const prepared = createPreparedViaTraceClearanceChecker()
  const capture = (
    evaluate: () => ReturnType<typeof checkViaTraceClearance>,
  ): NativeOutcome => {
    try {
      return { kind: "returned", errors: evaluate() }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { kind: "threw", name: error.name, message: error.message }
    }
  }
  for (const scenario of cases) {
    const original = structuredClone(scenario.input)
    const before = prepared.getStats()
    const expected = capture(() =>
      checkViaTraceClearance(scenario.input, scenario.options),
    )
    const actual = capture(() => prepared(scenario.input, scenario.options))
    expect(actual).toEqual(expected)
    expect(prepared.getStats().partitionedEvaluationCount).toBe(
      before.partitionedEvaluationCount,
    )
    expect(prepared.getStats().nativeInvocationCount).toBe(
      before.nativeInvocationCount + 1,
    )
    expect(scenario.input).toEqual(original)
  }
})
