import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type {
  TinyHyperGraphSectionPipelineInput,
  TinyHyperGraphSolver,
  UnravelTinyHyperGraphSolver,
} from "tiny-hypergraph/lib/index"

test("TinyHypergraph pathing consumes the post-solve region optimizer", () => {
  const defaultSolver = new TinyHypergraphPortPointPathingSolver(input as any)
  const optimizedParams = structuredClone(input) as any
  optimizedParams.optimizeRegionCosts = true
  const solver = new TinyHypergraphPortPointPathingSolver(optimizedParams)
  defaultSolver.solve()
  solver.solve()

  const defaultPipeline = (
    defaultSolver as unknown as {
      tinyPipelineSolver: {
        getSolver: <Solver>(name: string) => Solver | undefined
      }
    }
  ).tinyPipelineSolver
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

  expect(defaultPipeline.getSolver("optimizeRegionCosts")).toBeUndefined()
  expect(optimizer.solved).toBeTrue()
  expect(optimizer.failed).toBeFalse()
  expect(pipeline.getSolvedTinySolver()).toBe(optimizer)
  expect(pipeline.inputProblem.unravelSolverOptions).toEqual({
    REGION_COST_MODEL: "routing-complexity",
    FIXED_ROUTE_IDS: [],
  })
})
