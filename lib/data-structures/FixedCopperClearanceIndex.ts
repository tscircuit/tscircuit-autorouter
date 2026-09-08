import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import objectHash from "object-hash"
import { RbushIndex } from "./RbushIndex"

/** Prepared physical copper, not capacity bounds or unclaimed assignable vias. */
export type FixedCopperRectangle = {
  readonly kind: "fixed-rectangle"
  readonly center: Readonly<{ x: number; y: number }>
  readonly width: number
  readonly height: number
  readonly ccwRotationDegrees?: number
  readonly zLayers: readonly number[]
  readonly ownerNetIds: ReadonlySet<string>
}

export type PhysicalCopperPoint = Readonly<{
  x: number
  y: number
  z: number
}>

export type PhysicalCopperPointQuery = {
  readonly point: PhysicalCopperPoint
  readonly canonicalNetId: string
  /** Actual trace width, or diameter of the copper centered on this point. */
  readonly copperDiameter: number
}

export type PhysicalCopperSegmentQuery = {
  readonly start: PhysicalCopperPoint
  readonly end: PhysicalCopperPoint
  readonly canonicalNetId: string
  /** Actual width of the constant-width, same-layer segment. */
  readonly copperDiameter: number
}

type PreparedRectangle = {
  center: { x: number; y: number }
  cos: number
  sin: number
  localBox: {
    center: { x: number; y: number }
    width: number
    height: number
  }
  ownerNetIds: ReadonlySet<string>
}

/**
 * Tests actual copper coordinates against immutable, owned rectangle geometry.
 * The caller must resolve net ownership and assignable-via claims beforehand.
 * No coordinate proxy, clearance default, or movement permission is inferred.
 */
export class FixedCopperClearanceIndex {
  /** Exact prepared geometry and rules, independent of tree or object identity. */
  readonly cacheFingerprint: string
  private readonly indexesByLayer = new Map<
    number,
    RbushIndex<PreparedRectangle>
  >()
  private readonly layerCount: number
  private readonly minClearance: number

