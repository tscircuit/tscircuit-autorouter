import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import {
  createPreparedGetDrcErrors,
  getDrcErrors,
  type GetDrcErrorsOptions,
  type GetDrcErrorsResult,
} from "lib/testing/getDrcErrors"

test("prepared full DRC caches pad results after native endpoint inference with exact output parity", (): void => {
  const traces: PcbTrace[] = [0, 10].map(
    (offset, index): PcbTrace => ({
      type: "pcb_trace",
      pcb_trace_id: `trace-${index}`,
      source_trace_id: `source-${index}`,
      route: [
        {
          route_type: "wire",
          x: offset - 1,
          y: 0.32,
          width: 0.1,
          layer: "top",
        },
        {
          route_type: "wire",
          x: offset,
          y: 0.32,
          width: 0.1,
          layer: "top",
        },
        {
          route_type: "wire",
          x: offset + 1,
          y: 0.32,
          width: 0.1,
          layer: "top",
        },
      ],
    }),
  )
  const board: AnyCircuitElement[] = [0, 10].flatMap(
    (offset, index): AnyCircuitElement[] => [
      {
        type: "source_trace",
        source_trace_id: `source-${index}`,
        connected_source_port_ids: [`source-port-${index}`],
        connected_source_net_ids: [],
      },
      {
        type: "pcb_port",
        pcb_port_id: `port-${index}`,
        source_port_id: `source-port-${index}`,
        x: offset - 1,
        y: 0.32,
        layers: ["top"],
      },
      {
        type: "pcb_smtpad",
        pcb_smtpad_id: `pad-${index}`,
        shape: "circle",
        x: offset,
        y: 0,
        radius: 0.2,
        layer: "top",
      },
      traces[index]!,
    ],
  )
  const options: GetDrcErrorsOptions = {
    includeTraceContinuity: false,
    includeBoardEdge: false,
    traceClearance: 0.1,
  }
  const original = structuredClone(board)
  const prepared = createPreparedGetDrcErrors()
  const compare = (
    input: AnyCircuitElement[],
    nativeTraceCount: number,
    drcOptions: GetDrcErrorsOptions = options,
  ): GetDrcErrorsResult => {
    const actualInput = structuredClone(input)
    const expectedInput = structuredClone(input)
    const before = prepared.getStats()
    const actual = prepared(actualInput, drcOptions)
    expect(actual).toEqual(getDrcErrors(expectedInput, drcOptions))
    expect(actualInput).toEqual(expectedInput)
    const after = prepared.getStats()
    expect(
      after.padTraceNativeCheckedTraceCount -
        before.padTraceNativeCheckedTraceCount,
    ).toBe(nativeTraceCount)
    expect(
      after.padTraceNativeInvocationCount - before.padTraceNativeInvocationCount,
    ).toBe(nativeTraceCount > 0 ? 1 : 0)
    const inferredTrace = actualInput.find(
      (element): element is PcbTrace =>
        element.type === "pcb_trace" && element.pcb_trace_id === "trace-0",
    )!
    expect(inferredTrace.route[0]).toMatchObject({
      start_pcb_port_id: "port-0",
    })
    return actual
  }
  const initial = compare(board, 2)
  expect(
    initial.errors.filter(
      (error) => error.type === "pcb_pad_trace_clearance_error",
    ),
  ).toHaveLength(2)
  compare(board, 0)
  const edited = structuredClone(board)
  const editedTrace = edited.find(
    (element): element is PcbTrace =>
      element.type === "pcb_trace" && element.pcb_trace_id === "trace-0",
  )!
  const midpoint = editedTrace.route[1]!
  if (midpoint.route_type !== "wire") {
    throw new Error("Pad cache fixture requires a wire midpoint")
  }
  midpoint.y = 0.31
  compare(edited, 1)
  const reused = compare(edited, 0)
  const padError = reused.errors.find(
    (error) => error.type === "pcb_pad_trace_clearance_error",
  )!
  padError.message = "caller mutation"
  compare(edited, 0)
  const beforeDisabled = prepared.getStats()
  compare(edited, 0, { ...options, includeTypedTraceClearance: false })
  expect(prepared.getStats().padTraceEvaluationCount).toBe(
    beforeDisabled.padTraceEvaluationCount,
  )
  compare(edited, 0)
  expect(board).toEqual(original)
})
