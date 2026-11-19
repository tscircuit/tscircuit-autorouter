type Point = { x: number; y: number }

/**
 * Intersect a segment with a round wire's clearance envelope. Coordinates are
 * board-world mm (+X right, +Y up, +Z above the board; right-handed).
 * The returned parameters lie on start + t * (end - start), for 0 <= t <= 1.
 */
export function getSegmentCapsuleInterval({
  start,
  end,
  capsuleStart,
  capsuleEnd,
  radius,
}: {
  start: Point
  end: Point
  capsuleStart: Point
  capsuleEnd: Point
  radius: number
}): [number, number] | undefined {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const ux = capsuleEnd.x - capsuleStart.x
  const uy = capsuleEnd.y - capsuleStart.y
  const px = start.x - capsuleStart.x
  const py = start.y - capsuleStart.y
  const lengthSquared = ux * ux + uy * uy
  let projection = 0
  let projectionSlope = 0
  if (lengthSquared > 0) {
    projection = (px * ux + py * uy) / lengthSquared
    projectionSlope = (dx * ux + dy * uy) / lengthSquared
  }
  const cuts = [0, 1]
  if (projectionSlope !== 0) {
    for (const endpoint of [0, 1]) {
      const t = (endpoint - projection) / projectionSlope
      if (t > 0 && t < 1) cuts.push(t)
    }
  }
  cuts.sort((a, b) => a - b)
  let interval: [number, number] | undefined
  for (let index = 1; index < cuts.length; index++) {
    const low = cuts[index - 1]!
    const high = cuts[index]!
    const midpointProjection =
      projection + (projectionSlope * (low + high)) / 2
    const clampedProjection = Math.max(0, Math.min(1, midpointProjection))
    let qx = px - clampedProjection * ux
    let qy = py - clampedProjection * uy
    let vx = dx
    let vy = dy
    if (midpointProjection > 0 && midpointProjection < 1) {
      qx = px - projection * ux
      qy = py - projection * uy
      vx = dx - projectionSlope * ux
      vy = dy - projectionSlope * uy
    }
    const a = vx * vx + vy * vy
    const b = 2 * (qx * vx + qy * vy)
    const c = qx * qx + qy * qy - radius * radius
    let entry = low
    let exit = high
    if (a <= 1e-24) {
      if (c >= 0) continue
    } else {
      const discriminant = b * b - 4 * a * c
      if (discriminant <= 0) continue
      const root = Math.sqrt(discriminant)
      entry = Math.max(low, (-b - root) / (2 * a))
      exit = Math.min(high, (-b + root) / (2 * a))
    }
    if (exit <= entry) continue
    if (interval) {
      interval[0] = Math.min(interval[0], entry)
      interval[1] = Math.max(interval[1], exit)
    } else {
      interval = [entry, exit]
    }
  }
  return interval
}
