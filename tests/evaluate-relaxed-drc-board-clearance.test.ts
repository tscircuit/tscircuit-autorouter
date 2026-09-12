import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("repair reference DRC includes the physical board outline by default", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minBoardEdgeClearance: 0.2,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    outline: [
      { x: -3, y: -3 },
      { x: 3, y: -3 },
      { x: 3, y: -1 },
      { x: -1, y: 3 },
      { x: -3, y: 3 },
    ],
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -1, y: 1, layer: "top" },
          { x: 0.8, y: 1, layer: "top" },
        ],
      },
    ],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "signal_trace",
    connection_name: "signal",
    route: [
      { route_type: "wire", x: -1, y: 1, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0.8, y: 1, width: 0.1, layer: "top" },
    ],
  }
  const input = {
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [trace],
    drcOptions: { includeTraceContinuity: false },
  }
  expect(
    evaluateRelaxedDrc({ ...input, includeBoardClearance: false }).errors,
  ).toEqual([])
  expect(
    evaluateRelaxedDrc({
      ...input,
      inputSrj: { ...srj, minBoardEdgeClearance: undefined },
      includeBoardClearance: true,
    }).errors,
  ).not.toEqual([])
  const physical = evaluateRelaxedDrc({
    ...input,
    includeBoardClearance: true,
  })
  expect(physical.errors.length).toBeGreaterThan(0)
  expect(
    physical.errors.every((error) => error.message.includes("board")),
  ).toBe(true)
})
