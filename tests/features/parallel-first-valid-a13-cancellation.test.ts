import { HighDensitySolverA13 } from "@tscircuit/high-density-a13"
import { expect, spyOn, test } from "bun:test"
import { CompletedFirstValidA13Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/CompletedFirstValidA13Solver"
import { createFirstValidA13Candidate } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createFirstValidA13Candidate"
import { executeFirstValidA13CandidateJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeFirstValidA13CandidateJob"
import type { FirstValidA13CandidateJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/firstValidA13CandidateTypes"
import { createFirstValidNode } from "tests/fixtures/first-valid-hd-fixtures"

test("first-valid A13 polls cancellation before every original kernel batch without changing effort", (): void => {
  const cancellation = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  const job: FirstValidA13CandidateJob = { kind: "firstValidA13Candidate",
    params: { nodeWithPortPoints: createFirstValidNode(), traceWidth: 0.2, viaDiameter: 0.4,
      layerCount: 2, effort: 0.5, obstacles: [], enableNegotiatedSearch: true },
    connectivityNetMap: {}, connectivityIdToNetMap: {},
    cancellationBuffer: cancellation.buffer as SharedArrayBuffer }
  const candidate = createFirstValidA13Candidate(job)
  expect(candidate).toBeInstanceOf(HighDensitySolverA13)
  expect(candidate.traceThickness).toBe(0.2)
  expect(candidate.viaDiameter).toBe(0.4)
  expect(candidate.props.stepMultiplier).toBe(1000)
  expect(candidate.props.maxSearchIterations).toBe(25_000_000)
  expect(candidate.props.maxRounds).toBe(100)
  expect(candidate.MAX_ITERATIONS).toBe(50_000_000)
  const originalStep = HighDensitySolverA13.prototype._step
  let originalSteps = 0
  const step = spyOn(HighDensitySolverA13.prototype, "_step").mockImplementation(function (this: HighDensitySolverA13): void {
    originalStep.call(this)
    originalSteps++
    expect(this.solved).toBe(false)
    expect(this.failed).toBe(false)
    Atomics.store(cancellation, 0, 1)
  })
  try {
    Atomics.store(cancellation, 0, 1)
    const beforeStart = executeFirstValidA13CandidateJob(job)
    expect(beforeStart).toMatchObject({ status: "cancelled", iterations: 0, routingIterations: 0 })
    expect(originalSteps).toBe(0)
    Atomics.store(cancellation, 0, 0)
    const betweenSteps = executeFirstValidA13CandidateJob(job)
    expect(betweenSteps.status).toBe("cancelled")
    expect(betweenSteps.iterations).toBe(1)
    expect(betweenSteps.routingIterations).toBeGreaterThan(0)
    expect(betweenSteps.maxIterations).toBe(candidate.MAX_ITERATIONS)
    expect(originalSteps).toBe(1)
    expect("routes" in betweenSteps).toBe(false)
    expect(() => new CompletedFirstValidA13Solver(job.params.nodeWithPortPoints, betweenSteps)).toThrow("status cancelled")
    expect(() => new CompletedFirstValidA13Solver(job.params.nodeWithPortPoints, beforeStart)).toThrow("status cancelled")
  } finally {
    step.mockRestore()
  }
})
