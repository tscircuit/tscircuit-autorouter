import type { Obstacle } from "lib/types"
import { getSegmentCapsuleInterval } from "./getSegmentCapsuleInterval"

type Point = { x: number; y: number }
type Interval = [number, number]
type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

function getRectangleInterval(start: Point, end: Point, bounds: Bounds): Interval | undefined {
  let low = 0
  let high = 1
  for (const [origin, delta, minimum, maximum] of [
    [start.x, end.x - start.x, bounds.minX, bounds.maxX],
    [start.y, end.y - start.y, bounds.minY, bounds.maxY],
  ] as const) {
    if (Math.abs(delta) < 1e-15) {
      if (origin < minimum || origin > maximum) return undefined
      continue
    }
    const first = (minimum - origin) / delta
    const last = (maximum - origin) / delta
    low = Math.max(low, Math.min(first, last))
    high = Math.min(high, Math.max(first, last))
    if (high <= low) return undefined
  }
  return [low, high]
}

/** Intersect a segment with the physical pad plus a round clearance margin. */
export function getSegmentObstacleClearanceInterval({
  start, end, obstacle, margin,
}: {
  start: Point
  end: Point
  obstacle: Obstacle
  margin: number
}): Interval | undefined {
  if (obstacle.shape === "circle") {
    return getSegmentCapsuleInterval({start, end, capsuleStart: obstacle.center,
      capsuleEnd: obstacle.center, radius: obstacle.width / 2 + margin})
  }
  const angle = -(obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const localStart = {
    x: (start.x - obstacle.center.x) * cos - (start.y - obstacle.center.y) * sin,
    y: (start.x - obstacle.center.x) * sin + (start.y - obstacle.center.y) * cos,
  }
  const localEnd = {
    x: (end.x - obstacle.center.x) * cos - (end.y - obstacle.center.y) * sin,
    y: (end.x - obstacle.center.x) * sin + (end.y - obstacle.center.y) * cos,
  }
  const halfWidth = obstacle.width / 2
  const halfHeight = obstacle.height / 2
  const intervals: Interval[] = []
  // Two rectangles and four corner discs form the exact rounded envelope.
  for (const bounds of [
    {minX: -halfWidth - margin, maxX: halfWidth + margin, minY: -halfHeight, maxY: halfHeight},
    {minX: -halfWidth, maxX: halfWidth, minY: -halfHeight - margin, maxY: halfHeight + margin},
  ]) {
    const interval = getRectangleInterval(localStart, localEnd, bounds)
    if (interval) intervals.push(interval)
  }
  for (const x of [-halfWidth, halfWidth]) {
    for (const y of [-halfHeight, halfHeight]) {
      const corner = {x, y}
      const interval = getSegmentCapsuleInterval({start: localStart, end: localEnd,
        capsuleStart: corner, capsuleEnd: corner, radius: margin})
      if (interval) intervals.push(interval)
    }
  }
  if (intervals.length === 0) return undefined
  return [Math.min(...intervals.map(([low]) => low)), Math.max(...intervals.map(([, high]) => high))]
}
