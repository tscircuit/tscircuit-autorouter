import { expect, test } from "bun:test"
import { executeGridHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeGridHistoryJob"
import { ParallelPortfolioSingleIntraNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortfolioSingleIntraNodeSolver"
import type { GridHistoryDispatcher, GridHistoryJob, GridHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGridHistoryTypes"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import cmn45 from "tests/fixtures/parallel-grid-history-cmn45.json"

class NativeA01Portfolio extends PortfolioSingleIntraNodeSolver {
  override getCombinationDefs(): string[][] { return [["highDensityA01"], ["highDensityA03"]] }
  readSchedule(): unknown {
    return { iterations: this.iterations, maximumIterations: this.MAX_ITERATIONS,
      solved: this.solved, failed: this.failed, error: this.error, progress: this.progress, stats: this.stats,
      active: this.activeSubSolver?.getSolverName(), winning: this.winningSolver?.getSolverName(),
      candidates: this.supervisedSolvers?.map(({ hyperParameters, solver, f, g, h }) => ({
        hyperParameters, f, g, h, iterations: solver.iterations, maximumIterations: solver.MAX_ITERATIONS,
        solved: solver.solved, failed: solver.failed, error: solver.error, progress: solver.progress,
        solvedSegmentCount: this.getSolvedSegmentCount(solver),
      })), output: this.solvedRoutes }
  }
}

class SharedA01Portfolio extends ParallelPortfolioSingleIntraNodeSolver {
  override getCombinationDefs(): string[][] { return [["highDensityA01"], ["highDensityA03"]] }
  readSchedule(): unknown {
    return { iterations: this.iterations, maximumIterations: this.MAX_ITERATIONS,
      solved: this.solved, failed: this.failed, error: this.error, progress: this.progress, stats: this.stats,
      active: this.activeSubSolver?.getSolverName(), winning: this.winningSolver?.getSolverName(),
      candidates: this.supervisedSolvers?.map(({ hyperParameters, solver, f, g, h }) => ({
        hyperParameters, f, g, h, iterations: solver.iterations, maximumIterations: solver.MAX_ITERATIONS,
        solved: solver.solved, failed: solver.failed, error: solver.error, progress: solver.progress,
        solvedSegmentCount: this.getSolvedSegmentCount(solver),
      })), output: this.solvedRoutes }
  }
}

test("equivalent A01 candidates share physical histories while every native supervisor quantum and logical cap remains unchanged", async (): Promise<void> => {
  for (const capacity of [0, 1, 3]) {
    const jobsComputed: GridHistoryJob[] = []
    let physicalComputedIterations = 0
    let logicalIterationsReplayed = 0
    let equivalentLogicalIterationsReplayed = 0
    let equivalentCandidatesAdmitted = 0
    const dispatcher: GridHistoryDispatcher = Object.assign(async (jobs: GridHistoryJob[]): Promise<Map<number, Promise<GridHistoryResult>>> => {
      expect(jobs.length).toBeLessThanOrEqual(3)
      return new Map(jobs.slice(0, capacity).map((job, index) => {
        jobsComputed.push(job)
        const history = executeGridHistoryJob(job)
        physicalComputedIterations += history.computedIterations
        // Reversed asynchronous delivery keeps sharing independent of arrival.
        return [job.candidateId, new Promise<GridHistoryResult>((resolve) => setTimeout(
          (): void => resolve(history), index === 0 ? 2 : 0))]
      }))
    }, {
      recordReplayWork: (iterations: number, equivalent: boolean): void => {
        logicalIterationsReplayed += iterations
        if (equivalent) equivalentLogicalIterationsReplayed += iterations
      },
      recordEquivalentCandidates: (count: number): void => { equivalentCandidatesAdmitted += count },
    })
    const params = { nodeWithPortPoints: structuredClone(cmn45) as NodeWithPortPoints,
      effort: 1, viaDiameter: 0.3, traceWidth: 0.15, layerCount: 2, enableNegotiatedSearch: false }
    const original = new NativeA01Portfolio(params)
    const shared = new SharedA01Portfolio(params, async () => new Map(), { policy: "ordered", gridHistoryDispatcher: dispatcher })
    while (!original.solved && !original.failed) {
      original.step()
      await shared.prepareForNextStep()
      shared.step()
      expect(shared.readSchedule()).toEqual(original.readSchedule())
    }
    expect(shared.solvedRoutes).toEqual(original.solvedRoutes)
    expect(shared.stats).toEqual(original.stats)
    if (capacity === 0) {
      expect(jobsComputed).toHaveLength(0)
      expect(logicalIterationsReplayed).toBe(0)
      expect(equivalentCandidatesAdmitted).toBe(0)
    } else {
      expect(jobsComputed).toHaveLength(5)
      expect(jobsComputed.filter((job) => job.algorithm === "a01").map((job) => job.params.hyperParameters?.shuffleSeed).sort()).toEqual([0, 1, 2, 5])
      expect(physicalComputedIterations).toBe(712_799)
      expect(equivalentCandidatesAdmitted).toBe(2)
      expect(equivalentLogicalIterationsReplayed).toBe(319_800)
      expect(logicalIterationsReplayed).toBeGreaterThan(physicalComputedIterations)
    }
  }
})
