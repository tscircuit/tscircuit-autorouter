import { expect, test } from "bun:test"
import { checkPadTraceClearance } from "@tscircuit/checks"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPreparedPadTraceClearanceChecker } from "lib/testing/utils/createPreparedPadTraceClearanceChecker"

type NativeOptions = NonNullable<Parameters<typeof checkPadTraceClearance>[1]>
type NativeOutcome =
  | { kind: "returned"; errors: ReturnType<typeof checkPadTraceClearance> }
  | { kind: "threw"; name: string; message: string }

test("coupled pad-trace keys and name shadows retain complete native evaluation and failures", (): void => {
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
    y: 0.22,
    shape: "circle",
    radius: 0.1,
    layer: "top",
  }
  const shadow: AnyCircuitElement = {
    type: "source_component",
    source_component_id: "signal",
    ftype: "simple_chip",
    name: "Source shadow",
  }
  const otherTrace: PcbTrace = {
    ...trace,
    pcb_trace_id: "other",
    route: trace.route.map((point): PcbTrace["route"][number] =>
      point.route_type === "wire" ? { ...point, y: -0.02 } : point,
    ),
  }
  const connMap = new ConnectivityMap({})
  const options: NativeOptions = { connMap, minClearance: 0.1 }
  const scenarios: Array<{
    board: AnyCircuitElement[]
    options: NativeOptions
  }> = [
    { board: [trace], options },
    { board: [trace, pad], options: { minClearance: 0.1 } },
    {
      board: [trace, pad],
      options: { connMap: null, minClearance: 0.1 } as unknown as NativeOptions,
    },
    {
      board: [trace, { ...trace, route: [...trace.route].reverse() }, pad],
      options,
    },
    {
      board: [trace, { ...otherTrace, pcb_trace_id: "signal_extra" }, pad],
      options,
    },
    { board: [trace, { ...pad, pcb_smtpad_id: "signal" }], options },
    { board: [shadow, trace, otherTrace, pad], options },
    { board: [trace, shadow, otherTrace, pad], options },
    {
      board: [
        trace,
        {
          type: "pcb_port",
          pcb_port_id: "signal",
          source_port_id: "source",
          x: -1,
          y: 0,
          layers: ["top"],
        },
        otherTrace,
        pad,
      ],
      options,
    },
    {
      // Retain the native error for unsupported pad copper instead of
      // substituting a successful empty result when evaluation throws.
      board: [
        shadow,
        trace,
        {
          type: "pcb_plated_hole",
          pcb_plated_hole_id: "broken",
          x: 0,
          y: 0.22,
          shape: "unsupported-pad-shape",
          outer_width: 0.2,
          outer_height: 0.2,
          hole_diameter: 0.1,
          layers: ["top"],
        } as unknown as AnyCircuitElement,
      ],
      options,
    },
  ]
  const prepared = createPreparedPadTraceClearanceChecker()
  const capture = (
    evaluate: () => ReturnType<typeof checkPadTraceClearance>,
  ): NativeOutcome => {
    try {
      return { kind: "returned", errors: evaluate() }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return { kind: "threw", name: error.name, message: error.message }
    }
  }
  for (const scenario of scenarios) {
    const original = structuredClone(scenario.board)
    for (let visit = 0; visit < 2; visit++) {
      const before = prepared.getStats()
      const expected = capture(
        (): ReturnType<typeof checkPadTraceClearance> =>
          checkPadTraceClearance(scenario.board, scenario.options),
      )
      expect(
        capture(
          (): ReturnType<typeof checkPadTraceClearance> =>
            prepared(scenario.board, scenario.options),
        ),
      ).toEqual(expected)
      expect(prepared.getStats().nativeInvocationCount).toBe(
        before.nativeInvocationCount + 1,
      )
      expect(prepared.getStats().cacheHitTraceCount).toBe(
        before.cacheHitTraceCount,
      )
    }
    expect(scenario.board).toEqual(original)
  }
})
