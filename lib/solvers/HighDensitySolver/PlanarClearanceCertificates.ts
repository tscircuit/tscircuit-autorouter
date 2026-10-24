type Point = { x: number; y: number }
type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
type BoundsIndex = {
  search: (minX: number, minY: number, maxX: number, maxY: number) => number[]
}

export type PlanarClearanceCertificate = Bounds & {
  sceneRevision: number
  z: number
  traceProximity: number
  viaProximity: number
  segmentClearance: number
}

export type PlanarCertificateDiagnostics = {
  lookups: number
  reusedCertificates: number
  constructionAttempts: number
  constructedCertificates: number
  constructionIndexQueries: number
  constructionBoundsChecks: number
  certifiedNeighborhoodQueries: number
  certifiedPointChecks: number
  certifiedSegmentChecks: number
}

type Scene = {
  sceneRevision: number
  z: number
  traceProximity: number
  viaProximity: number
  segmentClearance: number
  segments: readonly Bounds[]
  segmentIndex?: BoundsIndex
  vias: readonly Point[]
  viaIndex?: BoundsIndex
}

/**
 * A certificate excludes obstacle AABBs from an entire expanded rectangle.
 * This is deliberately weaker than nearest-segment distance, but needs no
 * extra square roots or projections. The final separating tests use the same
 * floating-point additions as native query bounds. Their monotonicity proves
 * that all contained point and complete segment queries exclude the obstacle.
 * The scene is owned by one immutable obstacle-index generation.
 */
export class PlanarClearanceCertificates {
  readonly scene: Scene
  diagnostics?: PlanarCertificateDiagnostics
  private certificates: PlanarClearanceCertificate[] = []
  private nextCertificate = 0
  private lastFailedCenter?: Point

  constructor(scene: Scene) {
    this.scene = scene
    // Eight recent rectangles bound storage independently of explored cells.
    // No full grid, global nearest-distance search, or geometry copying occurs.
    this.certificates = []
    this.nextCertificate = 0
    this.lastFailedCenter = undefined
  }

