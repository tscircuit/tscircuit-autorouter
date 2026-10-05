export type Point = { x: number; y: number }

export type Matrix3x3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

export type ProjectedRect = {
  center: Point
  width: number
  height: number
  innerWidth: number
  innerHeight: number
  ccwRotationDegrees: number
  ccwRotationRadians: number
  polygonArea: number
  equivalentAreaExpansionFactor: number
  targetQuad: [Point, Point, Point, Point]
  rectToPolygonMatrix: Matrix3x3
  polygonToRectMatrix: Matrix3x3
}

const EPSILON = 1e-9
const RIGHT_ANGLE_RADIANS = Math.PI / 2
const ROTATION_SAMPLE_COUNT = 90

const clampNonNegative = (value: number) => Math.max(0, value)

const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y

const normalizeRotationRadians = (radians: number) => {
  let normalized = radians % RIGHT_ANGLE_RADIANS
  if (normalized < 0) normalized += RIGHT_ANGLE_RADIANS
  if (RIGHT_ANGLE_RADIANS - normalized < 1e-8) return 0
  return normalized
}

const getRotationAxes = (ccwRotationRadians: number) => {
  const cos = Math.cos(ccwRotationRadians)
  const sin = Math.sin(ccwRotationRadians)
  return {
    u: { x: cos, y: sin },
    v: { x: -sin, y: cos },
  }
}

export const getPolygonSignedArea = (polygon: readonly Point[]) => {
  let doubleArea = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    doubleArea += a.x * b.y - b.x * a.y
  }
  return doubleArea / 2
}

export const getPolygonArea = (polygon: readonly Point[]) =>
  Math.abs(getPolygonSignedArea(polygon))

const getQuadArea = (quad: readonly Point[]) => getPolygonArea(quad)

export const getPolygonCentroid = (polygon: readonly Point[]): Point => {
  const signedArea = getPolygonSignedArea(polygon)
  if (Math.abs(signedArea) < EPSILON) {
    const sum = polygon.reduce(
      (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
      { x: 0, y: 0 },
    )
    return {
      x: sum.x / Math.max(1, polygon.length),
      y: sum.y / Math.max(1, polygon.length),
    }
  }

  let cx = 0
  let cy = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    const cross = a.x * b.y - b.x * a.y
    cx += (a.x + b.x) * cross
    cy += (a.y + b.y) * cross
  }

  const scale = 1 / (6 * signedArea)
  return { x: cx * scale, y: cy * scale }
}

const getCcwPolygon = (polygon: readonly Point[]) =>
  getPolygonSignedArea(polygon) >= 0 ? [...polygon] : [...polygon].reverse()

export const getConvexHull = (points: readonly Point[]): Point[] => {
  const sorted = [...points]
    .filter(
      (point, index, array) =>
        array.findIndex(
          (candidate) =>
            Math.abs(candidate.x - point.x) < 1e-9 &&
            Math.abs(candidate.y - point.y) < 1e-9,
        ) === index,
    )
    .sort((a, b) => a.x - b.x || a.y - b.y)

  if (sorted.length <= 3) return sorted

  const cross = (origin: Point, a: Point, b: Point) =>
    (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)

  const lower: Point[] = []
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 1e-9
    ) {
      lower.pop()
    }
    lower.push(point)
  }

  const upper: Point[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i]!
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 1e-9
    ) {
      upper.pop()
    }
    upper.push(point)
  }

  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

export const isPointInConvexPolygon = (
  point: Point,
  polygon: readonly Point[],
) => {
  const ccwPolygon = getCcwPolygon(polygon)
  for (let i = 0; i < ccwPolygon.length; i++) {
    const a = ccwPolygon[i]!
    const b = ccwPolygon[(i + 1) % ccwPolygon.length]!
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
    if (cross < -1e-7) return false
  }
  return true
}

