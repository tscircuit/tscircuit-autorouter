import { expect, test } from "bun:test"
import { createPipeline9CandidateValidationFixture } from "../fixtures/createPipeline9CandidateValidationFixture"

test("a candidate with only missing endpoint connectivity still receives full validation", (): void => {
  const { candidate, reference, routes } =
    createPipeline9CandidateValidationFixture()
  const disconnected = [
    {
      ...routes[0]!,
      route: [
        { x: -4, y: 0, z: 0 },
        { x: -2, y: 0, z: 0 },
      ],
    },
  ]
  const cold = candidate({ traces: [], routes: disconnected })
  const coldErrors = Array.isArray(cold) ? cold : cold.errors
  expect(coldErrors.length).toBeGreaterThan(0)
  const full = reference({ traces: [], routes: disconnected })
  const fullErrors = Array.isArray(full) ? full : full.errors
  expect(fullErrors.length).toBeGreaterThan(0)
  expect(coldErrors).toEqual(fullErrors)
  expect(
    fullErrors.every((error) =>
      String(error.pcb_trace_error_id).startsWith("missing_connection_"),
    ),
  ).toBe(true)
  const result = candidate({ traces: [], routes: disconnected })
  expect(Array.isArray(result) ? result : result.errors).toEqual(fullErrors)
  const checkedAgain = reference({ traces: [], routes: disconnected })
  expect(
    Array.isArray(checkedAgain) ? checkedAgain : checkedAgain.errors,
  ).toEqual(fullErrors)
})
