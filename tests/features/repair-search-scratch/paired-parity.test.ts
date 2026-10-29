import { expect, test } from "bun:test"
import { PairedClearancePathSolver as NativePaired } from "@tscircuit/repair04"
import { PairedClearancePathSolver } from "lib/solvers/RepairSearchScratch/native/PairedClearancePathSolver"
import { createRepairSearchScratchStats } from "lib/solvers/RepairSearchScratch/RepairSearchScratchStats"
import { kernelFixture } from "../../fixtures/repair-search-scratch/kernelFixture"
import { runStepParity } from "../../fixtures/repair-search-scratch/stepParity"

test("paired scratch lanes retain native delayed reverse scheduling and independent exact state", (): void => {
  const ledger = createRepairSearchScratchStats()
  let reverseLanes = 0
  for (let scenario = 0; scenario < 12; scenario++) {
    const task = kernelFixture(100 + scenario, scenario % 3 + 1)
    task.pathInput.heuristicWeight = scenario % 2 ? 3 : 1
    task.pathInput.maxNodes = 1600
    task.pathInput.srj.obstacles.push({
      type: "rect", center: { x: 0, y: 0 }, width: 0.8, height: 5,
      layers: ["top"], connectedTo: ["hard-barrier"],
    })
    const input = { task, reverseMaxNodes: scenario % 3 === 0 ? undefined : 1600 }
    const reference = new NativePaired(input)
    const candidate = new PairedClearancePathSolver(input, ledger)
    runStepParity(reference, candidate)
    expect(candidate.getLaneStats()).toEqual(reference.getLaneStats())
    if (candidate.reverse) reverseLanes++
  }
  expect(reverseLanes).toBeGreaterThan(0)
  expect(ledger.kernelInstances).toBeGreaterThan(0)
  expect(ledger.costScratchFramesCreated).toBeLessThanOrEqual(ledger.kernelInstances)
  expect(ledger.costHitRecordsReused).toBeGreaterThan(0)
})