export const computeLargestCenteredRectInPolygon = (
  polygon: readonly Point[],
  center = getPolygonCentroid(polygon),
  ccwRotationRadians = 0,
) => {
  const ccwPolygon = getCcwPolygon(polygon)
  const { u, v } = getRotationAxes(ccwRotationRadians)
  const constraints = ccwPolygon.map((a, index) => {
    const b = ccwPolygon[(index + 1) % ccwPolygon.length]!
    const edgeX = b.x - a.x
    const edgeY = b.y - a.y
    const edge = { x: edgeX, y: edgeY }
    return {
      hxCoeff: Math.abs(cross(edge, u)),
      hyCoeff: Math.abs(cross(edge, v)),
      limit: edgeX * (center.y - a.y) - edgeY * (center.x - a.x),
    }
  })

  if (constraints.some((constraint) => constraint.limit < -1e-7)) {
    throw new Error("Projected rect center is outside polygon")
  }

  let maxHalfWidth = Number.POSITIVE_INFINITY
  for (const constraint of constraints) {
    if (constraint.hxCoeff > EPSILON) {
      maxHalfWidth = Math.min(
        maxHalfWidth,
        constraint.limit / constraint.hxCoeff,
      )
    }
  }

  if (!Number.isFinite(maxHalfWidth) || maxHalfWidth <= EPSILON) {
    return {
      center,
      width: 1e-6,
      height: 1e-6,
      ccwRotationRadians,
      ccwRotationDegrees: (ccwRotationRadians * 180) / Math.PI,
    }
  }

  const getMaxHalfHeight = (halfWidth: number) => {
    let maxHalfHeight = Number.POSITIVE_INFINITY
    for (const constraint of constraints) {
      const remaining = constraint.limit - constraint.hxCoeff * halfWidth
      if (remaining < -1e-8) return 0
      if (constraint.hyCoeff > EPSILON) {
        maxHalfHeight = Math.min(maxHalfHeight, remaining / constraint.hyCoeff)
      }
    }
    return Number.isFinite(maxHalfHeight) ? Math.max(0, maxHalfHeight) : 0
  }

  const score = (halfWidth: number) => halfWidth * getMaxHalfHeight(halfWidth)
  let lo = 0
  let hi = maxHalfWidth

  for (let i = 0; i < 80; i++) {
    const m1 = lo + (hi - lo) / 3
    const m2 = hi - (hi - lo) / 3
    if (score(m1) < score(m2)) {
      lo = m1
    } else {
      hi = m2
    }
  }

  const halfWidth = (lo + hi) / 2
  const halfHeight = getMaxHalfHeight(halfWidth)

  return {
    center,
    width: Math.max(1e-6, halfWidth * 2),
    height: Math.max(1e-6, halfHeight * 2),
    ccwRotationRadians,
    ccwRotationDegrees: (ccwRotationRadians * 180) / Math.PI,
  }
}

const computeLargestCenteredRotatedRectInPolygon = (
  polygon: readonly Point[],
  center: Point,
) => {
  const candidateAngles = new Set<number>()
  candidateAngles.add(0)

  for (let i = 0; i < ROTATION_SAMPLE_COUNT; i++) {
    candidateAngles.add((i / ROTATION_SAMPLE_COUNT) * RIGHT_ANGLE_RADIANS)
  }

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    const edgeAngle = Math.atan2(b.y - a.y, b.x - a.x)
    candidateAngles.add(normalizeRotationRadians(edgeAngle))
    candidateAngles.add(
      normalizeRotationRadians(edgeAngle + RIGHT_ANGLE_RADIANS),
    )
  }

  const scoreAngle = (angle: number) => {
    const rect = computeLargestCenteredRectInPolygon(polygon, center, angle)
    return {
      rect,
      area: rect.width * rect.height,
    }
  }

  let best = scoreAngle(0)
  let bestAngle = 0
  for (const angle of candidateAngles) {
    const candidate = scoreAngle(angle)
    if (candidate.area > best.area + 1e-8) {
      best = candidate
      bestAngle = angle
    }
  }

  const refinementRadius = RIGHT_ANGLE_RADIANS / ROTATION_SAMPLE_COUNT
  let lo = bestAngle - refinementRadius
  let hi = bestAngle + refinementRadius
  for (let i = 0; i < 60; i++) {
    const m1 = lo + (hi - lo) / 3
    const m2 = hi - (hi - lo) / 3
    if (scoreAngle(m1).area < scoreAngle(m2).area) {
      lo = m1
    } else {
      hi = m2
    }
  }

  const normalizedAngle = normalizeRotationRadians((lo + hi) / 2)
  const refined = scoreAngle(normalizedAngle)
  return refined.area > best.area + 1e-8 ? refined.rect : best.rect
}

