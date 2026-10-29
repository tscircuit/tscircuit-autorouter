import { expect, test } from "bun:test"
import { auditGeometryFixture, createGeometryFeedbackFixture } from "../fixtures/pipeline9-geometry-feedback-fixture"

test("ambiguous legacy square-pad bounding corners never become physical infeasibility proofs", (): void => {
  const fixture = createGeometryFeedbackFixture()
  fixture.nodes[0]!.center.y = 0.05
  fixture.nodes[1]!.center.y = 0.05
  fixture.nodes[0]!.height = 0.1
  fixture.nodes[1]!.height = 0.1
  for (const port of fixture.segments[0]!.portPoints) port.y = 0.05
  fixture.srj.obstacles = [{
    type: "rect", center: { x: 1, y: 1 }, width: 2.2, height: 2.2,
    connectedTo: [], layers: ["top", "inner1"],
    circuitJsonMetadata: { pcb_plated_hole_id: "legacy_round" },
  }]
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
  // The center is outside the real round pad by >0.2mm even though the full
  // source/duplicate/shared-edge box fits inside its nominal rectangle.
  expect(Math.hypot(1, 0.95) - 1.1).toBeGreaterThan(0.2)
  fixture.srj.obstacles[0]!.layers = ["top"]
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
  delete fixture.srj.obstacles[0]!.circuitJsonMetadata
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
  fixture.srj.obstacles[0]!.isNonPlatedHole = true
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
  fixture.srj.obstacles[0]!.center = { x: 0, y: 0 }
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(2)
})
