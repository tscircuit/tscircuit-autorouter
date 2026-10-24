import { expect, test } from "bun:test"
import type { Candidate } from "tiny-hypergraph/lib/core"
import { createTinyRegionalBlockDiagnostics, installTinyRegionalBlockPruning } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installTinyRegionalBlockPruning"
import { createTinyRegionalBlockFixture } from "../fixtures/tiny-regional-block-fixture"

test("duplicate native occurrences do not duplicate reverse membership across frontier replacement and native-domain delegation", (): void => {
  const solvers = [createTinyRegionalBlockFixture(), createTinyRegionalBlockFixture()]
  for (const solver of solvers) solver.topology.regionIncidentPorts[0]![7] = 3
  const diagnostics = createTinyRegionalBlockDiagnostics()
  installTinyRegionalBlockPruning(solvers[1] as never, diagnostics, true)
  const candidate: Candidate = { portId: 0, nextRegionId: 0, g: 0.5, h: 0, f: 0.5 }
  const compare = (): void => {
    for (const solver of solvers) solver.expandRegionalHopFrontier(candidate, solver.getRegionalHopFrontier(0, solver.topology.regionIncidentPorts[0]!))
    expect(solvers[1]!.state.candidateQueue.toArray()).toEqual(solvers[0]!.state.candidateQueue.toArray())
    expect(solvers[1]!.state.candidateBestCostByHopId).toEqual(solvers[0]!.state.candidateBestCostByHopId)
  }
  compare()
  for (let repeat = 0; repeat < 25; repeat++) {
    for (const solver of solvers) solver.topology.regionIncidentPorts[0] = [...solver.topology.regionIncidentPorts[0]!]
    compare()
  }
  const before = diagnostics.regionalBlockReverseVisits
  for (const solver of solvers) solver.setCandidateBestCost(solver.getHopId(17, 1), 1)
  expect(diagnostics.regionalBlockReverseVisits - before).toBe(1)
  compare()
  for (const solver of solvers) solver.DISTANCE_TO_COST = -1
  compare()
  for (const solver of solvers) solver.DISTANCE_TO_COST = 0.05
  compare()
  expect(diagnostics.regionalBlockCleanupVisits).toBeGreaterThan(0)
  expect(diagnostics.regionalBlockContentValidationEnabled).toBe(0)
})
