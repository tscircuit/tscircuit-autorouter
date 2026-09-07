import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import {
  createPreparedGetDrcErrors,
  getDrcErrors,
  type GetDrcErrorsOptions,
  type GetDrcErrorsResult,
} from "lib/testing/getDrcErrors"

test("HD prepared full checks reuse unchanged pad pairs without changing native errors or endpoint inference", (): void => {
  const traces: PcbTrace[] = [0.2, 2.2].map(
    (y, index): PcbTrace => ({
      type: "pcb_trace",
      pcb_trace_id: `signal-${index}`,
      source_trace_id: `net-${index}`,
      route: [-1, 0, 1].map(
        (x): PcbTrace["route"][number] => ({
          route_type: "wire",
          x,
          y,
          width: 0.1,
          layer: "top",
        }),
      ),
    }),
  )
  const board: AnyCircuitElement[] = traces.flatMap(
    (trace, index): AnyCircuitElement[] => [
      {
        type: "source_trace",
        source_trace_id: `net-${index}`,
        connected_source_port_ids: [`source-port-${index}`],
        connected_source_net_ids: [],
      },
      {
        type: "pcb_port",
        pcb_port_id: `port-${index}`,
        source_port_id: `source-port-${index}`,
        x: -1,
        y: 0.2 + 2 * index,
        layers: ["top"],
      },
      {
        type: "pcb_smtpad",
        pcb_smtpad_id: `pad-${index}`,
        shape: "circle",
        x: 0,
        y: 2 * index,
        radius: 0.1,
        layer: "top",
      },
      trace,
    ],
  )
  const options: GetDrcErrorsOptions = {
    traceClearance: 0.1,
    viaClearance: 0.1,
    includeTraceContinuity: false,
    includeBoardEdge: false,
  }
  const prepared = createPreparedGetDrcErrors()
  const compare = (input: AnyCircuitElement[]): GetDrcErrorsResult => {
    const actualInput = structuredClone(input)
    const expectedInput = structuredClone(input)
    const actual = prepared(actualInput, options)
    expect(actual).toEqual(getDrcErrors(expectedInput, options))
    expect(actualInput).toEqual(expectedInput)
    return actual
  }
  const initial = compare(board)
  expect(
    initial.errors.filter(
      (error) => error.type === "pcb_pad_trace_clearance_error",
    ),
  ).toHaveLength(2)
  const candidate = board.map((element): AnyCircuitElement => {
    if (element.type !== "pcb_trace" || element.pcb_trace_id !== "signal-0") {
      return element
    }
    return {
      ...element,
      route: element.route.map(
        (point, index): PcbTrace["route"][number] =>
          index === 1 ? { ...point, y: 0.7 } : point,
      ),
    }
  })
  compare(candidate)
  expect(prepared.getStats()).toMatchObject({
    padTraceNativeInvocationCount: 2,
    padTraceEvaluatedTraceCount: 3,
    padTraceCacheHitTraceCount: 1,
  })
  compare(candidate)
  expect(prepared.getStats()).toMatchObject({
    padTraceNativeInvocationCount: 2,
    padTraceEvaluatedTraceCount: 3,
    padTraceCacheHitTraceCount: 3,
  })
})
