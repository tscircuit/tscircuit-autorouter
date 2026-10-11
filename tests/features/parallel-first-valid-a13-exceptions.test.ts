import { HighDensitySolverA13 } from "@tscircuit/high-density-a13"
import { expect, spyOn, test } from "bun:test"
import { CompletedFirstValidA13Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/CompletedFirstValidA13Solver"
import { executeFirstValidA13CandidateJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeFirstValidA13CandidateJob"
import type { FirstValidA13CandidateJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/firstValidA13CandidateTypes"
import { createFirstValidNode } from "tests/fixtures/first-valid-hd-fixtures"

test("unexpected original A13 setup, step and output exceptions surface when the result is consumed", (): void => {
  const job: FirstValidA13CandidateJob = { kind: "firstValidA13Candidate",
    params: { nodeWithPortPoints: createFirstValidNode(), traceWidth: 0.15, viaDiameter: 0.3,
      layerCount: 2, effort: 0.25, obstacles: [], enableNegotiatedSearch: true },
    connectivityNetMap: {}, connectivityIdToNetMap: {} }
  const failurePoints = ["_setup", "_step", "getOutput"] as const
  for (const failurePoint of failurePoints) {
    const expected = new RangeError(`deliberate original A13 ${failurePoint} exception`)
    const operation = spyOn(HighDensitySolverA13.prototype, failurePoint).mockImplementation((): never => {
      throw expected
    })
    try {
      const result = executeFirstValidA13CandidateJob(job)
      expect(result.status).toBe("exception")
      if (result.status !== "exception") throw new Error(`Expected original exception, got ${result.status}`)
      expect(result.exception).toEqual({ name: expected.name, message: expected.message })
      expect("routes" in result).toBe(false)
      if (failurePoint === "_setup") expect(result.iterations).toBe(0)
      else expect(result.iterations).toBeGreaterThan(0)
      let consumedError: unknown
      try {
        new CompletedFirstValidA13Solver(job.params.nodeWithPortPoints, result)
      } catch (error: unknown) {
        consumedError = error
      }
      expect(consumedError).toBeInstanceOf(Error)
      expect(consumedError).toMatchObject({ name: expected.name, message: expected.message })
      expect(job.params.nodeWithPortPoints).toEqual(createFirstValidNode())
    } finally {
      operation.mockRestore()
    }
  }
})
