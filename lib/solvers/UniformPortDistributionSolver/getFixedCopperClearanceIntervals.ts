import type { FixedCopperRectangle } from "lib/data-structures/FixedCopperClearanceIndex"

/** Closed distance interval measured from the supplied edge start. */
export type FixedCopperClearanceInterval = {
  start: number
  end: number
}

type Point = Readonly<{ x: number; y: number }>
type OpenInterval = { start: number; end: number }

const assertFiniteValues = (
  values: readonly number[],
  description: string,
): void => {
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new Error(
        `getFixedCopperClearanceIntervals requires finite ${description}`,
      )
    }
  }
}

const intersectOpenBox = (
  origin: Point,
  direction: Point,
  halfWidth: number,
  halfHeight: number,
): OpenInterval | undefined => {
  let start = Number.NEGATIVE_INFINITY
  let end = Number.POSITIVE_INFINITY
  const axes = [
    { offset: origin.x, velocity: direction.x, halfSize: halfWidth },
    { offset: origin.y, velocity: direction.y, halfSize: halfHeight },
  ]
  for (const axis of axes) {
    if (axis.velocity === 0) {
      if (Math.abs(axis.offset) >= axis.halfSize) return undefined
      continue
    }
    const first = (-axis.halfSize - axis.offset) / axis.velocity
    const second = (axis.halfSize - axis.offset) / axis.velocity
    assertFiniteValues([first, second], "open-box intersections")
    start = Math.max(start, Math.min(first, second))
    end = Math.min(end, Math.max(first, second))
    if (start >= end) return undefined
  }
  assertFiniteValues([start, end], "open-box interval bounds")
  return { start, end }
}

const intersectOpenDisk = (
  origin: Point,
  direction: Point,
  center: Point,
  radius: number,
): OpenInterval | undefined => {
  const offsetX = origin.x - center.x
  const offsetY = origin.y - center.y
  const directionLength = Math.hypot(direction.x, direction.y)
  const perpendicularDistance =
    Math.abs(offsetX * direction.y - offsetY * direction.x) / directionLength
  assertFiniteValues(
    [offsetX, offsetY, directionLength, perpendicularDistance],
    "open-disk geometry",
  )
  if (directionLength <= 0) {
    throw new Error(
      "getFixedCopperClearanceIntervals requires a line direction",
    )
  }
  // A tangent point has distance exactly radius, so it is not forbidden.
  if (perpendicularDistance >= radius) return undefined
  const centerDistance =
    -(offsetX * direction.x + offsetY * direction.y) /
    (directionLength * directionLength)
  const halfSpan =
    Math.sqrt(
      (radius - perpendicularDistance) * (radius + perpendicularDistance),
    ) / directionLength
  const start = centerDistance - halfSpan
  const end = centerDistance + halfSpan
  assertFiniteValues(
    [centerDistance, halfSpan, start, end],
    "open-disk intersections",
  )
  if (halfSpan <= 0 || start >= end) {
    throw new Error(
      "getFixedCopperClearanceIntervals cannot represent an open-disk interval",
    )
  }
  return { start, end }
}

const complementOpenIntervals = (
  forbidden: OpenInterval[],
  length: number,
): FixedCopperClearanceInterval[] => {
  forbidden.sort((left, right): number => {
    const leftStart = left.start
    const rightStart = right.start
    if (leftStart < rightStart) return -1
    if (leftStart > rightStart) return 1
    if (left.end < right.end) return -1
    if (left.end > right.end) return 1
    return 0
  })
  const legal: FixedCopperClearanceInterval[] = []
  let cursor = 0
  for (const interval of forbidden) {
    if (interval.end <= cursor) continue
    if (interval.start > length) break
    if (interval.start >= cursor) {
      // Equality retains a legal singleton between touching OPEN intervals.
      legal.push({ start: cursor, end: interval.start })
    }
    cursor = Math.max(cursor, interval.end)
    // Keep original open bounds until here: an interior domain endpoint must
    // not become legal merely because a forbidden interval was clipped there.
    if (cursor > length) return legal
  }
  if (cursor <= length) legal.push({ start: cursor, end: length })
  return legal
}

/**
 * Exact analytic complement of fixed-rectangle clearance on an axis-aligned
 * edge. No positions are sampled or moved. The caller supplies physical copper
 * width and canonical ownership; unclaimed assignable vias are not this domain.
 */
