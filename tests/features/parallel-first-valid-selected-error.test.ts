import { expect, test } from "bun:test"
import type { MultiHeadHistoryDispatcher, MultiHeadHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import { createFirstValidNode, FirstValidTestPortfolio } from "tests/fixtures/first-valid-hd-fixtures"

test("a consumed competitive candidate rejection preserves error identity and cannot fall through", async (): Promise<void> => {
  const expected = new RangeError("selected history request failed")
  const dispatcher: MultiHeadHistoryDispatcher = async (jobs) => {
    const requests = new Map<number, Promise<MultiHeadHistoryResult>>()
    for (const job of jobs) {
      requests.set(job.candidateId, job.candidateId === 0
        ? Promise.reject(expected)
        : new Promise<MultiHeadHistoryResult>(() => {}))
    }
    return requests
  }
  const solver = new FirstValidTestPortfolio({ nodeWithPortPoints: createFirstValidNode(),
    traceWidth: 0.15, viaDiameter: 0.3, layerCount: 2, enableNegotiatedSearch: false,
  }, dispatcher, { policy: "first-valid" })
  solver.includeGeneric = false
  let observed: unknown
  try {
    await solver.prepareForNextStep()
  } catch (error: unknown) {
    observed = error
  }
  expect(observed).toBe(expected)
  expect(solver.solved).toBe(false)
  expect(solver.winningSolver).toBeUndefined()
  expect(solver.solvedRoutes).toEqual([])
  expect(solver.supervisedSolvers?.every(({ solver: candidate }) => candidate.iterations === 0)).toBe(true)
})
