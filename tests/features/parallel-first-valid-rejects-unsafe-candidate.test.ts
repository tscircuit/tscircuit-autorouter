import { expect, test } from "bun:test"
import { executeMultiHeadHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeMultiHeadHistoryJob"
import type { MultiHeadHistoryDispatcher } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import type { FirstValidHighDensityStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelHighDensityPolicyTypes"
import { createFirstValidNode, FirstValidTestPortfolio } from "tests/fixtures/first-valid-hd-fixtures"

test("first-valid rejects narrow solved candidates without disturbing the unfinished generic strategy", async (): Promise<void> => {
  const node = createFirstValidNode()
  const stats: FirstValidHighDensityStats = { eligiblePortfolioCount: 0, acceptedCandidateCount: 0,
    rejectedCandidateCount: 0, rejectionReasons: {}, winners: [] }
  const dispatcher: MultiHeadHistoryDispatcher = async (jobs) => new Map(jobs.map((job) => [
    job.candidateId, Promise.resolve(executeMultiHeadHistoryJob(job)),
  ]))
  const solver = new FirstValidTestPortfolio({ nodeWithPortPoints: node,
    traceWidth: 0.2, viaDiameter: 0.3, obstacleMargin: 0.1, layerCount: 2,
    enableNegotiatedSearch: false }, dispatcher, { policy: "first-valid", stats })
  await solver.prepareForNextStep()
  await solver.prepareForNextStep()
  expect(stats.acceptedCandidateCount).toBe(0)
  expect(stats.rejectedCandidateCount).toBe(2)
  expect(stats.rejectionReasons).toEqual({ "trace-width": 2 })
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(solver.winningSolver).toBeUndefined()
  expect(solver.solvedRoutes).toEqual([])
  expect(solver.generic?.iterations).toBe(0)
  if (!solver.generic) throw new Error("Generic strategy was not initialized")
  solver.generic.finish = true
  solver.step()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.winningSolver).toBe(solver.generic as any)
  expect(solver.solvedRoutes).toHaveLength(1)
  expect(solver.solvedRoutes[0]).toMatchObject({ traceThickness: 0.2, rootConnectionName: "signal_root" })
})
