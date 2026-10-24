import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import type { PlanarCertificateDiagnostics } from "lib/solvers/HighDensitySolver/PlanarClearanceCertificates"
import { createPlanarCertificateFixture } from "./planarCertificateFixture"

function createDiagnostics(): PlanarCertificateDiagnostics {
  return {
    lookups: 0, reusedCertificates: 0, constructionAttempts: 0,
    constructedCertificates: 0, constructionIndexQueries: 0,
    constructionBoundsChecks: 0, certifiedNeighborhoodQueries: 0,
    certifiedPointChecks: 0, certifiedSegmentChecks: 0,
  }
}

test("construction requires an exact current native point witness while existing rectangles remain reusable", (): void => {
  const point: Node = { x: -2, y: 1.2, z: 0, g: 0, h: 0, f: 0, parent: null }
  const solver = createPlanarCertificateFixture(true)
  const diagnostics = solver.planarCertificateDiagnostics = createDiagnostics()
  solver.getPlanarNeighborObstacleQuery(point)
  expect(diagnostics.constructionAttempts).toBe(0)
  expect(solver.isNodeTooCloseToObstacle(point, solver.obstacleMargin)).toBe(false)
  solver.getPlanarNeighborObstacleQuery(point)
  expect(diagnostics.constructedCertificates).toBe(1)
  solver.freePlanarObstaclePoints.clear()
  solver.getPlanarNeighborObstacleQuery({ ...point, x: point.x + solver.cellStep / 2 })
  expect(diagnostics.reusedCertificates).toBe(1)
  expect(diagnostics.constructionAttempts).toBe(1)

  for (const invalidation of ["x", "y", "z", "trace", "via", "rebuild"] as const) {
    const candidate = createPlanarCertificateFixture(true)
    const counts = candidate.planarCertificateDiagnostics = createDiagnostics()
    expect(candidate.isNodeTooCloseToObstacle(point, candidate.obstacleMargin)).toBe(false)
    const key = candidate.getNodeKey(point)
    const witness = candidate.freePlanarObstaclePoints.get(key)!
    if (invalidation === "x") witness.x += 1e-12
    if (invalidation === "y") witness.y += 1e-12
    if (invalidation === "z") witness.z++
    if (invalidation === "trace") candidate.traceThickness += 0.01
    if (invalidation === "via") candidate.viaDiameter += 0.01
    if (invalidation === "rebuild") candidate.buildObstacleIndexes()
    candidate.getPlanarNeighborObstacleQuery(point)
    expect(counts.constructionAttempts).toBe(0)
    expect(counts.constructedCertificates).toBe(0)
  }
})
