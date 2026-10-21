import { expect, test } from "bun:test"
import { createPipeline9CandidateValidationFixture } from "../fixtures/createPipeline9CandidateValidationFixture"

test("a candidate with only board-edge violations cannot become a cached zero", (): void => {
  const { candidate, reference, routes } =
    createPipeline9CandidateValidationFixture()
  const outside = [
    {
      ...routes[0]!,
      route: [
        { x: -4, y: 0, z: 0 },
        { x: 0, y: 9, z: 0 },
        { x: 4, y: 0, z: 0 },
      ],
    },
  ]
  const cold = candidate({ traces: [], routes: outside })
  const coldErrors = Array.isArray(cold) ? cold : cold.errors
  expect(coldErrors.length).toBeGreaterThan(0)
  const full = reference({ traces: [], routes: outside })
  const fullErrors = Array.isArray(full) ? full : full.errors
  expect(fullErrors.length).toBeGreaterThan(0)
  expect(coldErrors).toEqual(fullErrors)
  expect(
    fullErrors.every((error) =>
      String(error.pcb_trace_error_id).startsWith("trace_too_close_to_board_"),
    ),
  ).toBe(true)
  for (let repeat = 0; repeat < 2; repeat++) {
    const result = candidate({ traces: [], routes: outside })
    expect(Array.isArray(result) ? result : result.errors).toEqual(fullErrors)
  }
  const clear = candidate({ traces: [], routes })
  expect(Array.isArray(clear) ? clear : clear.errors).toHaveLength(0)
  const checkedAgain = reference({ traces: [], routes: outside })
  expect(
    Array.isArray(checkedAgain) ? checkedAgain : checkedAgain.errors,
  ).toEqual(fullErrors)
})
