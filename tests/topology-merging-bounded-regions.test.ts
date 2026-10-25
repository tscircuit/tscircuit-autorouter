import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { createStripedTopologyMergeInput } from "./fixtures/createStripedTopologyMergeInput"

test("striped topology merging does not retain every artificial X/Y subdivision", () => {
  const count = 160
  const input = createStripedTopologyMergeInput(count)
  const before = JSON.stringify(input)
  const solver = new TopologyMergingSolver(input)
  let peakRetainedRegions = 0
  while (!solver.solved && !solver.failed) {
    solver.step()
    peakRetainedRegions = Math.max(peakRetainedRegions,
      (solver as unknown as { atomicRegions: unknown[] }).atomicRegions.length)
  }
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const output = solver.getOutput()
  expect(output).toHaveLength(count * 6)
  expect(output.reduce((area,node) => area+node.width*node.height*node.availableZ.length,0)).toBeCloseTo(4*count*count,5)
  expect(JSON.stringify(input)).toBe(before)
  expect(peakRetainedRegions).toBeLessThanOrEqual(count*16)
})