  constructor(params: {
    readonly rectangles: readonly FixedCopperRectangle[]
    readonly layerCount: number
    readonly minClearance: number
  }) {
    if (!Number.isSafeInteger(params.layerCount) || params.layerCount <= 0) {
      throw new Error(
        "FixedCopperClearanceIndex requires a positive layer count",
      )
    }
    if (!Number.isFinite(params.minClearance) || params.minClearance < 0) {
      throw new Error(
        "FixedCopperClearanceIndex requires finite nonnegative clearance",
      )
    }
    this.layerCount = params.layerCount
    this.minClearance = params.minClearance
    const rectangleFingerprints: string[] = []

    for (const [rectangleIndex, rectangle] of params.rectangles.entries()) {
      const rotationDegrees =
        rectangle.ccwRotationDegrees === undefined
          ? 0
          : rectangle.ccwRotationDegrees
      if (
        rectangle.kind !== "fixed-rectangle" ||
        !Number.isFinite(rectangle.center.x) ||
        !Number.isFinite(rectangle.center.y) ||
        !Number.isFinite(rectangle.width) ||
        !Number.isFinite(rectangle.height) ||
        rectangle.width <= 0 ||
        rectangle.height <= 0 ||
        !Number.isFinite(rotationDegrees) ||
        rectangle.zLayers.length === 0
      ) {
        throw new Error(
          `FixedCopperClearanceIndex has invalid fixed rectangle ${rectangleIndex}`,
        )
      }
      const ownerNetIds = new Set(rectangle.ownerNetIds)
      for (const ownerNetId of ownerNetIds) {
        if (typeof ownerNetId !== "string" || ownerNetId.length === 0) {
          throw new Error(
            `FixedCopperClearanceIndex has an invalid owner for rectangle ${rectangleIndex}`,
          )
        }
      }
      const localHalfWidth = rectangle.width / 2
      const localHalfHeight = rectangle.height / 2
      if (localHalfWidth <= 0 || localHalfHeight <= 0) {
        throw new Error(
          `FixedCopperClearanceIndex cannot represent half-size of rectangle ${rectangleIndex}`,
        )
      }
      const angle = ((rotationDegrees % 360) * Math.PI) / 180
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const halfWidth =
        Math.abs(cos) * localHalfWidth + Math.abs(sin) * localHalfHeight
      const halfHeight =
        Math.abs(sin) * localHalfWidth + Math.abs(cos) * localHalfHeight
      const minX = rectangle.center.x - halfWidth
      const minY = rectangle.center.y - halfHeight
      const maxX = rectangle.center.x + halfWidth
      const maxY = rectangle.center.y + halfHeight
      this.assertFiniteBounds(minX, minY, maxX, maxY)
      const prepared: PreparedRectangle = {
        center: { ...rectangle.center },
        cos,
        sin,
        localBox: {
          center: { x: 0, y: 0 },
          width: rectangle.width,
          height: rectangle.height,
        },
        ownerNetIds,
      }
      const zLayers = [...new Set(rectangle.zLayers)].sort((a, b) => a - b)
      for (const z of zLayers) {
        this.assertLayer(z)
        let index = this.indexesByLayer.get(z)
        if (!index) {
          index = new RbushIndex<PreparedRectangle>()
          this.indexesByLayer.set(z, index)
        }
        index.insert(prepared, minX, minY, maxX, maxY)
      }
      rectangleFingerprints.push(
        JSON.stringify({
          kind: rectangle.kind,
          center: { x: prepared.center.x, y: prepared.center.y },
          width: rectangle.width,
          height: rectangle.height,
          ccwRotationDegrees: rotationDegrees % 360,
          zLayers,
          ownerNetIds: [...ownerNetIds].sort(),
        }),
      )
    }
    this.cacheFingerprint = objectHash({
      schemaVersion: 1,
      layerCount: this.layerCount,
      minClearance: this.minClearance,
      rectangles: rectangleFingerprints.sort(),
    })
  }

  isPointClear(query: PhysicalCopperPointQuery): boolean {
    this.assertPoint(query.point)
    this.assertCanonicalNetId(query.canonicalNetId)
    const margin = this.getRequiredCenterDistance(query.copperDiameter)
    const rectangles = this.getCandidates(query.point, query.point, margin)
    for (const rectangle of rectangles) {
      if (rectangle.ownerNetIds.has(query.canonicalNetId)) continue
      if (this.getPointDistance(query.point, rectangle) < margin) return false
    }
    return true
  }

  /** Null is unrestricted; an empty set means every net is blocked here. */
  getAllowedNetIdsAtPoint(query: {
    readonly point: PhysicalCopperPoint
    readonly copperDiameter: number
  }): ReadonlySet<string> | null {
    this.assertPoint(query.point)
    const margin = this.getRequiredCenterDistance(query.copperDiameter)
    const rectangles = this.getCandidates(query.point, query.point, margin)
    let allowedNetIds: Set<string> | null = null
    for (const rectangle of rectangles) {
      if (this.getPointDistance(query.point, rectangle) >= margin) continue
      if (allowedNetIds === null) {
        allowedNetIds = new Set(rectangle.ownerNetIds)
      } else {
        for (const netId of allowedNetIds) {
          if (!rectangle.ownerNetIds.has(netId)) allowedNetIds.delete(netId)
        }
      }
      if (allowedNetIds.size === 0) return allowedNetIds
    }
    return allowedNetIds
  }

