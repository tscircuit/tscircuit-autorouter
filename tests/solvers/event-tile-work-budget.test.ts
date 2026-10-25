import { expect, test } from "bun:test"
import { EventTileSearchKernel } from "lib/solvers/HighDensitySolver/EventTileSearchKernel"
import { emptyEventInput } from "./eventTileTestUtils"

test("event compilation, macro setup, search and expanded parent publication share one work allowance", () => {
  const kernel = new EventTileSearchKernel(20, 15, 2, 0.1, 0.1)
  const input = emptyEventInput(20, 15, 2)
  kernel.begin(input, 0, 599, 0.5)
  const early = kernel.run(1000, 9)
  expect(early).toEqual({ status: 3, expansions: 9 })
  expect(kernel.diagnostics.inputStatesScanned).toBe(9)
  expect(() => kernel.copyParents(new Int32Array(600))).toThrow()
  kernel.begin(input, 0, 599, 0.5)
  let used = 0
  let status = 0
  const before = kernel.diagnostics.workUnits
  while (status === 0) {
    const result = kernel.run(1, 10000 - used)
    expect(result.expansions).toBeLessThanOrEqual(1)
    used += result.expansions
    status = result.status
  }
  expect(status).toBe(1)
  expect(kernel.diagnostics.workUnits - before).toBe(used)
  expect(used).toBeGreaterThan(600)
  expect(kernel.diagnostics.compressedQueries).toBe(1)
  expect(kernel.diagnostics.reconstructedGridEdges).toBeGreaterThan(20)
  input.fixed.fill(1)
  kernel.begin(input, 0, 599, 0.5)
  status = 0
  while (status === 0) status = kernel.run(1000, 10000).status
  expect(status).toBe(2)
})
