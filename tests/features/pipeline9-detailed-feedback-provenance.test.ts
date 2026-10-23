import { expect, test } from "bun:test"
import {
  Pipeline9DetailedRoutingFeedback,
  type Pipeline9DetailedRoutingConflict,
} from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9DetailedRoutingFeedback"

test("detailed feedback retains exact ownership and geometry provenance while costs remain finite and instance-local", (): void => {
  const feedback = new Pipeline9DetailedRoutingFeedback()
  const conflict: Pipeline9DetailedRoutingConflict = {
    kind: "search-exhausted",
    geometryContext: JSON.stringify({ layerCount: 2, traceWidth: 0.1, obstacles: [], netMap: { net1: ["a"] } }),
    node: {
      capacityMeshNodeId: "node",
      center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
      portPoints: [
        { connectionName: "a", rootConnectionName: "net1", x: -1, y: 0, z: 0 },
        { connectionName: "a", rootConnectionName: "net1", x: 1, y: 0, z: 0 },
      ],
    },
    solverIterations: 10, error: "Search exhausted",
  }
  expect(feedback.learn([conflict])).toBe(1)
  expect(feedback.learn([structuredClone(conflict)])).toBe(0)
  feedback.recordAssignments([conflict.node])
  feedback.recordAssignments([{ ...conflict.node, portPoints: [...conflict.node.portPoints].reverse() }])
  expect(feedback.stats.detailedFeedbackChangedNodeAssignmentCount).toBe(0)
  const changed = structuredClone(conflict)
  changed.node.portPoints[0]!.z = 1
  expect(feedback.learn([changed])).toBe(1)
  feedback.recordAssignments([changed.node])
  expect(feedback.stats.detailedFeedbackChangedNodeAssignmentCount).toBe(1)
  const changedRule = structuredClone(conflict)
  changedRule.geometryContext = JSON.stringify({ layerCount: 4, traceWidth: 0.2 })
  expect(feedback.learn([changedRule])).toBe(1)
  conflict.node.portPoints[0]!.connectionName = "mutated"
  expect(feedback.conflicts[0]!.node.portPoints[0]!.connectionName).toBe("a")
  expect(feedback.getPenalties().map((penalty) => penalty.connectionName)).toEqual(["a"])
  expect(Number.isFinite(feedback.getPenalties()[0]!.penalty)).toBe(true)
  expect(feedback.stats.detailedFeedbackHardExclusionCount).toBe(0)
  expect(new Pipeline9DetailedRoutingFeedback().getPenalties()).toEqual([])
})
