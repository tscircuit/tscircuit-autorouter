import { expect, test } from "bun:test"
import { createNegotiatedClearanceSearchKernel } from "lib/solvers/RepairSearchScratch/native/negotiatedClearanceSearchKernel"
import { kernelFixture, loadNativeKernel } from "../../fixtures/repair-search-scratch/kernelFixture"

test("ordered owner accumulation keeps native Map key and IEEE behavior for unknown runtime owner values", async (): Promise<void> => {
  const native = await loadNativeKernel()
  const task = kernelFixture(11, 1)
  const keys: unknown[] = [undefined, null, -0, 0, Number.NaN, true, Symbol.for("owner"), {}, "__proto__", "1", "01"]
  task.coppers = keys.map((owner, index) => ({
    a: { x: 0, y: -0.1, z: 0 }, b: { x: 0, y: 0.1, z: 0 }, radius: 0.2,
    minX: 0, maxX: 0, minY: -0.1, maxY: 0.1, minZ: 0, maxZ: 0,
    spanIndex: index, owner: owner as string, index, cellX: 0, cellY: -1, immutable: false,
  }))
  task.weights = keys.map((_, index) => index % 3 ? 1e20 : 1e-20)
  const reference = native.createNegotiatedClearanceSearchKernel(task)
  const candidate = createNegotiatedClearanceSearchKernel(task)
  const a = { x: -0.1, y: 0, z: 0 }, b = { x: 0.1, y: 0, z: 0 }
  for (const value of [0, -0, 1, 1e-20, Infinity, Number.NaN]) {
    task.weights[3] = value
    expect(Object.is(candidate.getAdditionalEdgeCost(a, b), reference.getAdditionalEdgeCost(a, b))).toBeTrue()
    expect(candidate.query(a, b)).toEqual(reference.query(a, b))
  }
})
