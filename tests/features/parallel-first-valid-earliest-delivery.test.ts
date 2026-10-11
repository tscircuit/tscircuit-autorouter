import { expect, test } from "bun:test"
import { executeMultiHeadHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeMultiHeadHistoryJob"
import type { MultiHeadHistoryDispatcher, MultiHeadHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import type { FirstValidHighDensityStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelHighDensityPolicyTypes"
import { createFirstValidNode, FirstValidTestPortfolio } from "tests/fixtures/first-valid-hd-fixtures"

test("first-valid accepts the other solved head while the originally selected head is still pending", async (): Promise<void> => {
  const stats: FirstValidHighDensityStats = { eligiblePortfolioCount: 0, acceptedCandidateCount: 0,
    rejectedCandidateCount: 0, rejectionReasons: {}, winners: [] }
  let rejectUnused!: (error: unknown) => void
  let deliveredWinner = false
  const dispatcher: MultiHeadHistoryDispatcher = async (jobs) => {
    const requests = new Map<number, Promise<MultiHeadHistoryResult>>()
    for (const job of jobs) {
      if (job.candidateId === 0) requests.set(job.candidateId, new Promise((_, reject) => { rejectUnused = reject }))
      else requests.set(job.candidateId, new Promise((resolve) => setTimeout(() => {
        deliveredWinner = true
        resolve(executeMultiHeadHistoryJob(job))
      }, 0)))
    }
    return requests
  }
  const solver = new FirstValidTestPortfolio({ nodeWithPortPoints: createFirstValidNode(),
    traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.1, layerCount: 2,
    enableNegotiatedSearch: false }, dispatcher, { policy: "first-valid", stats })
  solver.includeGeneric = false
  await solver.prepareForNextStep()
  expect(deliveredWinner).toBe(true)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(stats.acceptedCandidateCount).toBe(1)
  expect(stats.winners[0]?.candidateId).toBe(1)
  expect(solver.supervisedSolvers?.[0]?.solver.iterations).toBe(0)
  expect(solver.winningSolver).toBe(solver.supervisedSolvers?.[1]?.solver)
  expect(solver.solvedRoutes[0]?.rootConnectionName).toBe("signal_root")
  rejectUnused(new RangeError("unused losing speculative candidate"))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  await solver.prepareForNextStep()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(stats.acceptedCandidateCount).toBe(1)
})
