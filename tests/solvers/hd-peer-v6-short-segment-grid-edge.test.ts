import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import {
  createHdPeerClearanceOptions,
  createHdPeerNode,
} from "../fixtures/hdPeerClearance"

test("physical V6 grid edges reject short peer copper between clear endpoints", (): void => {
  for (const scale of [undefined, 1, 0.25, 2]) {
    const q = scale ?? 1
    for (const peerLayer of [0, 1]) {
      const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
        ...createHdPeerClearanceOptions(scale),
        bounds: {
          minX: -4 / q,
          maxX: 4 / q,
          minY: -4 / q,
          maxY: 4 / q,
        },
        A: { x: -0.4 / q, y: 0, z: 0 },
        B: { x: 3 / q, y: 0, z: 0 },
        traceThickness: 0.15,
        viaDiameter: 0.3,
        obstacleMargin: 0.15,
        availableZ: [0],
        minDistBetweenEnteringPoints: 0.8 / q,
        obstacleRoutes: [
          {
            connectionName: "foreign-net",
            traceThickness: 0.15,
            viaDiameter: 0.3,
            route: [
              { x: -0.1 / q, y: 0.24 / q, z: peerLayer },
              { x: 0.1 / q, y: 0.24 / q, z: peerLayer },
            ],
            vias: [],
          },
        ],
      })
      const parent = createHdPeerNode(-0.4 / q, 0)
      const endpoint = createHdPeerNode(0.4 / q, 0, 0, parent)
      const query = solver.getPlanarObstacleQuery(endpoint)
      const blocked = scale !== undefined && peerLayer === 0
      // At q=1 this is a native .8 grid step. The same-layer copper gap
      // is .24 - .15 = .09, below the .1 rule, despite clear endpoints.
      expect(solver.cellStep).toBe(0.8 / q)
      expect(solver.isNodeTooCloseToObstacle(parent)).toBeFalse()
      expect(solver.isNodeTooCloseToObstacle(endpoint)).toBeFalse()
      expect(solver.doesPathToParentIntersectObstacle(endpoint)).toBe(blocked)
      expect(solver.doesPathToParentIntersectObstacle(endpoint, query)).toBe(
        blocked,
      )
      expect(
        solver.getNeighbors(parent).some(
          (node: Node): boolean =>
            node.x === endpoint.x && node.y === endpoint.y && node.z === 0,
        ),
      ).toBe(!blocked)
      if (blocked) {
        expect(query?.segmentIds).toEqual([0])
        expect(
          solver.exploredNodes.has(solver.getNodeKey(endpoint)),
        ).toBeFalse()
      }
    }
  }
})
