import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("explored nodes retain public Set mutation and iteration behavior", () => {
  const solver = new SingleHighDensityRouteSolver({
    connectionName: "public-set",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: -1, z: 0 },
    B: { x: 2, y: 1, z: 0 },
    availableZ: [0, 1],
  })
  const explored = solver.exploredNodes
  const reference = new Set<number>()
  const keys = [0, -0, 3, -1, 0.25, 1e9, Number.NaN, Infinity, -Infinity]
  expect(explored).toBeInstanceOf(Set)
  for (const key of keys) {
    expect(explored.add(key)).toBe(explored)
    reference.add(key)
  }
  expect(explored.size).toBe(reference.size)
  expect([...explored]).toEqual([...reference])
  expect([...explored.keys()]).toEqual([...reference.keys()])
  expect([...explored.values()]).toEqual([...reference.values()])
  expect([...explored.entries()]).toEqual([...reference.entries()])
  const ExploredSetConstructor = explored.constructor as new (
    values: Iterable<number>,
  ) => Set<number>
  const constructedFromIterator = new ExploredSetConstructor(reference.values())
  expect([...constructedFromIterator]).toEqual([...reference])
  expect([...new Set(explored)]).toEqual([...reference])
  for (const key of [...keys, 7, 1.25, -2, 1e10]) {
    expect(explored.has(key)).toBe(reference.has(key))
    expect(constructedFromIterator.has(key)).toBe(reference.has(key))
    expect(Set.prototype.has.call(explored, key)).toBe(reference.has(key))
  }
  for (const key of [3, Number.NaN, -1, 17]) {
    expect(explored.delete(key)).toBe(reference.delete(key))
  }
  explored.add(3)
  reference.add(3)
  const callbackValues: number[] = []
  explored.forEach((value, secondValue, set) => {
    expect(value).toBe(secondValue)
    expect(set).toBe(explored)
    callbackValues.push(value)
  })
  expect(callbackValues).toEqual([...reference])
  explored.clear()
  expect(explored.size).toBe(0)
  for (const key of keys) expect(explored.has(key)).toBe(false)

  const parent: Node = { x: 0, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null }
  const blockedKey = solver.getNodeKey({ ...parent, x: solver.cellStep, parent })
  explored.add(blockedKey)
  expect(solver.getNeighbors(parent).some((node) => solver.getNodeKey(node) === blockedKey))
    .toBe(false)
  explored.delete(blockedKey)
  expect(solver.getNeighbors(parent).some((node) => solver.getNodeKey(node) === blockedKey))
    .toBe(true)
  const replacement = new Set([blockedKey])
  solver.exploredNodes = replacement
  expect(solver.exploredNodes).toBe(replacement)
  expect(solver.getNeighbors(parent).some((node) => solver.getNodeKey(node) === blockedKey))
    .toBe(false)
})
