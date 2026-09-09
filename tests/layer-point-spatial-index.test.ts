import { expect, test } from "bun:test"
import { LayerPointSpatialIndex } from "../lib/data-structures/LayerPointSpatialIndex"

test("spatial nearest search preserves weighted distances and original point ties", () => {
  type Point = { x: number; y: number; z: number }
  const nearest = (points: Point[], node: Point, penalty: number): Point | null => {
    let minimum = Infinity
    let closest: Point | null = null
    for (const point of points) {
      const dx = node.x - point.x
      const dy = node.y - point.y
      const distance = Math.sqrt(dx * dx + dy * dy) + (node.z !== point.z ? penalty : 0)
      if (distance < minimum) {
        minimum = distance
        closest = point
      }
    }
    return closest
  }
  let seed = 384921
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  const values = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, 1e-200, -1e-200, 1e-160, 1e-150, 1, 1 + Number.EPSILON, 2, 1e100, -1e100, 1e200, Number.MAX_VALUE, -Number.MAX_VALUE]
  for (let sample = 0; sample < 200; sample++) {
    const coordinate = (): number => sample % 2 === 0
      ? values[Math.floor(random() * values.length)]
      : random() * 20 - 10
    const points = Array.from({ length: Math.floor(random() * 51) }, () => ({
      x: coordinate(), y: coordinate(), z: Math.floor(random() * 6),
    }))
    const index = new LayerPointSpatialIndex(points)
    for (let query = 0; query < 50; query++) {
      const node = { x: coordinate(), y: coordinate(), z: Math.floor(random() * 6) }
      const penalty = coordinate()
      expect(index.findNearestPoint(node, penalty)).toBe(nearest(points, node, penalty))
    }
  }
  const ties = [
    { x: 1 + Number.EPSILON, y: 0, z: 1 },
    { x: 1, y: 0, z: 1 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
  ]
  const index = new LayerPointSpatialIndex(ties)
  for (const penalty of [0, -1, 1, 1e100, -1e100]) {
    const node = { x: 0, y: 0, z: 0 }
    expect(index.findNearestPoint(node, penalty)).toBe(nearest(ties, node, penalty))
  }
})
