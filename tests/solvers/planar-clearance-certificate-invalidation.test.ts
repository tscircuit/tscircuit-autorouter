import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { createPlanarCertificateFixture } from "./planarCertificateFixture"

test("index rebuilds and changed physical thresholds cannot reuse an earlier free rectangle", (): void => {
  const native = createPlanarCertificateFixture(false)
  const candidate = createPlanarCertificateFixture(true)
  const point: Node = { x: -1.5, y: 1.2, z: 0, g: 0, h: 0, f: 0, parent: null }
  expect(candidate.getNeighbors(point)).toEqual(native.getNeighbors(point))
  for (const solver of [native, candidate]) {
    solver.obstacleRoutes.push({
      connectionName: "new-blocker", traceThickness: 0.1, viaDiameter: 0.3,
      route: [{ x: -1.5, y: 1, z: 0 }, { x: -1.5, y: 1.6, z: 0 }], vias: [],
    })
    solver.buildObstacleIndexes()
    solver.exploredNodes.clear()
  }
  expect(candidate.getNeighbors(point)).toEqual(native.getNeighbors(point))
  expect(candidate.getNeighbors(point)).toHaveLength(0)
  for (const solver of [native, candidate]) {
    solver.obstacleMargin = 0.35
    solver.traceThickness = 0.2
    solver.NEARBY_SEGMENT_CLEARANCE = 0.3
    solver.exploredNodes.clear()
  }
  const moved = { ...point, x: -0.7 }
  expect(candidate.getNeighbors(moved)).toEqual(native.getNeighbors(moved))
})
