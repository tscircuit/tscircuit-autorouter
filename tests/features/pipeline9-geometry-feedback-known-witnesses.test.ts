import { expect, test } from "bun:test"
import { auditGeometryFixture, createGeometryFeedbackFixture } from "../fixtures/pipeline9-geometry-feedback-fixture"

test("node overhangs and native duplicate displacement preserve legal witnesses against nominal-box cuts", (): void => {
  const fixture = createGeometryFeedbackFixture()
  fixture.srj.obstacles = [{
    type: "rect", shape: "circle", center: { x: 0, y: 0 }, width: 2.2, height: 2.2,
    connectedTo: [], layers: ["top", "inner1"], isNonPlatedHole: true,
  }]
  // A retained source port can leave the nominal shared edge. Its actual
  // position remains legal, so certifying only x=0 would be unsound.
  fixture.segments[0]!.portPoints[0]!.x = 1.5
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
  fixture.segments[0]!.portPoints[0]!.x = 0
  for (const node of fixture.nodes) node.height = 0.01
  for (const port of fixture.segments[0]!.portPoints) port.y = 0
  // A native duplicate may escape a thinner blocker even when every original
  // and redistributed port is covered. The 0.05mm displacement bound matters.
  fixture.srj.obstacles[0]!.width = 0.08
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
  expect(0.049).toBeGreaterThan(fixture.srj.obstacles[0]!.width / 2)
  for (const node of fixture.nodes) node.height = 2
  for (const [index, port] of fixture.segments[0]!.portPoints.entries()) port.y = (index - 1) * 0.5
  fixture.srj.obstacles[0]!.width = 3
  fixture.srj.obstacles[0]!.shape = "circle"
  fixture.srj.obstacles[0]!.height = 0.2
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
  fixture.srj.obstacles = []
  const clean = auditGeometryFixture(fixture)
  expect(clean.certificates).toHaveLength(0)
  expect(clean.outcomes.every((outcome) => outcome.kind === "feasible-crossing-witness")).toBeTrue()
})
