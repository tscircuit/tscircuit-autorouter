import { expect, test } from "bun:test"
import type { Node } from "../../lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("frontier keeps ties, improvements, and coordinate aliases", (): void => {
  const solver = new SingleHighDensityRouteSolver({
    connectionName: "signal",
    obstacleRoutes: [
      {
        connectionName: "obstacle",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: -1, z: 0 },
          { x: 0, y: 1, z: 0 },
        ],
        vias: [],
      },
    ],
    minDistBetweenEnteringPoints: 0.01,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    A: { x: -4, y: -4, z: 0 },
    B: { x: 4, y: 4, z: 0 },
    traceThickness: 0.1,
    obstacleMargin: 0.1,
    viaDiameter: 0.3,
    availableZ: [0, 1],
  })
  const parent = solver.candidates.peek()
  const first: Node = { x: 0, y: 0, z: 0, g: 8, h: 0, f: 8, parent }
  const worse: Node = { ...first, g: 9, f: 9 }
  const tie: Node = { ...first }
  const better: Node = { ...first, g: 7, f: 7 }
  const alias: Node = { ...worse, x: 1e-12 }
  const other: Node = { ...first, x: 1, g: 1, f: 1 }
  expect(solver.getNodeKey(first)).toBe(solver.getNodeKey(alias))
  solver.getNeighbors = (): Node[] => [first, worse, tie, better, alias, other]
  solver.step()
  const queued = solver.candidates.getTopN(20)
  expect(queued).toHaveLength(5)
  expect(queued).not.toContain(worse)
  for (const retained of [first, tie, better, alias, other])
    expect(queued).toContain(retained)
  expect(solver.candidates.dequeue()).toBe(other)
  expect(solver.candidates.dequeue()).toBe(better)
})
