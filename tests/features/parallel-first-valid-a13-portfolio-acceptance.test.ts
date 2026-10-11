import { expect, test } from "bun:test"
import { executeFirstValidA13CandidateJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeFirstValidA13CandidateJob"
import type { FirstValidA13CandidateDispatcher } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/firstValidA13CandidateTypes"
import type { FirstValidHighDensityStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelHighDensityPolicyTypes"
import { createFirstValidNode, FirstValidTestPortfolio } from "tests/fixtures/first-valid-hd-fixtures"

test("a physical A13 winner uses original portfolio metadata while unsafe and exceptional candidates remain explicit", async (): Promise<void> => {
  const params = { nodeWithPortPoints: createFirstValidNode(), traceWidth: 0.2, viaDiameter: 0.4,
    obstacleMargin: 0.1, layerCount: 2, effort: 0.25, enableNegotiatedSearch: false }
  const stats: FirstValidHighDensityStats = { eligiblePortfolioCount: 0, acceptedCandidateCount: 0,
    rejectedCandidateCount: 0, rejectionReasons: {}, winners: [] }
  let cancellations = 0
  const a13Dispatcher: FirstValidA13CandidateDispatcher = async (job) => {
    expect(job.params.effort).toBe(0.25)
    return { result: Promise.resolve(executeFirstValidA13CandidateJob(job)) }
  }
  const accepted = new FirstValidTestPortfolio(params, async () => new Map(), { policy: "first-valid",
    stats, a13Dispatcher, onAcceptedCandidate: (): void => { cancellations++ } })
  await accepted.prepareForNextStep()
  expect(accepted.solved).toBe(true)
  expect(accepted.failed).toBe(false)
  expect(accepted.generic?.iterations).toBe(0)
  expect(accepted.solvedRoutes).toHaveLength(1)
  expect(accepted.solvedRoutes[0]).toMatchObject({ rootConnectionName: "signal_root", traceThickness: 0.2, viaDiameter: 0.4 })
  expect(stats.winners[0]).toMatchObject({ candidateSource: "a13", candidateId: -1 })
  expect(stats.candidateWork?.[0]).toMatchObject({ candidateSource: "a13", status: "solved" })
  expect(stats.candidateWork?.[0]?.routingIterations).toBeGreaterThan(0)
  expect(cancellations).toBe(1)
  const unsafeStats: FirstValidHighDensityStats = { eligiblePortfolioCount: 0, acceptedCandidateCount: 0,
    rejectedCandidateCount: 0, rejectionReasons: {}, winners: [] }
  const unsafeDispatcher: FirstValidA13CandidateDispatcher = async (job) => {
    const result = executeFirstValidA13CandidateJob(job)
    if (result.status !== "solved") throw new Error("Expected a solved A13 fixture")
    return { result: Promise.resolve({ ...result, routes: result.routes.map((route) => ({ ...route, traceThickness: 0.15 })) }) }
  }
  const rejected = new FirstValidTestPortfolio(params, async () => new Map(), { policy: "first-valid",
    stats: unsafeStats, a13Dispatcher: unsafeDispatcher })
  await rejected.prepareForNextStep()
  expect(rejected.solved).toBe(false)
  expect(rejected.failed).toBe(false)
  expect(rejected.solvedRoutes).toEqual([])
  expect(unsafeStats.rejectionReasons["trace-width"]).toBe(1)
  rejected.generic!.finish = true
  rejected.step()
  expect(rejected.solved).toBe(true)
  expect(rejected.solvedRoutes[0]).toMatchObject({ rootConnectionName: "signal_root", traceThickness: 0.2 })
  const expectedError = new RangeError("consumed speculative A13 transport error")
  const exceptional = new FirstValidTestPortfolio(params, async () => new Map(), { policy: "first-valid",
    a13Dispatcher: async () => ({ result: Promise.reject(expectedError) }) })
  await expect(exceptional.prepareForNextStep()).rejects.toBe(expectedError)
  expect(exceptional.solvedRoutes).toEqual([])
  expect(exceptional.winningSolver).toBeUndefined()
})
