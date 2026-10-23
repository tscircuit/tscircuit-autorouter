import { expect, test } from "bun:test"
import { ClearanceSearchTaskWorklist, type ClearanceSearchTask } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/ClearanceSearchTaskWorklist"

test("a completed task survives unrelated cost changes but a changed observed edge forces native recomputation", (): void => {
  const worklist = new ClearanceSearchTaskWorklist()
  const task: ClearanceSearchTask = { identity: "route/anchors", context: "hard geometry and rules",
    dependencies: "selected path and exact effort", maxNodes: 20, layerCount: 2 }
  const a = { x: 0, y: 0, z: 0 }, b = { x: 1, y: 0, z: 0 }, c = { x: 2, y: 0, z: 0 }
  const costs = new Map([["0,1", 0], ["1,2", 2], ["8,9", 0]])
  const current = (from: typeof a, to: typeof a): number => costs.get(`${from.x},${to.x}`)!
  const result = { path: [a, b, c], stats: { nodesPopped: 13, completionReason: "found" as const } }
  worklist.complete(task, result, [{ a, b, cost: 0 }, { a: b, b: c, cost: 2 }])
  costs.set("8,9", 999)
  expect(worklist.lookup(task, current)).toEqual(result)
  expect(worklist.getStats().searchTaskDependencyReadChecks).toBe(2)
  expect(worklist.getStats().searchTaskReusedLogicalNodes).toBe(13)
  costs.set("1,2", 3)
  expect(worklist.lookup(task, current)).toBeUndefined()
  expect(worklist.getStats().searchTaskDirtyCount).toBe(1)
  expect(worklist.getStats().searchTaskRetainedCostReadCount).toBe(0)
  worklist.complete(task, result, [{ a, b, cost: 0 }])
  expect(() => worklist.lookup(task, (): number => Number.NaN)).toThrow("invalid edge cost")
  const oversized = new ClearanceSearchTaskWorklist(2, 4, 2048)
  oversized.complete(task, result, null)
  expect(oversized.lookup(task, current)).toBeUndefined()
  expect(oversized.getStats().searchTaskOversizedResultCount).toBe(1)
})
