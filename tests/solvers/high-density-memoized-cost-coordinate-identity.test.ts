import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("cost memoization distinguishes exact coordinates and planar versus via arrivals", () => {
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    connectionName: "route",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.15,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: 0, z: 0 },
    B: { x: 2, y: 0, z: 0 },
    availableZ: [0, 1, 2, 3],
    futureConnections: [
      {
        connectionName: "future",
        points: [
          { x: 0.1, y: 0.1, z: 0 },
          { x: 0.2, y: 0.2, z: 1 },
        ],
      },
    ],
  })
  let calculations = 0
  solver.futureConnectionPoints = new Proxy(solver.futureConnectionPoints, {
    get(target, property, receiver) {
      if (property === Symbol.iterator) calculations++
      return Reflect.get(target, property, receiver)
    },
  })
  const parent: Node = { x: -0.05, y: 0, z: 0, g: 1, h: 0, f: 0, parent: null }
  const node: Node = { x: 0, y: 0, z: 0, g: 0, h: 0, f: 0, parent }
  solver.setNodeCosts(node)
  expect(calculations).toBe(1)
  const repeated = { ...node, parent: { ...parent, g: 2 } }
  solver.setNodeCosts(repeated)
  expect(calculations).toBe(1)
  expect(repeated.g - node.g).toBeCloseTo(1, 12)

  const viaArrival = { ...node, parent: { ...parent, z: 1 } }
  solver.setNodeCosts(viaArrival)
  expect(calculations).toBe(2)
  expect(viaArrival.h).not.toBe(node.h)
  solver.setNodeCosts({ ...viaArrival, parent: { ...parent, z: 3 } })
  expect(calculations).toBe(2)

  const jittered = { ...node, x: 1e-12 }
  expect(solver.getNodeKey(jittered)).toBe(solver.getNodeKey(node))
  const expectedG = solver.computeG(jittered)
  const expectedH = solver.computeH(jittered)
  const beforeJitter = calculations
  solver.setNodeCosts(jittered)
  expect(calculations).toBe(beforeJitter + 1)
  expect(jittered.g).toBe(expectedG)
  expect(jittered.h).toBe(expectedH)
  solver.setNodeCosts(node)
  expect(calculations).toBe(beforeJitter + 2)
})
