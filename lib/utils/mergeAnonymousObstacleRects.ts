import stringify from "fast-json-stable-stringify"
import type { Obstacle } from "lib/types"

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type GridRect = { left: number; right: number; top: number; bottom: number }

// Adjacent slices can differ by roundoff in center +/- size / 2.
const EPSILON = 1e-9

function getConnectedRectGroups(obstacles: Obstacle[]): Obstacle[][] {
  const remaining = new Map<Obstacle, Bounds>(
    obstacles.map((obstacle): [Obstacle, Bounds] => [
      obstacle,
      {
        minX: obstacle.center.x - obstacle.width / 2,
        maxX: obstacle.center.x + obstacle.width / 2,
        minY: obstacle.center.y - obstacle.height / 2,
        maxY: obstacle.center.y + obstacle.height / 2,
      },
    ]),
  )
  const groups: Obstacle[][] = []
  for (const [first, firstBounds] of remaining) {
    const group: Obstacle[] = [first]
    const bounds: Bounds[] = [firstBounds]
    remaining.delete(first)
    for (let index = 0; index < bounds.length; index++) {
      const b = bounds[index]!
      for (const [other, candidate] of remaining) {
        if (
          b.maxX < candidate.minX - EPSILON ||
          candidate.maxX < b.minX - EPSILON ||
          b.maxY < candidate.minY - EPSILON ||
          candidate.maxY < b.minY - EPSILON
        ) {
          continue
        }
        group.push(other)
        bounds.push(candidate)
        remaining.delete(other)
      }
    }
    groups.push(group)
  }
  return groups
}

function getCoordinates(values: number[]): number[] {
  const coordinates: number[] = []
  for (const value of values.sort((a, b): number => a - b)) {
    const previous = coordinates.at(-1)
    if (previous === undefined || value - previous > EPSILON) {
      coordinates.push(value)
    }
  }
  return coordinates
}

function mergeRectUnion(obstacles: Obstacle[]): Obstacle[] {
  if (obstacles.length < 2) return obstacles
  const bounds: Bounds[] = obstacles.map((obstacle): Bounds => ({
    minX: obstacle.center.x - obstacle.width / 2,
    maxX: obstacle.center.x + obstacle.width / 2,
    minY: obstacle.center.y - obstacle.height / 2,
    maxY: obstacle.center.y + obstacle.height / 2,
  }))
  const xs = getCoordinates(bounds.flatMap((b): number[] => [b.minX, b.maxX]))
  const ys = getCoordinates(bounds.flatMap((b): number[] => [b.minY, b.maxY]))
  const columns = xs.length - 1
  const rows = ys.length - 1
  const covered = new Uint8Array(columns * rows)
  for (const b of bounds) {
    const left = xs.findIndex((x): boolean => Math.abs(x - b.minX) <= EPSILON)
    const right = xs.findIndex((x): boolean => Math.abs(x - b.maxX) <= EPSILON)
    const top = ys.findIndex((y): boolean => Math.abs(y - b.minY) <= EPSILON)
    const bottom = ys.findIndex((y): boolean => Math.abs(y - b.maxY) <= EPSILON)
    for (let row = top; row < bottom; row++) {
      covered.fill(1, row * columns + left, row * columns + right)
    }
  }

  const merged: Obstacle[] = []
  // A largest-rectangle histogram extracts the shared interior even when
  // neighboring strips have different widths. Uncovered cells stay empty.
  while (true) {
    const starts = new Int32Array(columns)
    let best: GridRect | undefined
    let bestArea = 0
    for (let row = 0; row < rows; row++) {
      const stack: number[] = []
      for (let column = 0; column <= columns; column++) {
        if (column < columns && !covered[row * columns + column]) {
          starts[column] = row + 1
        }
        const start = column === columns ? row + 1 : starts[column]!
        while (stack.length > 0 && starts[stack.at(-1)!]! < start) {
          const index = stack.pop()!
          const left = stack.length === 0 ? 0 : stack.at(-1)! + 1
          const area =
            (xs[column]! - xs[left]!) * (ys[row + 1]! - ys[starts[index]!]!)
          if (area > bestArea) {
            bestArea = area
            best = { left, right: column, top: starts[index]!, bottom: row + 1 }
          }
        }
        if (column < columns) stack.push(column)
      }
    }
    if (!best) break
    const minX = xs[best.left]!
    const maxX = xs[best.right]!
    const minY = ys[best.top]!
    const maxY = ys[best.bottom]!
    merged.push({
      ...obstacles[0]!,
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      width: maxX - minX,
      height: maxY - minY,
    })
    for (let row = best.top; row < best.bottom; row++) {
      covered.fill(0, row * columns + best.left, row * columns + best.right)
    }
  }
  // Keep the original decomposition when its rectangles already cost less.
  return merged.length < obstacles.length ? merged : obstacles
}

/** Coalesce anonymous polygon/cutout strips without combining pad identities. */
export function mergeAnonymousObstacleRects(obstacles: Obstacle[]): Obstacle[] {
  const groups = new Map<string, Obstacle[]>()
  for (const obstacle of obstacles) {
    if (
      obstacle.type !== "rect" ||
      obstacle.obstacleId !== undefined ||
      obstacle.componentId !== undefined ||
      obstacle.connectedTo.length > 0 ||
      obstacle.ccwRotationDegrees ||
      obstacle.isNonPlatedHole ||
      obstacle.shape ||
      obstacle.width <= EPSILON ||
      obstacle.height <= EPSILON
    ) {
      continue
    }
    const { center, width, height, ...attributes } = obstacle
    const key = stringify(attributes)
    const group = groups.get(key)
    if (group) group.push(obstacle)
    else groups.set(key, [obstacle])
  }
  const replacements = new Map<Obstacle, Obstacle[]>()
  const removed = new Set<Obstacle>()
  for (const group of groups.values()) {
    // Disjoint cutouts need separate grids; distant objects must not multiply
    // one another's coordinate counts or the number of extraction passes.
    const merged = getConnectedRectGroups(group).flatMap(mergeRectUnion)
    if (merged.length === group.length) continue
    replacements.set(group[0]!, merged)
    for (const obstacle of group) removed.add(obstacle)
  }
  return obstacles.flatMap((obstacle): Obstacle[] => {
    const replacement = replacements.get(obstacle)
    if (replacement) return replacement
    return removed.has(obstacle) ? [] : [obstacle]
  })
}
