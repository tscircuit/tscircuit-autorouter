import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type {
  TinyHyperGraphSectionPipelineInput,
  TinyHyperGraphSolver,
  UnravelTinyHyperGraphSolver,
} from "tiny-hypergraph/lib/index"

test("TinyHypergraph pathing consumes the post-solve region optimizer", () => {
  const solver = new TinyHypergraphPortPointPathingSolver(input as any)
  solver.solve()

  const pipeline = (
    solver as unknown as {
      tinyPipelineSolver: {
        inputProblem: TinyHyperGraphSectionPipelineInput
        getSolver: <Solver>(name: string) => Solver | undefined
        getSolvedTinySolver: () => TinyHyperGraphSolver
      }
    }
  ).tinyPipelineSolver
  const optimizer = pipeline.getSolver<UnravelTinyHyperGraphSolver>(
    "optimizeRegionCosts",
  )
  if (!optimizer) {
    throw new Error("Tiny hypergraph pipeline is missing the optimizer stage")
  }

  expect(optimizer.solved).toBeTrue()
  expect(optimizer.failed).toBeFalse()
  expect(pipeline.getSolvedTinySolver()).toBe(optimizer)
  expect(pipeline.inputProblem.unravelSolverOptions).toEqual({
    REGION_COST_MODEL: "routing-complexity",
    FIXED_ROUTE_IDS: [],
  })

  const optimizerStats = optimizer.stats as {
    initialMaxRegionCost: number
    finalMaxRegionCost: number
    initialTotalRegionCost: number
    finalTotalRegionCost: number
    acceptedMutationCount: number
    evaluatedMutationCount: number
    optimizationStopReason: string
    rolledBackPlateauMutations: boolean
    optimized: boolean
  }
  expect(solver.getSolveGraphBenchmarkMetrics()).toMatchObject({
    optimizerInitialMaxRegionCost: optimizerStats.initialMaxRegionCost,
    optimizerFinalMaxRegionCost: optimizerStats.finalMaxRegionCost,
    optimizerInitialTotalRegionCost: optimizerStats.initialTotalRegionCost,
    optimizerFinalTotalRegionCost: optimizerStats.finalTotalRegionCost,
    optimizerAcceptedMutationCount: optimizerStats.acceptedMutationCount,
    optimizerEvaluatedMutationCount: optimizerStats.evaluatedMutationCount,
    optimizerStopReason: optimizerStats.optimizationStopReason,
    optimizerRolledBackPlateauMutations:
      optimizerStats.rolledBackPlateauMutations,
    optimizerOptimized: optimizerStats.optimized,
  })
})