export const getFixedCopperClearanceIntervals = (params: {
  readonly start: Point
  readonly end: Point
  readonly z: number
  readonly layerCount: number
  readonly canonicalNetId: string
  readonly copperDiameter: number
  readonly minClearance: number
  readonly rectangles: readonly FixedCopperRectangle[]
}): FixedCopperClearanceInterval[] => {
  assertFiniteValues(
    [
      params.start.x,
      params.start.y,
      params.end.x,
      params.end.y,
      params.copperDiameter,
      params.minClearance,
    ],
    "edge geometry and clearance",
  )
  if (
    !Number.isSafeInteger(params.layerCount) ||
    params.layerCount <= 0 ||
    !Number.isInteger(params.z) ||
    params.z < 0 ||
    params.z >= params.layerCount ||
    typeof params.canonicalNetId !== "string" ||
    params.canonicalNetId.length === 0 ||
    params.copperDiameter <= 0 ||
    params.minClearance < 0
  ) {
    throw new Error(
      "getFixedCopperClearanceIntervals has invalid physical inputs",
    )
  }
  const copperRadius = params.copperDiameter / 2
  const radius = copperRadius + params.minClearance
  if (copperRadius <= 0 || !Number.isFinite(radius)) {
    throw new Error(
      "getFixedCopperClearanceIntervals cannot represent the clearance radius",
    )
  }
  const edgeDx = params.end.x - params.start.x
  const edgeDy = params.end.y - params.start.y
  const length = Math.abs(edgeDx) + Math.abs(edgeDy)
  assertFiniteValues([edgeDx, edgeDy, length], "edge extent")
  if (edgeDx !== 0 && edgeDy !== 0) {
    throw new Error(
      "getFixedCopperClearanceIntervals requires an axis-aligned edge",
    )
  }
  // For a zero-length domain, any line through its sole point gives the same
  // point membership. The chosen positive-X parameterization introduces no edge.
  const worldDirection = {
    x: edgeDx !== 0 ? Math.sign(edgeDx) : edgeDy === 0 ? 1 : 0,
    y: edgeDy !== 0 ? Math.sign(edgeDy) : 0,
  }
  const forbidden: OpenInterval[] = []
  for (const rectangle of params.rectangles) {
    const rotation =
      rectangle.ccwRotationDegrees === undefined
        ? 0
        : rectangle.ccwRotationDegrees
    assertFiniteValues(
      [
        rectangle.center.x,
        rectangle.center.y,
        rectangle.width,
        rectangle.height,
        rotation,
      ],
      "fixed rectangle geometry",
    )
    const halfWidth = rectangle.width / 2
    const halfHeight = rectangle.height / 2
    if (
      rectangle.kind !== "fixed-rectangle" ||
      halfWidth <= 0 ||
      halfHeight <= 0 ||
      rectangle.zLayers.length === 0
    ) {
      throw new Error(
        "getFixedCopperClearanceIntervals has invalid fixed copper",
      )
    }
    for (const z of rectangle.zLayers) {
      if (!Number.isInteger(z) || z < 0 || z >= params.layerCount) {
        throw new Error(
          "getFixedCopperClearanceIntervals has invalid copper layers",
        )
      }
    }
    for (const ownerNetId of rectangle.ownerNetIds) {
      if (typeof ownerNetId !== "string" || ownerNetId.length === 0) {
        throw new Error(
          "getFixedCopperClearanceIntervals has invalid copper owners",
        )
      }
    }
    if (
      !rectangle.zLayers.includes(params.z) ||
      rectangle.ownerNetIds.has(params.canonicalNetId)
    ) {
      continue
    }
    const angle = ((rotation % 360) * Math.PI) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const offsetX = params.start.x - rectangle.center.x
    const offsetY = params.start.y - rectangle.center.y
    const origin = {
      x: offsetX * cos + offsetY * sin,
      y: -offsetX * sin + offsetY * cos,
    }
    const direction = {
      x: worldDirection.x * cos + worldDirection.y * sin,
      y: -worldDirection.x * sin + worldDirection.y * cos,
    }
    assertFiniteValues(
      [
        origin.x,
        origin.y,
        direction.x,
        direction.y,
        halfWidth + radius,
        halfHeight + radius,
      ],
      "local rectangle geometry",
    )
    // The strict rounded rectangle is the union of two open expanded strips
    // and four open corner disks. This preserves true Euclidean corner gaps.
    const stripIntervals = [
      intersectOpenBox(origin, direction, halfWidth + radius, halfHeight),
      intersectOpenBox(origin, direction, halfWidth, halfHeight + radius),
    ]
    for (const interval of stripIntervals) {
      if (interval) forbidden.push(interval)
    }
    for (const x of [-halfWidth, halfWidth]) {
      for (const y of [-halfHeight, halfHeight]) {
        const interval = intersectOpenDisk(origin, direction, { x, y }, radius)
        if (interval) forbidden.push(interval)
      }
    }
  }
  return complementOpenIntervals(forbidden, length)
}
