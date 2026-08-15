import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import {
  TinyHypergraphPortPointPathingSolver,
  TinyHypergraphUnravelPortPointPathingSolver,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type {
  TinyHyperGraphSectionPipelineInput,
  TinyHyperGraphSolver,
  UnravelTinyHyperGraphSolver,
} from "tiny-hypergraph/lib/index"

test("Pipeline7 alone consumes the post-solve region optimizer", () => {
  const sharedSolver = new TinyHypergraphPortPointPathingSolver(input as any)
  sharedSolver.solve()
  const unravelSolver = new TinyHypergraphUnravelPortPointPathingSolver(
    input as any,
  )
  unravelSolver.solve()

  const pipeline = (
    unravelSolver as unknown as {
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
    FIXED_ROUTE_IDS: [],
  })

  const sharedPipeline = (
    sharedSolver as unknown as {
      tinyPipelineSolver: {
        getSolver: <Solver>(name: string) => Solver | undefined
      }
    }
  ).tinyPipelineSolver
  expect(sharedPipeline.getSolver("optimizeRegionCosts")).toBeUndefined()
})
