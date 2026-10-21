import { expect, test } from "bun:test"
import { createPipeline9ReferenceCacheFixture } from "../fixtures/createPipeline9ReferenceCacheFixture"

test("nonconsecutive full-reference cache hits preserve board and continuity feedback", (): void => {
  const { solver, reference, routes } = createPipeline9ReferenceCacheFixture()
  const outside = [
    {
      ...routes[0]!,
      route: [
        { x: -4, y: 0, z: 0 },
        { x: 0, y: -9, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
    },
  ]
  const disconnected = [
    {
      ...routes[0]!,
      route: [
        { x: -4, y: 0, z: 0 },
        { x: -2, y: 0, z: 0 },
      ],
    },
  ]
  const board = reference({ traces: [], routes: outside })
  const boardErrors = Array.isArray(board) ? board : board.errors
  expect(
    boardErrors.some((error) =>
      String(error.pcb_trace_error_id).startsWith("trace_too_close_to_board_"),
    ),
  ).toBe(true)
  const continuity = reference({ traces: [], routes: disconnected })
  const continuityErrors = Array.isArray(continuity)
    ? continuity
    : continuity.errors
  expect(
    continuityErrors.some((error) =>
      String(error.pcb_trace_error_id).startsWith("missing_connection_"),
    ),
  ).toBe(true)
  const again = reference({ traces: [], routes: structuredClone(outside) })
  expect(again).toBe(board)
  expect(solver.stats.referenceDrcCacheHitCount).toBe(1)
  expect(solver.stats.referenceDrcCacheMissCount).toBe(2)
  expect(solver.stats.referenceDrcCacheSize).toBe(2)
})
