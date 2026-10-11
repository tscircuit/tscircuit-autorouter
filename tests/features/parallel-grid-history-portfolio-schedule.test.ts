import { expect, test } from "bun:test"
import { executeGridHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeGridHistoryJob"
import { ParallelPortfolioSingleIntraNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPortfolioSingleIntraNodeSolver"
import { ReplayHighDensityA01Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayHighDensityA01Solver"
import { ReplayHighDensityA03Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ReplayHighDensityA03Solver"
import type { GridHistoryJob, GridHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGridHistoryTypes"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import cmn45 from "tests/fixtures/parallel-grid-history-cmn45.json"

class SerialGridPortfolio extends PortfolioSingleIntraNodeSolver {
  override getCombinationDefs(): string[][] { return [["highDensityA01"], ["highDensityA03"]] }

  readSchedule(): unknown {
    return { iterations: this.iterations, maxIterations: this.MAX_ITERATIONS,
      solved: this.solved, failed: this.failed, error: this.error, progress: this.progress,
      adaptiveSearchExpanded: this.adaptiveSearchExpanded, stats: this.stats,
      selected: this.activeSubSolver?.getSolverName(), winner: this.winningSolver?.getSolverName(),
      candidates: this.supervisedSolvers?.map(({ hyperParameters, solver, f, g, h }) => ({
        hyperParameters, f, g, h, name: solver.getSolverName(), iterations: solver.iterations,
        maxIterations: solver.MAX_ITERATIONS, solved: solver.solved, failed: solver.failed,
        error: solver.error, progress: solver.progress, solvedSegmentCount: this.getSolvedSegmentCount(solver),
      })), routes: this.solvedRoutes }
  }
}

class ParallelGridPortfolio extends ParallelPortfolioSingleIntraNodeSolver {
  override getCombinationDefs(): string[][] { return [["highDensityA01"], ["highDensityA03"]] }

  readSchedule(): unknown {
    return { iterations: this.iterations, maxIterations: this.MAX_ITERATIONS,
      solved: this.solved, failed: this.failed, error: this.error, progress: this.progress,
      adaptiveSearchExpanded: this.adaptiveSearchExpanded, stats: this.stats,
      selected: this.activeSubSolver?.getSolverName(), winner: this.winningSolver?.getSolverName(),
      candidates: this.supervisedSolvers?.map(({ hyperParameters, solver, f, g, h }) => ({
        hyperParameters, f, g, h, name: solver.getSolverName(), iterations: solver.iterations,
        maxIterations: solver.MAX_ITERATIONS, solved: solver.solved, failed: solver.failed,
        error: solver.error, progress: solver.progress, solvedSegmentCount: this.getSolvedSegmentCount(solver),
      })), routes: this.solvedRoutes }
  }
}

test("out-of-order grid histories and denied grants preserve every native fitness quantum and adaptive expansion on SRJ18 cmn45", async (): Promise<void> => {
  let admittedHistories = 0
  let outOfOrderDelivery = false
  for (const admit of [true, false]) {
    const delivered: number[] = []
    const dispatcher = async (jobs: GridHistoryJob[]): Promise<Map<number, Promise<GridHistoryResult>>> => {
      if (!admit) return new Map()
      admittedHistories += jobs.length
      const completed = jobs.map((job) => ({ job, history: executeGridHistoryJob(job) }))
      return new Map(completed.map(({ job, history }, index) => {
        return [job.candidateId, new Promise<GridHistoryResult>((resolve) => setTimeout((): void => {
          delivered.push(job.candidateId)
          resolve(history)
        }, index === 0 ? 5 : 0))]
      }))
    }
    const params = { nodeWithPortPoints: structuredClone(cmn45) as NodeWithPortPoints,
      effort: 1, viaDiameter: 0.3, traceWidth: 0.15, layerCount: 2, enableNegotiatedSearch: false }
    const serial = new SerialGridPortfolio(params)
    const parallel = new ParallelGridPortfolio(params, async () => new Map(), {
      policy: "ordered", gridHistoryDispatcher: dispatcher,
    })
    expect(parallel.readSchedule()).toEqual(serial.readSchedule())
    while (!serial.solved && !serial.failed) {
      serial.step()
      await parallel.prepareForNextStep()
      parallel.step()
      expect(parallel.readSchedule()).toEqual(serial.readSchedule())
    }
    expect(parallel.stats).toEqual(serial.stats)
    expect(parallel.solvedRoutes).toEqual(serial.solvedRoutes)
    expect(parallel.adaptiveSearchExpanded).toBe(true)
    expect(parallel.supervisedSolvers?.every(({ solver }) => admit
      ? solver instanceof ReplayHighDensityA01Solver || solver instanceof ReplayHighDensityA03Solver : true)).toBe(true)
    if (admit) outOfOrderDelivery ||= delivered[0] !== 0
    else expect(delivered).toEqual([])
  }
  expect(admittedHistories).toBeGreaterThan(0)
  expect(outOfOrderDelivery).toBe(true)
})
