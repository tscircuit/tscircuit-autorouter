import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

class PerNeighborQuerySolver extends SingleHighDensityRouteSolver {
  override getPlanarNeighborObstacleQuery(): undefined {
    return undefined
  }
}

class PerNeighborFutureQuerySolver extends SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost {
  override getPlanarNeighborObstacleQuery(): undefined {
    return undefined
  }
}

function createObstacles(centerX: number): HighDensityIntraNodeRoute[] {
  const routes: HighDensityIntraNodeRoute[] = []
  for (let index = 0; index < 64; index++) {
    const x = centerX + ((index % 8) - 4) * 0.19
    const y = (Math.floor(index / 8) - 4) * 0.17
    const z = index % 3
    routes.push({
      connectionName: index % 7 === 0 ? "connected" : `obstacle-${index}`,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x, y, z },
        { x: x + (index % 2 === 0 ? 0.05 : 0.27), y: y + 0.03, z },
      ],
      vias: index % 3 === 0 ? [{ x, y }] : [],
    })
  }
  routes.push({
    connectionName: "touching-bound",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: centerX - 0.2 - 0.15, y: -0.1, z: 0 },
      { x: centerX - 0.2 - 0.15, y: 0.1, z: 0 },
    ],
    vias: [],
  })
  return routes
}

test("shared planar broadphase preserves per-neighbor decisions and query bounds", (): void => {
  let comparedNeighborhoods = 0
  for (const [SharedSolver, ReferenceSolver] of [
    [SingleHighDensityRouteSolver, PerNeighborQuerySolver],
    [
      SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
      PerNeighborFutureQuerySolver,
    ],
  ] as const) {
    for (const centerX of [0, -100]) {
      for (const clearance of [0, 0.01, 0.15, 0.3, 0.6]) {
        for (const cellStep of [0.05, 0.2, 1]) {
          const params = {
            connectionName: "current",
            obstacleRoutes: createObstacles(centerX),
            minDistBetweenEnteringPoints: 0.2,
            bounds: {
              minX: centerX - 1,
              maxX: centerX + 1,
              minY: -1,
              maxY: 1,
            },
            A: { x: centerX - 1, y: -1, z: 0 },
            B: { x: centerX + 1, y: 1, z: 0 },
            traceThickness: 0.05,
            obstacleMargin: 0.1,
            nearbySegmentClearance: clearance,
            availableZ: [0, 1, 2, 3],
            layerCount: 4,
            futureConnections: [
              {
                connectionName: "future",
                points: [
                  { x: centerX - 0.7, y: 0.25, z: 1 },
                  { x: centerX + 0.7, y: 0.25, z: 1 },
                ],
              },
            ],
            connMap: {
              areIdsConnected: (_left: string, right: string): boolean =>
                right === "connected",
            } as any,
          }
          const shared = new SharedSolver(params)
          const reference = new ReferenceSolver(params)
          shared.cellStep = reference.cellStep = cellStep
          for (const [x, y, z] of [
            [centerX, 0, 0],
            [centerX - 1, -1, 0],
            [centerX + 1, 1, 1],
            [centerX + 0.23, -0.27, 2],
            [centerX + 0.23, -0.27, 3],
          ]) {
            shared.exploredNodes.clear()
            reference.exploredNodes.clear()
            shared.debug_nodesTooCloseToObstacle.clear()
            reference.debug_nodesTooCloseToObstacle.clear()
            shared.debug_nodePathToParentIntersectsObstacle.clear()
            reference.debug_nodePathToParentIntersectsObstacle.clear()
            const node: Node = {
              x,
              y,
              z,
              g: 2,
              h: 3,
              f: 5,
              parent: {
                x,
                y,
                z: (z + 1) % 4,
                g: 1,
                h: 2,
                f: 3,
                parent: null,
              },
            }
            const excludedNeighbor = {
              ...node,
              x: x - cellStep,
              y: y + cellStep,
            }
            shared.exploredNodes.add(shared.getNodeKey(excludedNeighbor))
            reference.exploredNodes.add(reference.getNodeKey(excludedNeighbor))
            expect(shared.getNeighbors(node)).toEqual(
              reference.getNeighbors(node),
            )
            expect([...shared.exploredNodes]).toEqual([
              ...reference.exploredNodes,
            ])
            expect([...shared.debug_nodesTooCloseToObstacle]).toEqual([
              ...reference.debug_nodesTooCloseToObstacle,
            ])
            expect([
              ...shared.debug_nodePathToParentIntersectsObstacle,
            ]).toEqual([...reference.debug_nodePathToParentIntersectsObstacle])
            comparedNeighborhoods++
          }
        }
      }
    }
  }
  expect(comparedNeighborhoods).toBe(300)

  const options = {
    connectionName: "query-count",
    obstacleRoutes: createObstacles(0),
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -1, y: -1, z: 0 },
    B: { x: 1, y: 1, z: 0 },
    traceThickness: 0.05,
    obstacleMargin: 0.1,
    availableZ: [0],
  }
  const solver = new SingleHighDensityRouteSolver(options)
  const layerIndex = solver.obstacleSegmentIndexByLayer.get(0)!
  const search = layerIndex.search.bind(layerIndex)
  let searchCalls = 0
  layerIndex.search = (...args: Parameters<typeof search>): number[] => {
    searchCalls++
    return search(...args)
  }
  solver.getNeighbors({
    x: 0,
    y: 0,
    z: 0,
    g: 0,
    h: 0,
    f: 0,
    parent: null,
  })
  expect(searchCalls).toBe(1)
})
