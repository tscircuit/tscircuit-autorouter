import { expect, test } from "bun:test"
import { FindClearancePathSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/FindClearancePathSolver"
import { createMeshInput } from "../fixtures/constrained-corridor-mesh-fixture"

test("native wrapper charges actual mesh pops and reports a bounded failed search as unknown", (): void => {
  for (const maxNodes of [1, 2]) {
    const input = createMeshInput()
    input.maxNodes = maxNodes
    input.getAdditionalEdgeCost = (): number => 1
    const child = new FindClearancePathSolver(input)
    while (!child.solved && !child.failed) child.step()
    expect(child.failed).toBe(false)
    expect(child.solved).toBe(true)
    expect(child.stats.nodesPopped).toBe(maxNodes)
    expect(child.stats.completionReason).toBe(maxNodes === 1 ? "node-limit" : "found")
    const stats = child.stats as typeof child.stats & { meshConstructionWork: number; meshQueuePushes: number }
    expect(stats.meshConstructionWork).toBeGreaterThan(0)
    expect(stats.meshQueuePushes).toBeGreaterThan(1)
    if (maxNodes === 1) expect(child.getOutput()).toBeNull()
    else expect(child.getOutput()).toEqual([input.start, input.end])
  }
})
