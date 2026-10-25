import { expect, test } from "bun:test"
import { DisjointSet } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"

test("count distinct components across coincident points and repeated unions", (): void => {
  const points = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
  ]
  const connected = new DisjointSet(points)

  expect(connected.componentCount).toBe(3)
  expect(connected.union(points[0]!, points[1]!)).toBe(false)
  expect(connected.componentCount).toBe(3)
  expect(connected.union(points[0]!, points[2]!)).toBe(true)
  expect(connected.componentCount).toBe(2)
  expect(connected.union(points[2]!, points[0]!)).toBe(false)
  expect(connected.componentCount).toBe(2)
  expect(connected.union(points[2]!, points[3]!)).toBe(true)
  expect(connected.componentCount).toBe(1)
  expect(new DisjointSet([]).componentCount).toBe(0)
})
