import { expect, test } from "bun:test"
import { FullConnectionRerouteSolver, TinyHyperGraphSectionPipelineSolver, type TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"

test("port-point pathing consumes the final full-connection reroute stage", () => {
  const solver = new TinyHypergraphPortPointPathingSolver(structuredClone(input) as any)
  solver.solve()
  expect(solver.failed).toBe(false)
  const pipeline = (solver as unknown as {
    tinyPipelineSolver: TinyHyperGraphSectionPipelineSolver & {
      getSolvedTinySolver(): TinyHyperGraphSolver
    }
  }).tinyPipelineSolver
  const finalStage = pipeline.getSolver<FullConnectionRerouteSolver>(
    "rerouteFullConnections",
  )!
  expect(finalStage).toBeDefined()
  expect(finalStage.solved).toBe(true)
  expect(pipeline.getSolvedTinySolver()).toBe(finalStage.getSolvedSolver())
  expect(pipeline.getOutput()).toEqual(finalStage.getOutput())
})
