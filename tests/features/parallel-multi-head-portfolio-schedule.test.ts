import { expect, test } from "bun:test"
import cn705 from "fixtures/legacy/assets/cn705-nodeWithPortPoints.json"
import { executeMultiHeadHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeMultiHeadHistoryJob"
import type { MultiHeadHistoryJob, MultiHeadHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import { ParallelPortfolioSingleIntraNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortfolioSingleIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

class SerialMultiHeadPortfolio extends PortfolioSingleIntraNodeSolver {
  override getCombinationDefs(): string[][] {
    const combinations = super.getCombinationDefs()
    const selected = combinations.filter((combination) => combination.includes("multiHeadPolyLine"))
    if (selected.length !== 1) {
      throw new Error("Expected one existing multi-head portfolio combination")
    }
    return selected
  }
}

class ParallelMultiHeadPortfolio extends ParallelPortfolioSingleIntraNodeSolver {
  override getCombinationDefs(): string[][] {
    const combinations = super.getCombinationDefs()
    const selected = combinations.filter((combination) => combination.includes("multiHeadPolyLine"))
    if (selected.length !== 1) {
      throw new Error("Expected one existing multi-head portfolio combination")
    }
    return selected
  }
}

function readPortfolioState(solver: PortfolioSingleIntraNodeSolver): unknown {
  return {
    iterations: solver.iterations, maxIterations: solver.MAX_ITERATIONS,
    solved: solver.solved, failed: solver.failed, error: solver.error, progress: solver.progress,
    adaptiveSearchExpanded: solver.adaptiveSearchExpanded,
    selected: solver.activeSubSolver?.getSolverName(),
    winner: solver.winningSolver?.getSolverName(),
    candidates: solver.supervisedSolvers?.map(({ hyperParameters, solver: candidate, f, g, h }) => ({
      hyperParameters, f, g, h, name: candidate.getSolverName(),
      iterations: candidate.iterations, maxIterations: candidate.MAX_ITERATIONS,
      solved: candidate.solved, failed: candidate.failed, error: candidate.error, progress: candidate.progress,
    })),
    routes: solver.solvedRoutes,
  }
}

test("out-of-order histories and denied grants preserve the exact portfolio fitness schedule", async (): Promise<void> => {
  const nodes: NodeWithPortPoints[] = [
    {
      capacityMeshNodeId: "parallel-portfolio-crossing", center: { x: 0, y: 0 },
      width: 6, height: 6, availableZ: [0, 3],
      portPoints: [
        { connectionName: "A", rootConnectionName: "root_A", x: -2.5, y: -2.5, z: 0 },
        { connectionName: "A", rootConnectionName: "root_A", x: 2.5, y: 2.5, z: 0 },
        { connectionName: "B", rootConnectionName: "root_B", x: -2.5, y: 2.5, z: 0 },
        { connectionName: "B", rootConnectionName: "root_B", x: 2.5, y: -2.5, z: 0 },
      ],
    },
    cn705.nodeWithPortPoints as NodeWithPortPoints,
  ]
  let historyCount = 0
  const fixtures = nodes.flatMap((node) => [{ node, admit: true }, { node, admit: false }])
  for (const { node, admit } of fixtures) {
    const completed: number[] = []
    const dispatcher = async (jobs: MultiHeadHistoryJob[]): Promise<Map<number, Promise<MultiHeadHistoryResult>>> => {
      historyCount += jobs.length
      if (!admit) return new Map()
      const histories = jobs.map((job) => ({ job, history: executeMultiHeadHistoryJob(job) }))
      return new Map(histories.map(({ job, history }, index) => [job.candidateId,
        new Promise<MultiHeadHistoryResult>((resolve) => setTimeout(() => {
          completed.push(job.candidateId)
          resolve(history)
        }, index === 0 ? 5 : 0)),
      ]))
    }
    const params = { nodeWithPortPoints: structuredClone(node), effort: 1, enableNegotiatedSearch: false }
    const serial = new SerialMultiHeadPortfolio(params)
    const parallel = new ParallelMultiHeadPortfolio(params, dispatcher)
    expect(readPortfolioState(parallel)).toEqual(readPortfolioState(serial))
    while (!serial.solved && !serial.failed) {
      serial.step()
      await parallel.prepareForNextStep()
      parallel.step()
      expect(readPortfolioState(parallel)).toEqual(readPortfolioState(serial))
    }
    expect(parallel.stats).toMatchObject(serial.stats)
    expect(parallel.solvedRoutes).toEqual(serial.solvedRoutes)
    expect(completed).toHaveLength(admit ? 2 : 0)
    if (admit) expect(completed[0]).toBeGreaterThan(completed[1]!)
  }
  expect(historyCount).toBe(8)
})