  findOrCreate(center: Point, cellStep: number): PlanarClearanceCertificate | undefined {
    const diagnostics = this.diagnostics
    if (diagnostics) diagnostics.lookups++
    for (let offset = 1; offset <= this.certificates.length; offset++) {
      const index = (this.nextCertificate - offset + 8) % 8
      const certificate = this.certificates[index]
      if (
        certificate &&
        center.x >= certificate.minX && center.x <= certificate.maxX &&
        center.y >= certificate.minY && center.y <= certificate.maxY
      ) {
        if (diagnostics) diagnostics.reusedCertificates++
        return certificate
      }
    }

    const radius = cellStep * 4
    if (
      !(radius > 0) || !Number.isFinite(radius) ||
      !Number.isFinite(center.x) || !Number.isFinite(center.y) ||
      !(this.scene.traceProximity >= 0) ||
      !(this.scene.viaProximity >= 0) ||
      !(this.scene.segmentClearance >= 0) ||
      !Number.isFinite(this.scene.traceProximity) ||
      !Number.isFinite(this.scene.viaProximity) ||
      !Number.isFinite(this.scene.segmentClearance)
    ) return undefined
    const previousFailure = this.lastFailedCenter
    if (
      previousFailure &&
      Math.abs(center.x - previousFailure.x) < cellStep * 2 &&
      Math.abs(center.y - previousFailure.y) < cellStep * 2
    ) return undefined

    if (diagnostics) diagnostics.constructionAttempts++
    const certificate: PlanarClearanceCertificate = {
      minX: center.x - radius, minY: center.y - radius,
      maxX: center.x + radius, maxY: center.y + radius,
      sceneRevision: this.scene.sceneRevision,
      z: this.scene.z,
      traceProximity: this.scene.traceProximity,
      viaProximity: this.scene.viaProximity,
      segmentClearance: this.scene.segmentClearance,
    }
    const segmentMargin = Math.max(
      this.scene.traceProximity, this.scene.segmentClearance,
    )
    const queryMargin = Math.max(segmentMargin, this.scene.viaProximity)
    if (
      !Number.isFinite(certificate.minX - queryMargin) ||
      !Number.isFinite(certificate.minY - queryMargin) ||
      !Number.isFinite(certificate.maxX + queryMargin) ||
      !Number.isFinite(certificate.maxY + queryMargin)
    ) return undefined

    if (this.scene.segmentIndex) {
      if (diagnostics) diagnostics.constructionIndexQueries++
      const ids = this.scene.segmentIndex.search(
        certificate.minX - segmentMargin, certificate.minY - segmentMargin,
        certificate.maxX + segmentMargin, certificate.maxY + segmentMargin,
      )
      for (const id of ids) {
        if (diagnostics) diagnostics.constructionBoundsChecks++
        if (!this.restrictBounds(certificate, center, this.scene.segments[id]!, segmentMargin)) {
          this.lastFailedCenter = { x: center.x, y: center.y }
          return undefined
        }
      }
    }
    if (this.scene.viaIndex) {
      if (diagnostics) diagnostics.constructionIndexQueries++
      const margin = this.scene.viaProximity
      // The rectangle may have shrunk, which only excludes additional points.
      const ids = this.scene.viaIndex.search(
        certificate.minX - margin, certificate.minY - margin,
        certificate.maxX + margin, certificate.maxY + margin,
      )
      for (const id of ids) {
        if (diagnostics) diagnostics.constructionBoundsChecks++
        const via = this.scene.vias[id]!
        if (!this.restrictBounds(certificate, center, {
          minX: via.x, maxX: via.x, minY: via.y, maxY: via.y,
        }, margin)) {
          this.lastFailedCenter = { x: center.x, y: center.y }
          return undefined
        }
      }
    }
    if (
      center.x < certificate.minX || center.x > certificate.maxX ||
      center.y < certificate.minY || center.y > certificate.maxY
    ) return undefined
    this.certificates[this.nextCertificate] = certificate
    this.nextCertificate = (this.nextCertificate + 1) % 8
    if (diagnostics) diagnostics.constructedCertificates++
    return certificate
  }

  private restrictBounds(box: Bounds, center: Point, obstacle: Bounds, margin: number): boolean {
    if (
      box.maxX + margin < obstacle.minX || box.minX - margin > obstacle.maxX ||
      box.maxY + margin < obstacle.minY || box.minY - margin > obstacle.maxY
    ) return true
    const gaps = [
      obstacle.minX - (center.x + margin),
      (center.x - margin) - obstacle.maxX,
      obstacle.minY - (center.y + margin),
      (center.y - margin) - obstacle.maxY,
    ]
    let axis = -1
    let largestGap = 0
    for (let index = 0; index < gaps.length; index++) {
      if (gaps[index]! > largestGap) {
        largestGap = gaps[index]!
        axis = index
      }
    }
    if (axis === -1) return false
    const padding = Number.EPSILON * 8 * Math.max(
      1, Math.abs(center.x), Math.abs(center.y),
      Math.abs(obstacle.minX), Math.abs(obstacle.minY),
      Math.abs(obstacle.maxX), Math.abs(obstacle.maxY), margin,
    )
    if (axis === 0) box.maxX = Math.min(box.maxX, obstacle.minX - margin - padding)
    if (axis === 1) box.minX = Math.max(box.minX, obstacle.maxX + margin + padding)
    if (axis === 2) box.maxY = Math.min(box.maxY, obstacle.minY - margin - padding)
    if (axis === 3) box.minY = Math.max(box.minY, obstacle.maxY + margin + padding)
    // Padding improves eligibility but is not relied upon for correctness:
    // an actual strict separating comparison must succeed after rounding.
    return (
      box.maxX + margin < obstacle.minX || box.minX - margin > obstacle.maxX ||
      box.maxY + margin < obstacle.minY || box.minY - margin > obstacle.maxY
    )
  }
}
