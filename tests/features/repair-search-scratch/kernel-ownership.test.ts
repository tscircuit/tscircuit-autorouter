import { expect, test } from "bun:test"
import { createNegotiatedClearanceSearchKernel } from "lib/solvers/RepairSearchScratch/native/negotiatedClearanceSearchKernel"
import { createRepairSearchScratchStats } from "lib/solvers/RepairSearchScratch/RepairSearchScratchStats"
import { kernelFixture, loadNativeKernel } from "../../fixtures/repair-search-scratch/kernelFixture"

test("public hit arrays and records escape independently while internal cost scratch stays kernel-owned", async (): Promise<void> => {
  const native = await loadNativeKernel()
  const task = kernelFixture(6)
  const ledger = createRepairSearchScratchStats()
  const candidate = createNegotiatedClearanceSearchKernel(task, ledger)
  const reference = native.createNegotiatedClearanceSearchKernel(task)
  const a = { x: -2, y: -2, z: 0 }, b = { x: 2, y: 2, z: 0 }
  const retained = candidate.query(a, b)
  expect(retained.length).toBeGreaterThan(0)
  const snapshot = structuredClone(retained)
  const another = candidate.query(a, b)
  expect(another).not.toBe(retained)
  for (let index = 0; index < retained.length; index++) expect(another[index]).not.toBe(retained[index])
  for (let query = 0; query < 70; query++) {
    for (const copper of task.coppers) copper.owner = `changing${query}-${copper.index}`
    const start = { x: query % 7 / 2 - 2, y: 0, z: query % 2 }
    const end = { x: start.x + 0.4, y: 0.2, z: start.z }
    expect(Object.is(candidate.getAdditionalEdgeCost(start, end), reference.getAdditionalEdgeCost(start, end))).toBeTrue()
  }
  // The caller owns hit records; internal cost queries cannot rewrite them.
  expect(retained.map(({ ratio }) => ratio)).toEqual(snapshot.map(({ ratio }) => ratio))
  expect(retained.map(({ copper }) => copper.index)).toEqual(snapshot.map(({ copper }) => copper.index))
  expect(ledger.costScratchFramesCreated).toBe(1)
  expect(ledger.publicHitArraysCreated).toBe(2)
})
