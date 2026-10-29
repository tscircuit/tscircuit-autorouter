import { expect, test } from "bun:test"
import { optimizeJointPortCoordinates } from "lib/solvers/UniformPortDistributionSolver/optimizeJointPortCoordinates"
import { createJointPortTestInput } from "./joint-port-test-input"

test("coupled moves preserve physical pitch and original same-layer port order", (): void => {
  const input = createJointPortTestInput([-0.5, 0.5], [1, 1.1])
  input.srj.minTraceWidth = 0.2
  input.srj.defaultObstacleMargin = 0.3
  const result = optimizeJointPortCoordinates(input)
  expect(result.stats.eligiblePortCount).toBe(2)
  expect(result.stats.movedPortCount).toBe(2)
  expect(result.stats.objectiveAfter).toBeLessThan(result.stats.objectiveBefore)
  for (const node of result.nodes) {
    const a = node.portPoints.find((point) => point.portPointId === "shared-0")!
    const b = node.portPoints.find((point) => point.portPointId === "shared-1")!
    expect(b.y - a.y).toBeGreaterThanOrEqual(0.5 - 1e-8)
    expect(a.y).toBeGreaterThanOrEqual(-1.5)
    expect(b.y).toBeLessThanOrEqual(1.5)
    expect(node.portPoints.map((point) => [point.portPointId, point.z, point.connectionName]))
      .toEqual(input.nodes.find((original) => original.capacityMeshNodeId === node.capacityMeshNodeId)!
        .portPoints.map((point) => [point.portPointId, point.z, point.connectionName]))
  }
})
