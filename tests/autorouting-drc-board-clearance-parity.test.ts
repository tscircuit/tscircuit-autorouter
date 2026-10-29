import { expect, test } from "bun:test"
import { checkPcbTracesOutOfBoard } from "@tscircuit/checks"
import type { AnyCircuitElement, PcbBoard, PcbTrace } from "circuit-json"
import { checkBoardTraceClearance } from "lib/utils/autorouting-drc/checkBoardTraceClearance"

test("native board clearance preserves segment identities and polygon boundary scoring", () => {
  const board: PcbBoard = {
    type: "pcb_board",
    pcb_board_id: "board",
    center: { x: 0, y: 0 },
    width: 10,
    height: 8,
    thickness: 1.6,
    num_layers: 2,
    material: "fr4",
  }
  const traces: PcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "near_edge",
      source_trace_id: "source_near",
      route: [
        { route_type: "wire", x: -4.8, y: -1, width: 0.2, layer: "top" },
        { route_type: "wire", x: -4.8, y: 1, width: 0.2, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "crossing_edge",
      route: [
        { route_type: "wire", x: 4, y: 2, width: 0.1, layer: "top" },
        { route_type: "wire", x: 6, y: 2, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "far_outside",
      route: [
        { route_type: "wire", x: 7, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 8, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "across_notch",
      route: [
        { route_type: "wire", x: -2, y: 2, width: 0.1, layer: "top" },
        { route_type: "wire", x: 2, y: 2, width: 0.1, layer: "top" },
      ],
    },
  ]
  const rectangle: AnyCircuitElement[] = [board, ...traces]
  const initial = checkBoardTraceClearance(rectangle)
  expect(initial.map((error) => error.pcb_trace_id)).toEqual([
    "near_edge",
    "crossing_edge",
  ])
  expect(initial[0]).toMatchObject({
    pcb_trace_error_id: "trace_too_close_to_board_near_edge_segment_0",
    center: { x: -4.8, y: 0 },
  })
  expect(initial as unknown[]).toEqual(
    checkPcbTracesOutOfBoard(rectangle) as unknown[],
  )

  const outlinedBoard: PcbBoard = {
    ...board,
    min_board_edge_clearance: 0.05,
    outline: [
      { x: -5, y: -4 },
      { x: 5, y: -4 },
      { x: 5, y: 4 },
      { x: 1, y: 4 },
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: -1, y: 4 },
      { x: -5, y: 4 },
    ],
  }
  const outlined: AnyCircuitElement[] = [outlinedBoard, ...traces]
  const polygonResult = checkBoardTraceClearance(outlined)
  expect(polygonResult.map((error) => error.pcb_trace_id)).toEqual([
    "crossing_edge",
    "across_notch",
  ])
  expect(polygonResult as unknown[]).toEqual(
    checkPcbTracesOutOfBoard(outlined) as unknown[],
  )
  expect(checkBoardTraceClearance(rectangle, { board }) as unknown[]).toEqual(
    initial,
  )
  expect(
    checkBoardTraceClearance(rectangle, { margin: 0 }) as unknown[],
  ).toEqual(checkPcbTracesOutOfBoard(rectangle, { margin: 0 }) as unknown[])
  expect(checkBoardTraceClearance(traces)).toHaveLength(0)
})
