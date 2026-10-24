import { expect, test } from "bun:test"
import type { Candidate } from "tiny-hypergraph/lib/core"
import { createTinyRegionalBlockDiagnostics, installTinyRegionalBlockPruning } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installTinyRegionalBlockPruning"
import { createTinyRegionalBlockFixture, type RegionalBlockHost } from "../fixtures/tiny-regional-block-fixture"

test("explicit content-validation mode preserves heap order through costs, contexts and edits outside native immutable metadata contract", (): void => {
  const native = createTinyRegionalBlockFixture()
  const optimized = createTinyRegionalBlockFixture()
  const diagnostics = createTinyRegionalBlockDiagnostics()
  installTinyRegionalBlockPruning(optimized as never, diagnostics, true, true)
  const candidate: Candidate = { portId: 0, nextRegionId: 0, g: 0.5, h: 0, f: 0.5 }
  const compare = (): void => {
    for (const solver of [native, optimized]) solver.expandRegionalHopFrontier(candidate, solver.getRegionalHopFrontier(0, solver.topology.regionIncidentPorts[0]!))
    expect(optimized.state.candidateQueue.toArray()).toEqual(native.state.candidateQueue.toArray())
    expect(optimized.state.candidateBestCostByHopId).toEqual(native.state.candidateBestCostByHopId)
    expect(optimized.state.candidateBestCostGenerationByHopId).toEqual(native.state.candidateBestCostGenerationByHopId)
    expect(optimized.state.regionSegments).toEqual(native.state.regionSegments)
  }
  compare()
  expect(diagnostics.regionalBlockPrunedOccurrences).toBeGreaterThan(0)
  const mutate = (edit: (solver: RegionalBlockHost) => void): void => {
    for (const solver of [native, optimized]) edit(solver)
    compare()
  }
  mutate(solver => { solver.setCandidateBestCost(solver.getHopId(17, 1), 1000) })
  mutate(solver => { solver.topology.portX[33] = 0; solver.topology.portY[33] = 0; solver.problem.portPenalty![33] = -1 })
  mutate(solver => { solver.topology.incidentPortRegion[34] = [0]; solver.topology.regionIncidentPorts[0]![35] = 33 })
  mutate(solver => { solver.state.portAssignment[33] = 7; solver.problem.portSectionMask[36] = 0; solver.topology.portZ[37] = 1 })
  mutate(solver => { solver.state.candidateQueue.clear(); solver.resetCandidateBestCosts() })
  mutate(solver => {
    const c = solver.state.candidateQueue.dequeue()
    if (c) solver.state.candidateQueue.queue(c)
    solver.DISTANCE_TO_COST = -1
  })
  mutate(solver => { solver.DISTANCE_TO_COST = 0.05; solver.state.goalPortId = 17; solver.state.portAssignment[17] = 8 })
  mutate(solver => { solver.topology.portX[40] = NaN; solver.problem.portPenalty![42] = Infinity })
  expect(optimized.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
  expect(optimized.stats).toEqual(native.stats)
  expect(diagnostics.regionalBlockContextResets).toBeGreaterThan(0)
  expect(diagnostics.regionalBlockContentValidationEnabled).toBe(1)
})
