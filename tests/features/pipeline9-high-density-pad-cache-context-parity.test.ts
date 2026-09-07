import { expect, test } from "bun:test"
import {
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
} from "@tscircuit/checks"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPreparedPadTraceClearanceChecker } from "lib/testing/utils/createPreparedPadTraceClearanceChecker"

test("prepared pad checks invalidate exact native name, endpoint, pad, connectivity and board-default dependencies", (): void => {
  const trace: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "signal",
    route: [
      { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const board: AnyCircuitElement[] = [
    {
      type: "source_component",
      source_component_id: "pad",
      ftype: "simple_chip",
      name: "Original pad name",
    },
    {
      type: "pcb_board",
      pcb_board_id: "board",
      thickness: 1.6,
      num_layers: 2,
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      material: "fr4",
      min_trace_to_pad_edge_clearance: 0.1,
    },
    ...[-1, 1].map(
      (x, index): AnyCircuitElement => ({
        type: "pcb_port",
        pcb_port_id: `port-${index}`,
        source_port_id: `source-${index}`,
        x,
        y: 0,
        layers: ["top"],
      }),
    ),
    trace,
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "pad",
      x: 0,
      y: 0.22,
      shape: "circle",
      radius: 0.1,
      layer: "top",
    },
  ]
  const connMap = new ConnectivityMap({})
  const prepared = createPreparedPadTraceClearanceChecker()
  const compare = (
    input: AnyCircuitElement[],
    options: NonNullable<Parameters<typeof checkPadTraceClearance>[1]>,
  ): ReturnType<typeof checkPadTraceClearance> => {
    const expectedInput = structuredClone(input)
    const actualInput = structuredClone(input)
    checkEachPcbTraceNonOverlapping(expectedInput, options)
    checkEachPcbTraceNonOverlapping(actualInput, options)
    const expected = checkPadTraceClearance(expectedInput, options)
    const before = structuredClone(actualInput)
    const actual = prepared(actualInput, options)
    expect(actual).toEqual(expected)
    expect(actualInput).toEqual(before)
    return actual
  }
  const initial = compare(board, { connMap })
  expect(initial).toHaveLength(1)
  expect(initial[0]!.message).toContain("Original pad name")
  compare(board, { connMap })
  expect(prepared.getStats().nativeInvocationCount).toBe(1)
  const renamed = board.map(
    (element): AnyCircuitElement =>
      element.type === "source_component"
        ? { ...element, name: "New pad name" }
        : element,
  )
  expect(compare(renamed, { connMap })[0]!.message).toContain("New pad name")
  const replacedPort = renamed.map(
    (element): AnyCircuitElement =>
      element.type === "pcb_port" && element.pcb_port_id === "port-0"
        ? { ...element, pcb_port_id: "replacement-port" }
        : element,
  )
  compare(replacedPort, { connMap })
  const movedPad = replacedPort.map(
    (element): AnyCircuitElement =>
      element.type === "pcb_smtpad" && element.shape === "circle"
        ? { ...element, y: 0.23 }
        : element,
  )
  compare(movedPad, { connMap })
  const smallerDefault = movedPad.map(
    (element): AnyCircuitElement =>
      element.type === "pcb_board"
        ? { ...element, min_trace_to_pad_edge_clearance: 0.05 }
        : element,
  )
  expect(compare(smallerDefault, { connMap })).toHaveLength(0)
  expect(compare(smallerDefault, { connMap, minClearance: 0.1 })).toHaveLength(
    1,
  )
  connMap.addConnections([["signal", "pad"]])
  expect(compare(smallerDefault, { connMap, minClearance: 0.1 })).toHaveLength(
    0,
  )
  expect(prepared.getStats().nativeInvocationCount).toBe(7)
})
