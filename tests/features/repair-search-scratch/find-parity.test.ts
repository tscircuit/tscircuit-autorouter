import { expect, test } from "bun:test"
import { FindClearancePathSolver as NativeFind, type ClearancePathInput } from "@tscircuit/repair04"
import { FindClearancePathSolver } from "lib/solvers/RepairSearchScratch/native/FindClearancePathSolver"
import { createRepairSearchScratchStats } from "lib/solvers/RepairSearchScratch/RepairSearchScratchStats"
import { pathInput } from "../../fixtures/repair04StepFixtures"
import { runStepParity } from "../../fixtures/repair-search-scratch/stepParity"

test("scratch Find matches every native step, path, work cap and failure across synthetic grids and layers", (): void => {
  const ledger = createRepairSearchScratchStats()
  for (let scenario = 0; scenario < 24; scenario++) {
    const input: ClearancePathInput = {
      ...structuredClone(pathInput),
      maxNodes: scenario % 3 === 0 ? 257 : 2000,
      heuristicWeight: scenario % 2 ? 3 : 1,
      allowLayerChanges: scenario % 4 !== 0,
      gridSize: scenario % 2 ? 0.1 : 0.2,
    }
    input.srj.layerCount = scenario % 3 + 1
    input.srj.allowBlindAndBuriedVias = scenario % 2 === 0
    if (scenario % 5 === 0) input.end = { ...input.end, z: input.srj.layerCount - 1 }
    if (scenario % 7 === 0) input.srj.obstacles[0]!.type = "oval"
    if (scenario % 6 === 0) input.viaHoleDiameter = 0.2
    if (scenario === 22) input.maxNodes = 0
    if (scenario === 23) input.heuristicWeight = Number.NaN
    const reference = new NativeFind({ ...input, stats: { nodesPopped: 0, completionReason: "no-path" } })
    const candidate = new FindClearancePathSolver({ ...input, stats: { nodesPopped: 0, completionReason: "no-path" } }, undefined, ledger)
    runStepParity(reference, candidate)
  }
  expect(ledger.searchInstances).toBe(24)
  expect(ledger.neighborListsServed).toBeGreaterThan(1000)
  expect(ledger.neighborScratchBuffersCreated).toBeLessThanOrEqual(24)
})
