import { expect, test } from "bun:test"
import {
  FullConnectionRerouteSolver,
  TinyHyperGraphSolver,
} from "tiny-hypergraph/lib/index"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

type TinyHypergraphParams = ConstructorParameters<
  typeof TinyHypergraphPortPointPathingSolver
>[0]
type TinyPipelineTestHarness = {
  tinyPipelineSolver: {
    getSolver<T>(name: string): T | undefined
    getSolvedTinySolver(): TinyHyperGraphSolver
  }
  getCurrentTinySolver(): TinyHyperGraphSolver | undefined
}

test("TinyHypergraph port-point pathing consumes the final full-connection reroute stage", () => {
  const solver = new TinyHypergraphPortPointPathingSolver(
    structuredClone(input) as TinyHypergraphParams,
  )
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const harness = solver as unknown as TinyPipelineTestHarness
  const reroute =
    harness.tinyPipelineSolver.getSolver<FullConnectionRerouteSolver>(
      "rerouteFullConnections",
    )
  expect(reroute).toBeDefined()
  expect(reroute!.solved).toBe(true)
  expect(harness.tinyPipelineSolver.getSolvedTinySolver()).toBe(
    reroute!.getSolvedSolver(),
  )
  expect(harness.getCurrentTinySolver()).toBe(reroute!.getSolvedSolver())
  expect(solver.stats.finalMaxRegionCost).toBe(
    reroute!.stats.finalMaxRegionCost,
  )
  expect(solver.stats.acceptedReroutes).toBe(reroute!.stats.acceptedReroutes)
  expect(solver.getOutput().nodesWithPortPoints.length).toBeGreaterThan(0)
})