const intersectRayWithSegment = (
  origin: Point,
  direction: Point,
  a: Point,
  b: Point,
) => {
  const segment = { x: b.x - a.x, y: b.y - a.y }
  const denominator = direction.x * segment.y - direction.y * segment.x
  if (Math.abs(denominator) < EPSILON) return undefined

  const dx = a.x - origin.x
  const dy = a.y - origin.y
  const rayT = (dx * segment.y - dy * segment.x) / denominator
  const segmentT = (dx * direction.y - dy * direction.x) / denominator

  if (rayT < -1e-8 || segmentT < -1e-8 || segmentT > 1 + 1e-8) {
    return undefined
  }

  return {
    x: origin.x + direction.x * rayT,
    y: origin.y + direction.y * rayT,
    rayT,
  }
}

export const intersectRayWithPolygon = (
  origin: Point,
  direction: Point,
  polygon: readonly Point[],
) => {
  let best: (Point & { rayT: number }) | undefined
  for (let i = 0; i < polygon.length; i++) {
    const hit = intersectRayWithSegment(
      origin,
      direction,
      polygon[i]!,
      polygon[(i + 1) % polygon.length]!,
    )
    if (!hit) continue
    if (!best || hit.rayT < best.rayT) {
      best = hit
    }
  }
  return best
}

const solveLinearSystem = (matrix: number[][], values: number[]) => {
  const n = values.length
  const augmented = matrix.map((row, index) => [...row, values[index]!])

  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(augmented[row]![col]!) > Math.abs(augmented[pivot]![col]!)) {
        pivot = row
      }
    }

    if (Math.abs(augmented[pivot]![col]!) < EPSILON) {
      throw new Error("Could not solve homography")
    }
    ;[augmented[col], augmented[pivot]] = [augmented[pivot]!, augmented[col]!]

    const pivotValue = augmented[col]![col]!
    for (let c = col; c <= n; c++) {
      augmented[col]![c] = augmented[col]![c]! / pivotValue
    }

    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = augmented[row]![col]!
      for (let c = col; c <= n; c++) {
        augmented[row]![c] = augmented[row]![c]! - factor * augmented[col]![c]!
      }
    }
  }

  return augmented.map((row) => row[n]!)
}

export const computeHomography = (
  source: [Point, Point, Point, Point],
  destination: [Point, Point, Point, Point],
): Matrix3x3 => {
  const matrix: number[][] = []
  const values: number[] = []

  for (let i = 0; i < 4; i++) {
    const { x, y } = source[i]!
    const u = destination[i]!.x
    const v = destination[i]!.y
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    values.push(u)
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    values.push(v)
  }

  const solution = solveLinearSystem(matrix, values)
  return [
    solution[0]!,
    solution[1]!,
    solution[2]!,
    solution[3]!,
    solution[4]!,
    solution[5]!,
    solution[6]!,
    solution[7]!,
    1,
  ]
}

