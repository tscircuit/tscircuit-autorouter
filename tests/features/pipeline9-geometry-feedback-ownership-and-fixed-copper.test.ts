import { expect, test } from "bun:test"
import { auditGeometryFixture, createGeometryFeedbackFixture } from "../fixtures/pipeline9-geometry-feedback-fixture"

test("owned plated copper, assignable pads and fixed port assignments never become all-net cuts", (): void => {
  const fixture = createGeometryFeedbackFixture()
  const obstacle = {
    type: "rect" as const, center: { x: 0, y: 0 }, width: 3, height: 3,
    connectedTo: ["signal"], layers: ["top", "inner1", "inner2", "bottom"],
  }
  fixture.srj.obstacles = [obstacle]
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
  obstacle.connectedTo = []
  fixture.srj.obstacles[0]!.netIsAssignable = true
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
  fixture.srj.obstacles[0]!.netIsAssignable = false
  fixture.srj.obstacles[0]!.isCopperPour = true
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
  fixture.srj.obstacles[0]!.isCopperPour = false
  // Empty declared aliases still do not establish a physically unowned pad.
  fixture.srj.connections[0]!.pointsToConnect[0] = {
    x: 0, y: 0, layer: "top", pcb_port_id: "owned_port",
  }
  fixture.srj.obstacles[0]!.circuitJsonMetadata = { pcb_port_id: "owned_port", pcb_smtpad_id: "owned_pad" }
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
  delete fixture.srj.obstacles[0]!.circuitJsonMetadata
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
  fixture.srj.obstacles[0]!.isNonPlatedHole = true
  fixture.segments[0]!.portPoints[0]!._preloadedFixedNetIds = ["signal"]
  const fixed = auditGeometryFixture(fixture)
  expect(fixed.certificates).toHaveLength(0)
  expect(fixed.outcomes.every((outcome) => outcome.kind === "unknown")).toBeTrue()
  delete fixture.segments[0]!.portPoints[0]!._preloadedFixedNetIds
  fixture.srj.allowJumpers = true
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
})
