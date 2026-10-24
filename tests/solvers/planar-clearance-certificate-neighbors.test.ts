import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { createPlanarCertificateFixture } from "./planarCertificateFixture"

test("certificates preserve ordered native neighbors, all costs and via parent-history decisions", (): void => {
  const native = createPlanarCertificateFixture(false)
  const candidate = createPlanarCertificateFixture(true)
  let certifiedQueries = 0
  candidate.planarCertificateDiagnostics = {
    lookups: 0, reusedCertificates: 0, constructionAttempts: 0,
    constructedCertificates: 0, constructionIndexQueries: 0,
    constructionBoundsChecks: 0, certifiedNeighborhoodQueries: 0,
    certifiedPointChecks: 0, certifiedSegmentChecks: 0,
  }
  for (let z = 0; z < 4; z++) {
    for (let x = -2.5; x < 2.5; x += 0.13) {
      for (let y = -1.5; y < 1.5; y += 0.19) {
        const previous: Node = { x: x - 0.02, y, z: (z + 1) % 4, g: 1, h: 2, f: 3, parent: null }
        const node: Node = { x, y, z, g: 2, h: 3, f: 4, parent: previous }
        // Actual expansions arrive from a native point-clearance check. These
        // independently sampled centers need the same exact cache witness to
        // exercise new certificate construction rather than only reuse.
        expect(candidate.isNodeTooCloseToObstacle(node, candidate.obstacleMargin)).toBe(
          native.isNodeTooCloseToObstacle(node, native.obstacleMargin),
        )
        const left = native.getNeighbors(node)
        const right = candidate.getNeighbors(node)
        expect(right).toEqual(left)
        expect(candidate.exploredNodes).toEqual(native.exploredNodes)
        certifiedQueries++
      }
    }
  }
  expect(certifiedQueries).toBeGreaterThan(2000)
  expect(candidate.planarCertificateDiagnostics.certifiedPointChecks).toBeGreaterThan(100)
  expect(candidate.planarCertificateDiagnostics.certifiedSegmentChecks).toBeGreaterThan(100)
  expect(candidate.planarCertificateDiagnostics.certifiedNeighborhoodQueries).toBeGreaterThan(10)
})
