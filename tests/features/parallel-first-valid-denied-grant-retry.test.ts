import { expect, spyOn, test } from "bun:test"
import { executeMultiHeadHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeMultiHeadHistoryJob"
import type { MultiHeadHistoryDispatcher } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import type { FirstValidHighDensityStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelHighDensityPolicyTypes"
import { createFirstValidNode, FirstValidTestPortfolio } from "tests/fixtures/first-valid-hd-fixtures"

test("denied competitive grants leave original work available and retry only when the checkpoint permits", async (): Promise<void> => {
  let clock = 0
  let requests = 0
  const now = spyOn(performance, "now").mockImplementation(() => clock)
  const stats: FirstValidHighDensityStats = { eligiblePortfolioCount: 0, acceptedCandidateCount: 0,
    rejectedCandidateCount: 0, rejectionReasons: {}, winners: [] }
  const dispatcher: MultiHeadHistoryDispatcher = async (jobs) => {
    requests++
    if (requests === 1) return new Map()
    const candidate = jobs[0]
    if (!candidate) throw new Error("Retry omitted its original candidate")
    return new Map([[candidate.candidateId, Promise.resolve(executeMultiHeadHistoryJob(candidate))]])
  }
  try {
    const solver = new FirstValidTestPortfolio({ nodeWithPortPoints: createFirstValidNode(),
      traceWidth: 0.15, viaDiameter: 0.3, layerCount: 2, enableNegotiatedSearch: false,
    }, dispatcher, { policy: "first-valid", stats })
    await solver.prepareForNextStep()
    expect(requests).toBe(1)
    expect(solver.solved).toBe(false)
    expect(solver.failed).toBe(false)
    expect(solver.generic?.iterations).toBe(0)
    solver.step()
    expect(solver.generic?.iterations).toBe(100)
    clock = 49
    await solver.prepareForNextStep()
    expect(requests).toBe(1)
    expect(solver.solved).toBe(false)
    clock = 50
    await solver.prepareForNextStep()
    await solver.prepareForNextStep()
    expect(requests).toBe(2)
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.generic?.iterations).toBe(100)
    expect(stats.acceptedCandidateCount).toBe(1)
  } finally {
    now.mockRestore()
  }
})
