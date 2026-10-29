import { expect, test } from "bun:test"
import { auditGeometryFixture, createGeometryFeedbackFixture } from "../fixtures/pipeline9-geometry-feedback-fixture"

test("assignment-dependent two-layer bounds and nominal alternating crossings stay unknown", (): void => {
  const fixture = createGeometryFeedbackFixture()
  fixture.srj.layerCount = 2
  fixture.srj.obstacles = [{
    type: "rect", center: { x: 0, y: 0 }, width: 3, height: 3,
    connectedTo: [], layers: ["top", "bottom"],
  }]
  const uncertain = auditGeometryFixture(fixture)
  expect(uncertain.certificates).toHaveLength(0)
  expect(uncertain.outcomes.every((outcome) => outcome.kind === "unknown")).toBeTrue()
  expect(fixture.stats.unsupported).toBe(2)
  fixture.srj.layerCount = 4
  fixture.srj.obstacles = []
  // The nominal node has a crossing on one layer. Growth or another physical
  // board layer may resolve it; it is not a continuous-domain impossibility.
  fixture.assignedNodes[0]!.portPoints = [
    { x: -2, y: 0, z: 0, connectionName: "horizontal" },
    { x: 0, y: 0, z: 0, connectionName: "horizontal" },
    { x: -1, y: -1, z: 0, connectionName: "vertical" },
    { x: -1, y: 1, z: 0, connectionName: "vertical" },
  ]
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
})
