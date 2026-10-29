import { expect, test } from "bun:test"
import { auditGeometryFixture, createGeometryFeedbackFixture } from "../fixtures/pipeline9-geometry-feedback-fixture"

test("a tolerant shared-edge domain uses the same canonical owner order as redistribution", (): void => {
  const fixture = createGeometryFeedbackFixture()
  fixture.nodes[0]!.capacityMeshNodeId = "z"
  fixture.nodes[1]!.capacityMeshNodeId = "a"
  fixture.nodes[1]!.center.x -= 5e-7
  for (const port of fixture.segments[0]!.portPoints) {
    port.nodeIds = ["z", "a"]
    port.x = 0.2
  }
  fixture.srj.obstacles = [{
    type: "rect", center: { x: 0.1499999, y: 0 }, width: 0.3000002, height: 3,
    connectedTo: [], layers: ["top", "inner1"], isNonPlatedHole: true,
  }]
  // Canonical owner "a" contributes x=-5e-7. It lies outside this pad whose
  // left edge is -2e-7, even though reverse-order helper output x=0 is inside.
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
})
