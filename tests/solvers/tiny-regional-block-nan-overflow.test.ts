import { expect, test } from "bun:test"
import type { Candidate } from "tiny-hypergraph/lib/core"
import { createTinyRegionalBlockDiagnostics, installTinyRegionalBlockPruning } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installTinyRegionalBlockPruning"
import { createTinyRegionalBlockFixture } from "../fixtures/tiny-regional-block-fixture"

test("unknown best costs never certify a block rejection when finite-coordinate distance overflows", (): void => {
  const solvers = [createTinyRegionalBlockFixture(), createTinyRegionalBlockFixture()]
  for (const solver of solvers) {
    solver.topology.portX.fill(Number.MAX_VALUE)
    solver.topology.portX[0] = -Number.MAX_VALUE
    for (let port = 0; port < solver.topology.portCount; port++) solver.setCandidateBestCost(solver.getHopId(port, 1), NaN)
  }
  const diagnostics = createTinyRegionalBlockDiagnostics()
  installTinyRegionalBlockPruning(solvers[1] as never, diagnostics, true)
  const candidate: Candidate = { portId: 0, nextRegionId: 0, g: 0.5, h: 0, f: 0.5 }
  for (const solver of solvers) solver.expandRegionalHopFrontier(candidate, solver.getRegionalHopFrontier(0, solver.topology.regionIncidentPorts[0]!))
  expect(solvers[1]!.state.candidateQueue.toArray()).toEqual(solvers[0]!.state.candidateQueue.toArray())
  // Typed-array deep equality uses NaN !== NaN in this Bun version. Compare
  // native numeric values explicitly, preserving NaN and signed-zero identity.
  for (let port = 0; port < solvers[0]!.topology.portCount; port++) {
    const left = solvers[0]!.getCandidateBestCost(solvers[0]!.getHopId(port, 1))
    const right = solvers[1]!.getCandidateBestCost(solvers[1]!.getHopId(port, 1))
    expect(Object.is(right, left)).toBeTrue()
  }
  expect(diagnostics.regionalBlockPrunes).toBe(0)
  expect(diagnostics.regionalBlockLeafVisits).toBe(65)
})
