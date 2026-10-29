import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { optimizeJointPortCoordinates } from "lib/solvers/UniformPortDistributionSolver/optimizeJointPortCoordinates"
import type { Obstacle } from "lib/types/srj-types"
import { createJointPortTestInput } from "./joint-port-test-input"

test("optimization clips to the visible legal interval instead of crossing intervening original copper", (): void => {
  const input = createJointPortTestInput()
  input.srj.obstacles = [{ type: "rect", shape: "circle", center: { x: 0, y: 1 },
    width: 0.5, height: 0.5, connectedTo: [], layers: ["top"] },
  { type: "oval", center: { x: 8, y: 8 }, width: 0.5, height: 1,
    ccwRotationDegrees: 30, connectedTo: [], layers: ["top"] } as unknown as Obstacle]
  const result = optimizeJointPortCoordinates(input)
  expect(result.stats.unsupportedGeometry).toBeFalse()
  expect(result.stats.eligiblePortCount).toBe(1)
  expect(result.stats.movedPortCount).toBe(1)
  expect(result.stats.objectiveAfter).toBeLessThan(result.stats.objectiveBefore)
  for (const node of result.nodes) {
    const port = node.portPoints.find((point) => point.portPointId === "shared-0")!
    expect(port.y).toBeGreaterThan(0.1)
    expect(port.y).toBeLessThan(0.55)
    const [start, end] = node.portPointsInPairs![0]
    expect(pointToSegmentDistance({ x: 0, y: 1 }, start, end)).toBeGreaterThanOrEqual(0.45)
  }
})
