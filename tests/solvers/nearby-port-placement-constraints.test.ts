import { expect, test } from "bun:test"
import {
  getNearbyPortPlacementConstraints,
  type NearbyPortPlacementEvent,
} from "lib/solvers/UniformPortDistributionSolver/getNearbyPortPlacementConstraints"

test("global endpoint indexing includes every possible collision across layers, owners and widths", (): void => {
  let seed = 672985
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  for (let trial = 0; trial < 100; trial++) {
    const origin = trial % 3 === 0 ? 2 ** 40 : 0
    const events: NearbyPortPlacementEvent[] = Array.from({ length: 30 }, (_, index) => {
      const x = origin + random() * 3, y = origin + random() * 3
      return {
        bounds: { minX: x, maxX: x + (index % 2 ? random() : 0),
          minY: y, maxY: y + (index % 2 ? 0 : random()) },
        z: index % 3, owner: index % 5 === 0 ? undefined : `owner-${index % 4}`,
        connectionName: `connection-${index % 7}`, width: 0.05 + random() * 0.8,
      }
    })
    const expected: string[] = []
    for (let first = 0; first < events.length; first++) {
      for (let second = first + 1; second < events.length; second++) {
        const a = events[first]!, b = events[second]!
        if (a.z !== b.z || (a.owner !== undefined && a.owner === b.owner) ||
          a.connectionName === b.connectionName) continue
        const x = a.bounds.maxX < b.bounds.minX ? b.bounds.minX - a.bounds.maxX
          : b.bounds.maxX < a.bounds.minX ? a.bounds.minX - b.bounds.maxX : 0
        const y = a.bounds.maxY < b.bounds.minY ? b.bounds.minY - a.bounds.maxY
          : b.bounds.maxY < a.bounds.minY ? a.bounds.minY - b.bounds.maxY : 0
        const gap = Math.max(0, (a.width + b.width) / 2 + 0.1 - 0.005)
        if (Math.hypot(x, y) < gap) expected.push(`${first}:${second}:${gap}`)
      }
    }
    const original = structuredClone(events)
    const actual = getNearbyPortPlacementConstraints(events, 0.1, 0.005)
    expect(actual.map(({ first, second, gap }) => `${first}:${second}:${gap}`).sort())
      .toEqual(expected.sort())
    expect(events).toEqual(original)
  }
  // Domain endpoints can start clear and move close later. The index uses the
  // whole domain, including fixed points and independently named unknown nets.
  const events: NearbyPortPlacementEvent[] = [
    { bounds: { minX: 0, maxX: 10, minY: 0, maxY: 0 }, z: 0, owner: undefined, connectionName: "A", width: 0.1 },
    { bounds: { minX: 0, maxX: 0, minY: 0.1, maxY: 0.1 }, z: 0, owner: undefined, connectionName: "B", width: 0.1 },
    { bounds: { minX: 0, maxX: 0, minY: 0.1, maxY: 0.1 }, z: 1, owner: undefined, connectionName: "C", width: 0.1 },
    { bounds: { minX: 10, maxX: 10, minY: 0.195, maxY: 0.195 }, z: 0, owner: undefined, connectionName: "A", width: 0.1 },
  ]
  expect(getNearbyPortPlacementConstraints(events, 0.1, 0.005))
    .toEqual([{ first: 0, second: 1, gap: 0.195 }])
})
