import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { executeMultiHeadHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeMultiHeadHistoryJob"
import type { MultiHeadHistoryDispatcher } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import type { FirstValidHighDensityStats } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelHighDensityPolicyTypes"
import { areNodePortPointPairsConnectedByRoutes } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import { createFirstValidNode, FirstValidTestPortfolio } from "tests/fixtures/first-valid-hd-fixtures"

test("competitive winners keep original root metadata and are checked after same-root bridge repair", async (): Promise<void> => {
  const first = createFirstValidNode()
  const node = { ...first, portPoints: [...first.portPoints,
    ...first.portPoints.map((point) => ({ ...point, connectionName: "alias" }))] }
  const connMap = new ConnectivityMap({ signal_root: ["signal", "alias", "signal_root"] })
  const stats: FirstValidHighDensityStats = { eligiblePortfolioCount: 0, acceptedCandidateCount: 0,
    rejectedCandidateCount: 0, rejectionReasons: {}, winners: [] }
  let unbridgedCoverage = true
  const dispatcher: MultiHeadHistoryDispatcher = async (jobs) => new Map(jobs.map((job) => {
    const history = executeMultiHeadHistoryJob(job)
    expect(history.steps.at(-1)?.solved).toBe(true)
    history.solvedRoutes = history.solvedRoutes.filter((route) => route.connectionName === "signal")
    expect(history.solvedRoutes).toHaveLength(1)
    unbridgedCoverage = areNodePortPointPairsConnectedByRoutes(history.solvedRoutes, node)
    return [job.candidateId, Promise.resolve(history)]
  }))
  const solver = new FirstValidTestPortfolio({ nodeWithPortPoints: node, connMap,
    traceWidth: 0.15, viaDiameter: 0.3, layerCount: 2, enableNegotiatedSearch: false,
  }, dispatcher, { policy: "first-valid", stats })
  await solver.prepareForNextStep()
  await solver.prepareForNextStep()
  expect(unbridgedCoverage).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(stats.acceptedCandidateCount).toBe(1)
  expect(stats.rejectedCandidateCount).toBe(0)
  expect(solver.solvedRoutes).toHaveLength(2)
  expect(solver.solvedRoutes.map((route) => route.connectionName).sort()).toEqual(["alias", "signal"])
  expect(solver.solvedRoutes.every((route) => route.rootConnectionName === "signal_root")).toBe(true)
  expect(areNodePortPointPairsConnectedByRoutes(solver.solvedRoutes, node)).toBe(true)
  expect(solver.generic?.iterations).toBe(0)
})
