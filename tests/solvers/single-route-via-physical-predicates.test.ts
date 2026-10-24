import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Future } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { referenceGetNeighbors } from "./referenceSingleRouteNeighbors"

test("shared verdict preserves intermediate-layer copper, future trace and strict via-boundary rejection", (): void => {
  const common = {
    connectionName: "route", rootConnectionName: "root", regionId: "region",
    minDistBetweenEnteringPoints: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -2, y: 0, z: 0 }, B: { x: 2, y: 0, z: 3 },
    availableZ: [0, 1, 2, 3], layerCount: 4,
  }
  const node: Node = { x: 0, y: 0, z: 0, g: 0.1, h: 2, f: 3, parent: null }
  const cases = [
    { ...common, obstacleRoutes: [{ connectionName: "middle", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -1, y: 0, z: 2 }, { x: 1, y: 0, z: 2 }], vias: [] }], futureConnections: [], node },
    { ...common, obstacleRoutes: [], futureConnections: [{ connectionName: "future", points: [{ x: -1, y: 0.2, z: 1 }, { x: 1, y: 0.2, z: 2 }] }], node },
    { ...common, obstacleRoutes: [], futureConnections: [{ connectionName: "future", points: [{ x: -1, y: 1, z: 1 }] }], node: { ...node, x: 1.9 } },
  ]
  for (const { node: query, ...options } of cases) {
    const actual = new Future(options)
    const reference = new Future(options)
    expect(actual.getNeighbors(query)).toEqual(referenceGetNeighbors.call(reference, query))
    expect(actual.getNeighbors(query).filter(n => n.z !== query.z)).toHaveLength(0)
    for (const z of options.availableZ.filter(z => z !== query.z)) expect(actual.exploredNodes.has(actual.getNodeKey({ ...query, z }))).toBe(false)
  }
})
