import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { referenceGetNeighbors } from "./referenceSingleRouteNeighbors"

test("native neighbors retain exact order, floating costs, clamping and history decisions", (): void => {
  let state = 71931
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
  let compared = 0
  for (const Solver of [SingleHighDensityRouteSolver, SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost]) {
    for (const availableZ of [[0], [0, 1], [0, 1, 2, 3], [0, 2, 4, 7]]) {
      const obstacles: HighDensityIntraNodeRoute[] = Array.from({ length: 24 }, (_, i) => {
        const x = random() * 4 - 2
        const y = random() * 4 - 2
        const z = availableZ[i % availableZ.length]!
        return {
          connectionName: i % 7 === 0 ? "connected" : `obstacle${i}`,
          traceThickness: 0.1, viaDiameter: 0.3,
          route: [{ x, y, z }, { x: x + random() * 0.3, y: y + random() * 0.3, z }],
          vias: i % 3 === 0 ? [{ x, y }] : [],
        }
      })
      const params = {
        connectionName: "route", rootConnectionName: "root", regionId: "region",
        obstacleRoutes: obstacles, minDistBetweenEnteringPoints: 0.1,
        bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
        A: { x: -2, y: -1.8, z: availableZ[0]! },
        B: { x: 2, y: 1.8, z: availableZ[availableZ.length - 1]! },
        availableZ, layerCount: 8, obstacleMargin: 0.1,
        futureConnections: [{ connectionName: "future", points: [{ x: -0.8, y: 0.5, z: 0 }, { x: 0.8, y: 0.5, z: 2 }] }],
        connMap: { areIdsConnected: (_a: string, b: string): boolean => b === "connected" } as any,
      }
      const actual = new Solver(params)
      const reference = new Solver(params)
      for (let i = 0; i < 200; i++) {
        const x = i % 29 === 0 ? -0 : i % 9 === 0 ? -2 : i % 13 === 0 ? 2 : random() * 4 - 2
        const y = i % 31 === 0 ? -0 : i % 11 === 0 ? -2 : i % 17 === 0 ? 2 : random() * 4 - 2
        const z = availableZ[i % availableZ.length]!
        const root: Node = { x: i % 2 ? x : x + 1, y, z: z + 1, g: 0.1, h: 0.2, f: 0.3, parent: null }
        const parent: Node = { ...root, z, parent: root }
        const node: Node = { x, y, z, g: 0.1 + i / 100, h: 2.3, f: 2.7, parent }
        actual.cellStep = reference.cellStep = [0.05, 0.1, 0.2][i % 3]!
        for (const solver of [actual, reference]) {
          solver.exploredNodes.clear()
          solver.debug_nodesTooCloseToObstacle.clear()
          solver.debug_nodePathToParentIntersectsObstacle.clear()
          if (i % 3 === 0) solver.exploredNodes.add(solver.getNodeKey({ ...node, x: x - solver.cellStep }))
        }
        const expected = referenceGetNeighbors.call(reference, node)
        const result = actual.getNeighbors(node)
        expect(result).toEqual(expected)
        expect([...actual.exploredNodes]).toEqual([...reference.exploredNodes])
        expect([...actual.debug_nodesTooCloseToObstacle]).toEqual([...reference.debug_nodesTooCloseToObstacle])
        expect([...actual.debug_nodePathToParentIntersectsObstacle]).toEqual([...reference.debug_nodePathToParentIntersectsObstacle])
        expect([...actual.freePlanarObstaclePoints]).toEqual([...reference.freePlanarObstaclePoints])
        for (let j = 0; j < result.length; j++) {
          const n = result[j]!
          expect(n.parent).toBe(node)
          for (const key of ["x", "y", "z", "g", "h", "f"] as const) expect(Object.is(n[key], expected[j]![key])).toBe(true)
          expect(Object.is(n.g, actual.computeG(n))).toBe(true)
          expect(Object.is(n.h, actual.computeH(n))).toBe(true)
        }
        compared++
      }
    }
  }
  expect(compared).toBe(1600)
})
