import { expect, test } from "bun:test"
import { auditGeometryFixture, createGeometryFeedbackFixture } from "../fixtures/pipeline9-geometry-feedback-fixture"

test("only an entire movement domain outside an original board half-plane yields a board cut", (): void => {
  const fixture = createGeometryFeedbackFixture()
  fixture.srj.bounds.minX = 0.2
  fixture.srj.outline = [{ x: 0.2, y: -4 }, { x: 4, y: -4 }, { x: 4, y: 4 }, { x: 0.2, y: 4 }]
  const outside = auditGeometryFixture(fixture)
  expect(outside.certificates).toHaveLength(2)
  expect(outside.certificates.every((certificate) => certificate.reason === "outside-original-board")).toBeTrue()
  fixture.srj.bounds.minX = 0.04
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
  fixture.srj.bounds.minX = 0.2
  fixture.srj.connections[0]!.isOffBoard = true
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
  fixture.srj.connections[0]!.isOffBoard = false
  fixture.srj.outline![0]!.x = -2
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
  fixture.srj.outline![0]!.x = 0.2
  fixture.nodes[0]!._offBoardConnectionId = "offboard"
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
})