export const invertMatrix3x3 = (m: Matrix3x3): Matrix3x3 => {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const D = -(b * i - c * h)
  const E = a * i - c * g
  const F = -(a * h - b * g)
  const G = b * f - c * e
  const H = -(a * f - c * d)
  const I = a * e - b * d
  const determinant = a * A + b * B + c * C

  if (Math.abs(determinant) < EPSILON) {
    throw new Error("Cannot invert singular 3x3 matrix")
  }

  const invDet = 1 / determinant
  return [
    A * invDet,
    D * invDet,
    G * invDet,
    B * invDet,
    E * invDet,
    H * invDet,
    C * invDet,
    F * invDet,
    I * invDet,
  ]
}

const getRotationMatrixAroundPoint = (
  center: Point,
  ccwRotationRadians: number,
): Matrix3x3 => {
  const cos = Math.cos(ccwRotationRadians)
  const sin = Math.sin(ccwRotationRadians)
  return [
    cos,
    -sin,
    center.x - cos * center.x + sin * center.y,
    sin,
    cos,
    center.y - sin * center.x - cos * center.y,
    0,
    0,
    1,
  ]
}

export const applyMatrixToPoint = (matrix: Matrix3x3, point: Point): Point => {
  const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8]
  if (Math.abs(denominator) < EPSILON) {
    return { x: point.x, y: point.y }
  }

  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / denominator,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / denominator,
  }
}

export const localPointToWorld = (
  localPoint: Point,
  center: Point,
  ccwRotationRadians: number,
): Point => {
  const { u, v } = getRotationAxes(ccwRotationRadians)
  return {
    x: center.x + localPoint.x * u.x + localPoint.y * v.x,
    y: center.y + localPoint.x * u.y + localPoint.y * v.y,
  }
}

export const worldPointToLocal = (
  point: Point,
  center: Point,
  ccwRotationRadians: number,
): Point => {
  const { u, v } = getRotationAxes(ccwRotationRadians)
  const delta = { x: point.x - center.x, y: point.y - center.y }
  return {
    x: dot(delta, u),
    y: dot(delta, v),
  }
}

export const getProjectedRectSourceCorners = (
  rect: Pick<ProjectedRect, "center" | "width" | "height">,
): [Point, Point, Point, Point] => {
  const halfWidth = rect.width / 2
  const halfHeight = rect.height / 2
  return [
    { x: rect.center.x - halfWidth, y: rect.center.y - halfHeight },
    { x: rect.center.x + halfWidth, y: rect.center.y - halfHeight },
    { x: rect.center.x + halfWidth, y: rect.center.y + halfHeight },
    { x: rect.center.x - halfWidth, y: rect.center.y + halfHeight },
  ]
}

export const getProjectedRectCorners = (
  rect: Pick<
    ProjectedRect,
    "center" | "width" | "height" | "ccwRotationRadians"
  >,
): [Point, Point, Point, Point] => {
  const halfWidth = rect.width / 2
  const halfHeight = rect.height / 2
  return [
    localPointToWorld(
      { x: -halfWidth, y: -halfHeight },
      rect.center,
      rect.ccwRotationRadians,
    ),
    localPointToWorld(
      { x: halfWidth, y: -halfHeight },
      rect.center,
      rect.ccwRotationRadians,
    ),
    localPointToWorld(
      { x: halfWidth, y: halfHeight },
      rect.center,
      rect.ccwRotationRadians,
    ),
    localPointToWorld(
      { x: -halfWidth, y: halfHeight },
      rect.center,
      rect.ccwRotationRadians,
    ),
  ]
}

export const solveSpacePointToProjectedRectPoint = (
  point: Point,
  rect: Pick<ProjectedRect, "center" | "ccwRotationRadians">,
): Point =>
  localPointToWorld(
    { x: point.x - rect.center.x, y: point.y - rect.center.y },
    rect.center,
    rect.ccwRotationRadians,
  )

