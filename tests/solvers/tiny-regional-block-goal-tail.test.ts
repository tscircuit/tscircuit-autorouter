import { expect, test } from "bun:test"
import type { Candidate } from "tiny-hypergraph/lib/core"
import { createTinyRegionalBlockDiagnostics, installTinyRegionalBlockPruning } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installTinyRegionalBlockPruning"
import { createTinyRegionalBlockFixture } from "../fixtures/tiny-regional-block-fixture"

test("pruned blocks retain goal callback order across closed tails, reopened budgets and uint32 generation wrap", (): void => {
  const solvers = [createTinyRegionalBlockFixture(), createTinyRegionalBlockFixture()]
  const callbacks: number[][] = [[], []]
  const diagnostics = createTinyRegionalBlockDiagnostics()
  for (const [i, solver] of solvers.entries()) {
    solver.onPathFound = (candidate): void => { callbacks[i]!.push(candidate.portId) }
    for (const port of [15, 31, 47]) {
      solver.state.candidateQueue.queue({ portId: port, nextRegionId: 1, g: 0, h: 0, f: 0 })
      solver.state.candidateQueue.dequeue()
    }
  }
  installTinyRegionalBlockPruning(solvers[1] as never, diagnostics, true)
  const candidate: Candidate = { portId: 0, nextRegionId: 0, g: 0.5, h: 0, f: 0.5 }
  const compare = (): void => {
    for (const solver of solvers) solver.expandRegionalHopFrontier(candidate, solver.getRegionalHopFrontier(0, solver.topology.regionIncidentPorts[0]!))
    expect(solvers[1]!.state.candidateQueue.toArray()).toEqual(solvers[0]!.state.candidateQueue.toArray())
    expect(callbacks[1]).toEqual(callbacks[0])
  }
  compare()
  for (const solver of solvers) solver.setCandidateBestCost(solver.getHopId(2, 1), 1000)
  compare()
  for (const solver of solvers) {
    solver.state.candidateBestCostGeneration = 0xffffffff
    solver.resetCandidateBestCosts()
  }
  compare()
  for (const solver of solvers) {
    solver.state.goalPortId = 48
    solver.state.portAssignment[48] = -1
    solver.topology.portX = solver.topology.portX.slice()
    solver.problem.portPenalty = solver.problem.portPenalty!.slice()
  }
  compare()
  expect(callbacks[0]).toEqual([0])
  expect(diagnostics.regionalBlockPrunedOccurrences).toBeGreaterThan(0)
})
