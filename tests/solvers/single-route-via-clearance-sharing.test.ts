import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Future } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { referenceGetNeighbors } from "./referenceSingleRouteNeighbors"

test("native multilayer via clearance shares one verdict but retains exact parent history", (): void => {
  for (const Solver of [SingleHighDensityRouteSolver, Future]) {
    for (const layerCount of [2, 4, 6]) {
      const options = {
        connectionName: "route", minDistBetweenEnteringPoints: 0.1,
        bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
        A: { x: -3, y: -2, z: 0 }, B: { x: 3, y: 2, z: layerCount - 1 },
        availableZ: Array.from({ length: layerCount }, (_, i) => i), layerCount,
        obstacleRoutes: [{ connectionName: "foreign", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -1, y: 2, z: 0 }, { x: 1, y: 2, z: 0 }], vias: [{ x: 2, y: 2 }] }],
        futureConnections: [{ connectionName: "future", points: [{ x: -1, y: 1, z: 0 }, { x: 1, y: 1, z: 1 }] }],
      }
      const actual = new Solver(options)
      const reference = new Solver(options)
      let actualQueries = 0
      let referenceQueries = 0
      for (const [solver, count] of [[actual, () => actualQueries++], [reference, () => referenceQueries++]] as const) {
        const index = solver.obstacleSegmentIndex!
        const search = index.search.bind(index)
        index.search = (...args: Parameters<typeof search>): number[] => {
          count()
          return search(...args)
        }
      }
      const node: Node = { x: 0, y: 0, z: 0, g: 0.1, h: 1, f: 2, parent: null }
      const expected = referenceGetNeighbors.call(reference, node)
      const result = actual.getNeighbors(node)
      expect(result).toEqual(expected)
      expect(result.filter(n => n.z !== node.z).map(n => n.z)).toEqual(options.availableZ.slice(1))
      expect(actualQueries).toBe(1)
      expect(referenceQueries).toBe(layerCount - 1)
      expect((actual as any).canShareViaClearanceAcrossLayers()).toBe(true)
      const root = { ...node, z: 1 }
      const via = { ...node, parent: root }
      const afterVia = { ...node, parent: via }
      expect(actual.getViasInNodePath(afterVia)).toEqual([{ x: 0, y: 0 }])
      expect(actual.getNeighbors(afterVia)).toEqual(referenceGetNeighbors.call(reference, afterVia))
      expect(actual.getNeighbors(afterVia).filter(n => n.z !== node.z)).toHaveLength(0)
      // A verdict from an earlier expansion must not survive an obstacle rebuild.
      actual.obstacleRoutes.push({ connectionName: "new", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }], vias: [] })
      actual.buildObstacleIndexes()
      expect(actual.getNeighbors(node).filter(n => n.z !== node.z)).toHaveLength(0)
    }
  }
})
