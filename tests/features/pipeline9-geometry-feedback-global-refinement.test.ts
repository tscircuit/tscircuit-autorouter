import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { createGeometryFeedbackPlanningFixture } from "../fixtures/pipeline9-geometry-feedback-fixture"

test("a sound physical boundary certificate replans the primary global assignment once before HD", (): void => {
  const { pipeline, feedback } = createGeometryFeedbackPlanningFixture()
  const primary = pipeline.portPointPathingSolver!
  const primaryPorts = primary.getOutput().nodesWithPortPoints.flatMap((node) => node.portPoints.map((port) => port.portPointId))
  expect(primary.solved).toBeTrue()
  expect(primaryPorts).toContain("port_1::0")
  expect(pipeline.geometryFeedbackStats.activated).toBeFalse()
  feedback.solve()
  expect(feedback.failed).toBeFalse()
  expect(feedback.solved).toBeTrue()
  const ports = feedback.pathingSolver.getOutput().nodesWithPortPoints.flatMap((node) => node.portPoints.map((port) => port.portPointId))
  expect(ports).not.toContain("port_1::0")
  expect(ports).toContain("upper_port_0::0")
  expect(ports).toContain("upper_port_1::0")
  const stats = pipeline.geometryFeedbackStats
  expect(stats.activated).toBeTrue()
  expect(stats.audits).toBe(2)
  expect(stats.certificates).toBe(1)
  expect(stats.cuts).toBe(1)
  expect(stats.replans).toBe(1)
  expect(stats.constructorCalls).toBe(2)
  expect(stats.primaryIterations + stats.replanIterationBudget).toBe(stats.primaryIterationBudget)
  expect(stats.replanIterations).toBeLessThanOrEqual(stats.replanIterationBudget)
  expect(pipeline.highDensityRouteSolver).toBeUndefined()
  // An explicit physically legal detailed witness goes around the round hole
  // above y=1.1; the new graph assignment supports this path without a via.
  const witness = [{ x: -1.5, y: 0 }, { x: -1, y: 1 }, { x: -1, y: 2 },
    { x: 1, y: 2 }, { x: 1, y: 1 }, { x: 1.5, y: 0 }]
  const hole = pipeline.originalSrj.obstacles[0]!
  const requiredRadius = hole.width / 2 + pipeline.originalSrj.minTraceWidth / 2 + 0.15
  for (let index = 1; index < witness.length; index++) {
    expect(pointToSegmentDistance(hole.center, witness[index - 1]!, witness[index]!)).toBeGreaterThan(requiredRadius)
  }
})
