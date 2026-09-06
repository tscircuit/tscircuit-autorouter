import { expect, test } from "bun:test"
import { checkPadTraceClearance } from "@tscircuit/checks"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPreparedPadTraceClearanceChecker } from "lib/testing/utils/createPreparedPadTraceClearanceChecker"

test("prepared pad-trace checks reuse complete trace groups without changing native errors or order", (): void => {
  const minimumGap: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "signal",
    route: [
      {
        route_type: "through_pad",
        start: { x: -2, y: 2 },
        end: { x: -1, y: 2 },
        start_layer: "top",
        end_layer: "top",
        width: 0.1,
      },
      { route_type: "wire", x: -1, y: 0.4, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0.4, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0.32, width: 0.1, layer: "top" },
      { route_type: "wire", x: -1, y: 0.32, width: 0.1, layer: "top" },
    ],
  }
  const contact: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "contact",
    route: [
      { route_type: "wire", x: 9, y: 0.32, width: 0.1, layer: "top" },
      { route_type: "wire", x: 11, y: 0.32, width: 0.1, layer: "top" },
      { route_type: "wire", x: 11, y: 0.2, width: 0.1, layer: "top" },
      { route_type: "wire", x: 9, y: 0.2, width: 0.1, layer: "top" },
    ],
  }
  const otherTraceInputs: Array<{
    id: string
    x: number
    y: number
    layer: "top" | "bottom"
  }> = [
    { id: "signal_tail", x: 20, y: 0.32, layer: "top" },
    { id: "pill", x: 30, y: 0.32, layer: "top" },
    { id: "bottom", x: 40, y: 0.32, layer: "bottom" },
    { id: "wrongLayer", x: 40, y: 0.32, layer: "top" },
    { id: "plated", x: 50, y: 0.32, layer: "bottom" },
    { id: "distant", x: 60, y: 5, layer: "top" },
  ]
  const otherTraces: PcbTrace[] = otherTraceInputs.map(
    ({ id, x, y, layer }): PcbTrace => ({
      type: "pcb_trace",
      pcb_trace_id: id,
      route: [-1, 1].map(
        (offset): PcbTrace["route"][number] => ({
          route_type: "wire",
          x: x + offset,
          y,
          width: 0.1,
          layer,
        }),
      ),
    }),
  )
  const traces: PcbTrace[] = [minimumGap, contact, ...otherTraces]
  const board: AnyCircuitElement[] = [
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "padCircle",
      shape: "circle",
      x: 0,
      y: 0,
      radius: 0.2,
      layer: "top",
    },
    minimumGap,
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "padContact",
      shape: "circle",
      x: 10,
      y: 0,
      radius: 0.2,
      layer: "top",
    },
    contact,
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "padRect",
      shape: "rect",
      x: 20,
      y: 0,
      width: 0.4,
      height: 0.4,
      layer: "top",
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "padPill",
      shape: "pill",
      x: 30,
      y: 0,
      width: 0.8,
      height: 0.4,
      radius: 0.2,
      layer: "top",
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "padBottom",
      shape: "rect",
      x: 40,
      y: 0,
      width: 0.4,
      height: 0.4,
      layer: "bottom",
    },
    {
      type: "pcb_plated_hole",
      pcb_plated_hole_id: "padPlated",
      shape: "circle",
      x: 50,
      y: 0,
      hole_diameter: 0.1,
      outer_diameter: 0.4,
      layers: ["top", "bottom"],
    },
    ...otherTraces,
  ]
  const options = { connMap: new ConnectivityMap({}), minClearance: 0.2 }
  const prepared = createPreparedPadTraceClearanceChecker()
  const compareWithNative = (
    expectedCheckedTraces: number,
  ): ReturnType<typeof checkPadTraceClearance> => {
    const originalElements = structuredClone([...board])
    const originalMap = structuredClone({
      netMap: options.connMap.netMap,
      idToNetMap: options.connMap.idToNetMap,
    })
    const before = prepared.getStats()
    const expected = checkPadTraceClearance([...board], options)
    const actual = prepared(board, options)
    expect(actual).toEqual(expected)
    const after = prepared.getStats()
    expect(after.evaluationCount - before.evaluationCount).toBe(1)
    expect(
      after.cacheEligibleEvaluationCount - before.cacheEligibleEvaluationCount,
    ).toBe(1)
    expect(after.nativeInvocationCount - before.nativeInvocationCount).toBe(
      expectedCheckedTraces === 0 ? 0 : 1,
    )
    expect(after.totalTraceCount - before.totalTraceCount).toBe(traces.length)
    expect(after.nativeCheckedTraceCount - before.nativeCheckedTraceCount).toBe(
      expectedCheckedTraces,
    )
    expect(after.cachedTraceCount - before.cachedTraceCount).toBe(
      traces.length - expectedCheckedTraces,
    )
    expect([...board]).toEqual(originalElements)
    expect({
      netMap: options.connMap.netMap,
      idToNetMap: options.connMap.idToNetMap,
    }).toEqual(originalMap)
    return actual
  }
  const baseline = compareWithNative(traces.length)
  expect(baseline.map((error) => [error.pcb_pad_id, error.pcb_trace_id])).toEqual([
    ["padCircle", "signal"],
    ["padRect", "signal_tail"],
    ["padPill", "pill"],
    ["padBottom", "bottom"],
    ["padPlated", "plated"],
  ])
  expect(baseline[0]!.actual_clearance).toBeCloseTo(0.07, 12)
  expect(baseline[0]!.center).toEqual({ x: -1.5, y: 1.16 })
  expect(compareWithNative(0)).toEqual(baseline)

  // Only this whole trace changes. Prefix-related trace IDs remain safe:
  // pad IDs, not trace IDs, delimit native pad/trace pair keys.
  for (const point of otherTraces[0]!.route) {
    if (point.route_type !== "wire") {
      throw new Error("The rectangle fixture requires wire geometry")
    }
    point.y = 0.34
  }
  const changed = compareWithNative(1)
  expect(changed[1]!.actual_clearance).toBeCloseTo(0.09, 12)
  expect(changed.filter((error) => error.pcb_trace_id !== "signal_tail")).toEqual(
    baseline.filter((error) => error.pcb_trace_id !== "signal_tail"),
  )
  expect(compareWithNative(0)).toEqual(changed)
})
