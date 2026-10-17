import { expect, test } from "bun:test"
import { NodePipeline9RepairRuntime } from "lib/autorouter-pipelines/Pipeline9_Parallel/NodePipeline9RepairRuntime"
import type { Pipeline9NegotiationTask } from "lib/autorouter-pipelines/Pipeline9_Parallel/pipeline9NegotiationTask"

test("worker failures surface instead of publishing a successful repair", async (): Promise<void> => {
  const runtime = new NodePipeline9RepairRuntime(8)
  const task: Pipeline9NegotiationTask = {
    srj: { layerCount: 2, minTraceWidth: 0.1, obstacles: [], connections: [], bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 } },
    routes: [], bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    lockedPointIndices: [], dirtyRouteIndices: [], allowLayerChanges: true,
    traceClearance: 0.1, viaClearance: 0.1, maxPathSearchNodes: -1, maxPathSearchCalls: 1,
  }
  try {
    expect(() => runtime.runNegotiations([task])).toThrow("work budgets must be nonnegative")
    expect(() => runtime.runNegotiations([task])).toThrow("runtime failed")
  } finally {
    await runtime.dispose()
  }
})
