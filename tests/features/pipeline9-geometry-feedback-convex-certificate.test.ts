import { expect, test } from "bun:test"
import { auditGeometryFixture, createGeometryFeedbackFixture } from "../fixtures/pipeline9-geometry-feedback-fixture"

test("one strict convex physical blocker certifies the entire crossing domain on its physical layers", (): void => {
  const fixture = createGeometryFeedbackFixture()
  fixture.srj.obstacles = [{
    type: "rect", center: { x: 0, y: 0 }, width: 0.2, height: 3,
    connectedTo: [], layers: ["inner1"],
  }]
  const result = auditGeometryFixture(fixture)
  expect(result.certificates).toHaveLength(0)
  expect(result.usedCertificateCount).toBe(0)
  expect(fixture.stats.activated).toBeTrue()
  expect(fixture.stats.feasible).toBe(1)
  fixture.srj.obstacles[0]!.isNonPlatedHole = true
  fixture.srj.obstacles[0]!.shape = "circle"
  fixture.srj.obstacles[0]!.width = 2.2
  fixture.srj.obstacles[0]!.height = 2.2
  for (const port of fixture.segments[0]!.portPoints) port.availableZ = [1]
  const singleLayer = auditGeometryFixture(fixture)
  expect(singleLayer.certificates).toHaveLength(1)
  expect(singleLayer.certificates[0]!.z).toBe(1)
  expect(singleLayer.certificates[0]!.sourcePortLayerKeys).toEqual(["port_0::1", "port_1::1", "port_2::1"])
  for (const port of fixture.segments[0]!.portPoints) port.availableZ = [0, 1]
  const hole = auditGeometryFixture(fixture)
  expect(hole.certificates).toHaveLength(2)
  expect(hole.usedCertificateCount).toBe(1)
  expect(hole.certificates[0]!.movementBounds).toEqual({ minX: -0.05, maxX: 0.05, minY: -1, maxY: 1 })
  fixture.srj.obstacles[0]!.ccwRotationDegrees = 90
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(2)
  fixture.srj.obstacles[0]!.width = 0.2
  expect(auditGeometryFixture(fixture).certificates).toHaveLength(0)
})
