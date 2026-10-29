import { expect, test } from "bun:test"
import { auditGeometryFixture, createGeometryFeedbackFixture } from "../fixtures/pipeline9-geometry-feedback-fixture"

test("source-port identity aliases and inconsistent shared XYZ fail explicitly before any hard cut", (): void => {
  const fixture = createGeometryFeedbackFixture()
  const port = fixture.segments[0]!.portPoints[0]!
  fixture.segments.push({
    ...fixture.segments[0]!, nodeIds: ["node_0", "other"],
    portPoints: [{ ...port, nodeIds: ["node_0", "other"] }],
  })
  expect(() => auditGeometryFixture(fixture)).toThrow("globally unique source port-layer identities")
  expect(fixture.stats.cuts).toBe(0)
  fixture.segments.pop()
  fixture.assignedNodes[1]!.portPoints[0]!.z = 1
  expect(() => auditGeometryFixture(fixture)).toThrow("shared port replicas to agree on physical XYZ")
  fixture.assignedNodes[1]!.portPoints[0]!.z = 0
  fixture.assignedNodes[1]!.portPoints[0]!.x = 0.2
  expect(() => auditGeometryFixture(fixture)).toThrow("shared port replicas to agree on physical XYZ")
})
