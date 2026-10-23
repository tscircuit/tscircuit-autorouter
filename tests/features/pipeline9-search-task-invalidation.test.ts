import { expect, test } from "bun:test"
import { ClearanceSearchTaskWorklist, serializeRepairTaskDependencies,
  type ClearanceSearchTask } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/ClearanceSearchTaskWorklist"

test("completed repair tasks require exact geometry/rules/effort versions, protect results and bound retained state", (): void => {
  const worklist = new ClearanceSearchTaskWorklist(2, 8, 2048)
  const task: ClearanceSearchTask = { identity: "a", context: "board/rules/layers/ownership",
    dependencies: "anchors/copper/weights/frozen", maxNodes: 10, layerCount: 2 }
  const result = { path: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
    stats: { nodesPopped: 7, completionReason: "found" as const } }
  worklist.complete(task, result)
  result.path[0]!.x = 9
  const first = worklist.lookup(task)!
  expect(first.path![0]!.x).toBe(0)
  first.path![0]!.x = 8
  expect(worklist.lookup(task)!.path![0]!.x).toBe(0)
  expect(worklist.lookup({ ...task, dependencies: "changed-nearby-copper" })).toBeUndefined()
  expect(worklist.getStats().searchTaskDirtyCount).toBe(1)
  worklist.complete(task, { path: null, stats: { nodesPopped: 10, completionReason: "node-limit" } })
  expect(worklist.lookup(task)!.path).toBeNull()
  expect(worklist.lookup({ ...task, maxNodes: 11 })).toBeUndefined()
  worklist.complete(task, { path: null, stats: { nodesPopped: 0, completionReason: "no-path" } })
  expect(worklist.lookup({ ...task, context: "different-layer-policy" })).toBeUndefined()
  expect(() => worklist.complete(task, { path: [], stats: { nodesPopped: 11, completionReason: "found" } })).toThrow("completed bounded searches")
  for (const identity of ["a", "b", "c"]) {
    worklist.complete({ ...task, identity }, { path: null, stats: { nodesPopped: 1, completionReason: "no-path" } })
  }
  expect(worklist.getStats().searchTaskRetainedCount).toBe(2)
  expect(worklist.getStats().searchTaskRetainedContextCount).toBe(1)
  expect(worklist.getStats().searchTaskEvictionCount).toBeGreaterThan(0)
  expect(worklist.getStats().searchTaskRetainedCharacters).toBeLessThanOrEqual(2048)
  expect(worklist.getStats().searchTaskRetainedPoints).toBeLessThanOrEqual(8)
  expect(() => serializeRepairTaskDependencies({ x: Number.NaN })).toThrow("non-finite")
  expect(() => serializeRepairTaskDependencies({ edgeCost: (): number => 0 })).toThrow("serializable")
})
