import { expect, test } from "bun:test"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { createRepairSearchScratchStats } from "lib/solvers/RepairSearchScratch/RepairSearchScratchStats"
import { createBoundedRegionalRepairFixture } from "../../fixtures/pipeline9-bounded-regional-repair-fixture"
import { runStepParity } from "../../fixtures/repair-search-scratch/stepParity"

test("regional repair uses the scratch search without changing reference acceptance or resource accounting", (): void => {
  const ledger = createRepairSearchScratchStats()
  const nativeFixture = createBoundedRegionalRepairFixture()
  const candidateFixture = createBoundedRegionalRepairFixture()
  const budget = {
    maxRegions: 1, maxCandidateAttempts: 8, maxPathSearchNodes: 6000,
    maxPathSearchNodesPerCall: 2000, searchDirectionCount: 2 as const,
    pathHeuristicWeight: 3,
  }
  const reference = new Pipeline9BoundedRegionalRepairSolver({ ...nativeFixture, budget })
  const candidate = new Pipeline9BoundedRegionalRepairSolver({ ...candidateFixture, budget, repairSearchScratchStats: ledger })
  runStepParity(reference, candidate)
  expect(candidate.getResult()).toEqual(reference.getResult())
  expect(candidateFixture.drcEvaluator({ traces: [], routes: candidate.getResult().routes })).toEqual(
    nativeFixture.drcEvaluator({ traces: [], routes: reference.getResult().routes }),
  )
  expect(ledger.searchInstances).toBeGreaterThan(0)
  expect(ledger.neighborListsServed).toBeGreaterThan(0)
})
