import { expect, spyOn, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { executeMultiHeadHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeMultiHeadHistoryJob"
import { ParallelPortfolioSingleIntraNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortfolioSingleIntraNodeSolver"
import type { MultiHeadHistoryJob, MultiHeadHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { createNetworkedNode } from "tests/fixtures/pipeline9-networked-fixtures"

class CanonicalMultiHeadPortfolio extends ParallelPortfolioSingleIntraNodeSolver {
  override getCombinationDefs(): string[][] {
    const combinations = super.getCombinationDefs()
    const selected = combinations.filter((combination) => combination.includes("multiHeadPolyLine"))
    if (selected.length !== 1) {
      throw new Error("Expected one existing multi-head portfolio combination")
    }
    return selected
  }
}

test("multi-head transport preserves canonical identity when duplicate-piece aliases merge nets", async (): Promise<void> => {
  const connMap = new ConnectivityMap({ signal_net: ["signal"], root_net: ["root"] })
  connMap.addConnections([["signal_regional_0", "signal", "root"]])
  connMap.addConnections([["signal_regional_1", "signal", "root"]])
  const ids = ["signal", "root", "signal_regional_0", "signal_regional_1"]
  expect(connMap.getNetConnectedToId("signal")).toBe("signal_net")
  expect(new ConnectivityMap(structuredClone(connMap.netMap)).getNetConnectedToId("signal")).toBe("root_net")
  const jobsObserved: MultiHeadHistoryJob[] = []
  const mapsObserved: ConnectivityMap[] = []
  const step = spyOn(MultiHeadPolyLineIntraNodeSolver3.prototype, "_step").mockImplementation(function (this: MultiHeadPolyLineIntraNodeSolver3): void {
    if (!this.connMap) throw new Error("History worker lost its connectivity map")
    mapsObserved.push(this.connMap)
    this.solved = false
    this.failed = true
    this.error = "Stop after inspecting canonical history connectivity"
    this.progress = 0
  })
  const dispatcher = async (jobs: MultiHeadHistoryJob[]): Promise<Map<number, Promise<MultiHeadHistoryResult>>> => {
    const requests = new Map<number, Promise<MultiHeadHistoryResult>>()
    for (const job of jobs) {
      const projectedJob = structuredClone(job)
      jobsObserved.push(projectedJob)
      requests.set(job.candidateId, Promise.resolve(executeMultiHeadHistoryJob(projectedJob)))
    }
    return requests
  }
  try {
    const solver = new CanonicalMultiHeadPortfolio({
      nodeWithPortPoints: createNetworkedNode({ nodeId: "canonical-multi-head", connectionName: "signal" }),
      connMap, enableNegotiatedSearch: false,
    }, dispatcher)
    await solver.prepareForNextStep()
    expect(jobsObserved).toHaveLength(2)
    expect(mapsObserved).toHaveLength(2)
    for (const job of jobsObserved) {
      expect(job.connectivityNetMap).toEqual(connMap.netMap)
      expect(job.connectivityIdToNetMap).toEqual(connMap.idToNetMap)
    }
    for (const workerMap of mapsObserved) {
      expect(workerMap.netMap.root_net).toBe(workerMap.netMap.signal_net)
      for (const id of ids) {
        expect(workerMap.getNetConnectedToId(id)).toBe(connMap.getNetConnectedToId(id))
        expect(workerMap.areIdsConnected(id, "signal")).toBe(true)
      }
    }
    expect(solver.solved).toBe(false)
    expect(solver.failed).toBe(false)
    expect(solver.iterations).toBe(0)
    expect(connMap.getNetConnectedToId("signal")).toBe("signal_net")
  } finally {
    step.mockRestore()
  }
})
