import { expect, test } from "bun:test"
import { createNegotiatedClearanceSearchKernel, type NegotiatedClearanceSearchInput } from "lib/solvers/RepairSearchScratch/native/negotiatedClearanceSearchKernel"
import { createRepairSearchScratchStats } from "lib/solvers/RepairSearchScratch/RepairSearchScratchStats"
import { kernelFixture, loadNativeKernel } from "../../fixtures/repair-search-scratch/kernelFixture"

test("nested cost calls and thrown weight getters cannot overwrite outer hit records or owner fold state", async (): Promise<void> => {
  const native = await loadNativeKernel()
  const ledger = createRepairSearchScratchStats()
  const build = (candidate: boolean): { kernel: ReturnType<typeof createNegotiatedClearanceSearchKernel>; nested: () => number | undefined; throwNext: () => void } => {
    const task: NegotiatedClearanceSearchInput = kernelFixture(1, 1)
    task.coppers = [0, 0.1, 2].map((x, index) => ({
      a: { x, y: -0.1, z: 0 }, b: { x, y: 0.1, z: 0 }, radius: 0.2,
      minX: x, maxX: x, minY: -0.1, maxY: 0.1, minZ: 0, maxZ: 0,
      spanIndex: index, owner: `owner${index}`, index, cellX: Math.floor(x), cellY: -1, immutable: false,
    }))
    task.weights = [1, 1e20, 3]
    let armed = true, shouldThrow = false, nested: number | undefined
    let kernel: ReturnType<typeof createNegotiatedClearanceSearchKernel>
    Object.defineProperty(task.weights, "0", { get: (): number => {
      if (shouldThrow) { shouldThrow = false; throw new Error("synthetic weight failure") }
      if (armed) {
        armed = false
        nested = kernel.getAdditionalEdgeCost({ x: 1.95, y: 0, z: 0 }, { x: 2.05, y: 0, z: 0 })
      }
      return 1
    } })
    kernel = candidate ? createNegotiatedClearanceSearchKernel(task, ledger) : native.createNegotiatedClearanceSearchKernel(task)
    return { kernel, nested: () => nested, throwNext: () => { shouldThrow = true } }
  }
  const reference = build(false), candidate = build(true)
  const a = { x: -0.05, y: 0, z: 0 }, b = { x: 0.05, y: 0, z: 0 }
  expect(Object.is(candidate.kernel.getAdditionalEdgeCost(a, b), reference.kernel.getAdditionalEdgeCost(a, b))).toBeTrue()
  expect(candidate.nested()).toBe(reference.nested())
  expect(candidate.nested()).toBeGreaterThan(0)
  expect(ledger.costScratchFramesCreated).toBe(2)
  candidate.throwNext(); reference.throwNext()
  expect(() => candidate.kernel.getAdditionalEdgeCost(a, b)).toThrow("synthetic weight failure")
  expect(() => reference.kernel.getAdditionalEdgeCost(a, b)).toThrow("synthetic weight failure")
  expect(Object.is(candidate.kernel.getAdditionalEdgeCost(a, b), reference.kernel.getAdditionalEdgeCost(a, b))).toBeTrue()
  expect(ledger.costScratchFramesCreated).toBe(2)
})