export const projectPointToRectBoundary = (
  point: Point,
  rect: Pick<
    ProjectedRect,
    "center" | "width" | "height" | "ccwRotationRadians"
  >,
): Point => {
  const localPoint = worldPointToLocal(
    point,
    rect.center,
    rect.ccwRotationRadians,
  )
  if (Math.abs(localPoint.x) < EPSILON && Math.abs(localPoint.y) < EPSILON) {
    return { ...rect.center }
  }

  const halfWidth = rect.width / 2
  const halfHeight = rect.height / 2
  const xScale =
    Math.abs(localPoint.x) > EPSILON
      ? halfWidth / Math.abs(localPoint.x)
      : Infinity
  const yScale =
    Math.abs(localPoint.y) > EPSILON
      ? halfHeight / Math.abs(localPoint.y)
      : Infinity
  const scale = Math.min(xScale, yScale)

  return {
    x: rect.center.x + localPoint.x * scale,
    y: rect.center.y + localPoint.y * scale,
  }
}

export const computeProjectedRect = (
  polygon: readonly Point[],
  equivalentAreaExpansionFactor = 0,
  minDimension = 0,
): ProjectedRect => {
  const initialCenter = getPolygonCentroid(polygon)
  const workingPolygon = isPointInConvexPolygon(initialCenter, polygon)
    ? [...polygon]
    : getConvexHull(polygon)
  const center = getPolygonCentroid(workingPolygon)
  const innerRect = computeLargestCenteredRotatedRectInPolygon(
    workingPolygon,
    center,
  )
  const polygonArea = getPolygonArea(workingPolygon)
  const innerArea = innerRect.width * innerRect.height
  const expansionFactor = clampNonNegative(equivalentAreaExpansionFactor)
  const targetArea =
    innerArea + Math.max(0, polygonArea - innerArea) * expansionFactor
  const scale =
    innerArea > EPSILON && targetArea > innerArea
      ? Math.sqrt(targetArea / innerArea)
      : 1
  const minRectDimension = Math.max(0, minDimension)
  const width = Math.max(innerRect.width * scale, minRectDimension)
  const height = Math.max(innerRect.height * scale, minRectDimension)
  const ccwRotationRadians = normalizeRotationRadians(
    innerRect.ccwRotationRadians,
  )
  const ccwRotationDegrees = (ccwRotationRadians * 180) / Math.PI
  const rectCorners = getProjectedRectSourceCorners({
    center,
    width,
    height,
  })
  const rotatedRectCorners = getProjectedRectCorners({
    center,
    width,
    height,
    ccwRotationRadians,
  })
  const targetQuad = rotatedRectCorners.map((corner) => {
    const direction = { x: corner.x - center.x, y: corner.y - center.y }
    const hit = intersectRayWithPolygon(center, direction, workingPolygon)
    return hit ? { x: hit.x, y: hit.y } : corner
  }) as [Point, Point, Point, Point]
  let nonDegenerateTargetQuad =
    getQuadArea(targetQuad) > EPSILON ? targetQuad : rotatedRectCorners
  let rectToPolygonMatrix: Matrix3x3
  let polygonToRectMatrix: Matrix3x3
  try {
    rectToPolygonMatrix = computeHomography(
      rectCorners,
      nonDegenerateTargetQuad,
    )
    polygonToRectMatrix = invertMatrix3x3(rectToPolygonMatrix)
  } catch {
    nonDegenerateTargetQuad = rotatedRectCorners
    rectToPolygonMatrix = getRotationMatrixAroundPoint(
      center,
      ccwRotationRadians,
    )
    polygonToRectMatrix = getRotationMatrixAroundPoint(
      center,
      -ccwRotationRadians,
    )
  }

  return {
    center,
    width,
    height,
    innerWidth: innerRect.width,
    innerHeight: innerRect.height,
    ccwRotationDegrees,
    ccwRotationRadians,
    polygonArea,
    equivalentAreaExpansionFactor: expansionFactor,
    targetQuad: nonDegenerateTargetQuad,
    rectToPolygonMatrix,
    polygonToRectMatrix,
  }
}