  isSegmentClear(query: PhysicalCopperSegmentQuery): boolean {
    this.assertPoint(query.start)
    this.assertPoint(query.end)
    if (query.start.z !== query.end.z) {
      throw new Error(
        "FixedCopperClearanceIndex requires a same-layer segment",
      )
    }
    this.assertCanonicalNetId(query.canonicalNetId)
    const margin = this.getRequiredCenterDistance(query.copperDiameter)
    const rectangles = this.getCandidates(query.start, query.end, margin)
    for (const rectangle of rectangles) {
      if (rectangle.ownerNetIds.has(query.canonicalNetId)) continue
      const start = this.toLocalPoint(query.start, rectangle)
      const end = this.toLocalPoint(query.end, rectangle)
      const distance = segmentToBoxMinDistance(start, end, rectangle.localBox)
      if (!Number.isFinite(distance)) {
        throw new Error(
          "FixedCopperClearanceIndex produced a nonfinite segment distance",
        )
      }
      if (distance < margin) return false
    }
    return true
  }

  private assertLayer(z: number): void {
    if (!Number.isInteger(z) || z < 0 || z >= this.layerCount) {
      throw new Error(
        `FixedCopperClearanceIndex has invalid layer ${z} for ${this.layerCount} layers`,
      )
    }
  }

  private assertPoint(point: PhysicalCopperPoint): void {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error(
        "FixedCopperClearanceIndex requires finite physical point coordinates",
      )
    }
    this.assertLayer(point.z)
  }

  private assertCanonicalNetId(canonicalNetId: string): void {
    if (
      typeof canonicalNetId !== "string" ||
      canonicalNetId.length === 0
    ) {
      throw new Error("FixedCopperClearanceIndex requires a canonical net ID")
    }
  }

  private getRequiredCenterDistance(copperDiameter: number): number {
    if (!Number.isFinite(copperDiameter) || copperDiameter <= 0) {
      throw new Error(
        "FixedCopperClearanceIndex requires a finite positive copper diameter",
      )
    }
    const radius = copperDiameter / 2
    if (radius <= 0) {
      throw new Error(
        "FixedCopperClearanceIndex cannot represent the positive copper radius",
      )
    }
    const margin = radius + this.minClearance
    if (!Number.isFinite(margin)) {
      throw new Error(
        "FixedCopperClearanceIndex has a nonfinite clearance radius",
      )
    }
    return margin
  }

  private getPointDistance(
    point: PhysicalCopperPoint,
    rectangle: PreparedRectangle,
  ): number {
    const local = this.toLocalPoint(point, rectangle)
    const dx = Math.max(Math.abs(local.x) - rectangle.localBox.width / 2, 0)
    const dy = Math.max(Math.abs(local.y) - rectangle.localBox.height / 2, 0)
    const distance = Math.hypot(dx, dy)
    if (!Number.isFinite(distance)) {
      throw new Error(
        "FixedCopperClearanceIndex produced a nonfinite point distance",
      )
    }
    return distance
  }

  private getCandidates(
    start: PhysicalCopperPoint,
    end: PhysicalCopperPoint,
    margin: number,
  ): PreparedRectangle[] {
    const minX = Math.min(start.x, end.x) - margin
    const minY = Math.min(start.y, end.y) - margin
    const maxX = Math.max(start.x, end.x) + margin
    const maxY = Math.max(start.y, end.y) + margin
    this.assertFiniteBounds(minX, minY, maxX, maxY)
    const index = this.indexesByLayer.get(start.z)
    if (!index) return []
    return index.search(minX, minY, maxX, maxY)
  }

  private assertFiniteBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): void {
    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY)
    ) {
      throw new Error(
        "FixedCopperClearanceIndex requires finite spatial bounds",
      )
    }
  }

  private toLocalPoint(
    point: PhysicalCopperPoint,
    rectangle: PreparedRectangle,
  ): { x: number; y: number } {
    const dx = point.x - rectangle.center.x
    const dy = point.y - rectangle.center.y
    const x = dx * rectangle.cos + dy * rectangle.sin
    const y = -dx * rectangle.sin + dy * rectangle.cos
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(
        "FixedCopperClearanceIndex requires finite local coordinates",
      )
    }
    return { x, y }
  }
}
