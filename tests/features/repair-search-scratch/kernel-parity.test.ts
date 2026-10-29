import { expect, test } from "bun:test"
import { createNegotiatedClearanceSearchKernel } from "lib/solvers/RepairSearchScratch/native/negotiatedClearanceSearchKernel"
import { createRepairSearchScratchStats } from "lib/solvers/RepairSearchScratch/RepairSearchScratchStats"
import { kernelFixture, loadNativeKernel } from "../../fixtures/repair-search-scratch/kernelFixture"

test("scratch kernels preserve ordered hits and exact native costs across repeated and mutable-owner queries", async (): Promise<void> => {
  const native = await loadNativeKernel()
  const ledger = createRepairSearchScratchStats()
  for (let seed = 1; seed <= 80; seed++) {
    const task = kernelFixture(seed, seed % 3 + 1)
    task.pathInput.srj.allowBlindAndBuriedVias = seed % 2 === 0
    const reference = native.createNegotiatedClearanceSearchKernel(task)
    const candidate = createNegotiatedClearanceSearchKernel(task, ledger)
    for (let query = 0; query < 40; query++) {
      const a = { x: query % 9 / 2 - 2, y: (query * 7) % 11 / 2 - 2.5, z: query % task.pathInput.srj.layerCount }
      const b = query % 3 === 0 ? { ...a, z: (a.z + 1) % task.pathInput.srj.layerCount } : {
        x: a.x + (query % 5 + 1) / 5, y: a.y + (query % 7 - 3) / 5, z: a.z,
      }
      if (query % 4 === 0) task.coppers[query]!.owner = `changed${query}-${seed}`
      if (query === 17) task.weights[1] = Number.NaN
      if (query === 21) task.weights[2] = -0
      if (query === 23) task.weights[3] = Infinity
      expect(candidate.query(a, b)).toEqual(reference.query(a, b))
      expect(Object.is(candidate.getAdditionalEdgeCost(a, b), reference.getAdditionalEdgeCost(a, b))).toBeTrue()
      expect(Object.is(candidate.getAdditionalEdgeCost(a, b), reference.getAdditionalEdgeCost(a, b))).toBeTrue()
    }
  }
  expect(ledger.kernelInstances).toBe(80)
  expect(ledger.costQueriesServed).toBeGreaterThan(1000)
  expect(ledger.ownerAccumulatorsServed).toBeGreaterThan(1000)
  expect(ledger.costHitRecordsReused).toBeGreaterThan(ledger.costHitRecordsCreated)
  expect(ledger.costScratchFramesCreated).toBeLessThanOrEqual(80)
})
