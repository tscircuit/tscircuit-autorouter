import { expect, test } from "bun:test"
import { auditGeometryFixture, createGeometryFeedbackFixture } from "../fixtures/pipeline9-geometry-feedback-fixture"

test("legacy ovals and unknown shapes cannot use empty bounding-box corners as physical blockers", (): void => {
  const fixture = createGeometryFeedbackFixture()
  // The whole crossing-domain rectangle is inside this nominal box, but its
  // bottom-left point is outside the actual centered ellipse/obround body.
  fixture.srj.obstacles = [{
    type: "oval" as "rect", center: { x: 1, y: 1 }, width: 2.2, height: 4.2,
    connectedTo: [], layers: ["top", "inner1"], isNonPlatedHole: true,
  }]
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
  const ellipseValue = ((0 - 1) / 1.1) ** 2 + ((-1 - 1) / 2.1) ** 2
  expect(ellipseValue).toBeGreaterThan(1)
  fixture.srj.obstacles[0]!.type = "rect"
  fixture.srj.obstacles[0]!.shape = "polygon" as "circle"
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
  expect(auditGeometryFixture(fixture).outcomes.every((outcome) => outcome.kind === "unknown")).toBeTrue()
  fixture.srj.obstacles[0]!.shape = undefined
  fixture.srj.obstacles[0]!.center = { x: 0, y: 0 }
  fixture.srj.obstacles[0]!.width = 3
  fixture.srj.obstacles[0]!.height = 3
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(2)
  fixture.srj.obstacles[0]!.type = "polygon" as "rect"
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
})
