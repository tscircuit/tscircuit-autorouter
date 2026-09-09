import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import {
  createHdPeerClearanceOptions,
  createHdPeerNode,
} from "../fixtures/hdPeerClearance"

test("physical grid edges check peer vias even without a peer trace index", (): void => {
  for (const scale of [undefined, 1, 0.25, 2]) {
    const q = scale ?? 1
    for (const z of [0, 1]) {
      const solver = new SingleHighDensityRouteSolver({
        ...createHdPeerClearanceOptions(scale),
        bounds: {
          minX: -4 / q,
          maxX: 4 / q,
          minY: -4 / q,
          maxY: 4 / q,
        },
        A: { x: -4 / q, y: 0, z },
        B: { x: -2 / q, y: 0, z },
        traceThickness: 0.15,
        viaDiameter: 0.3,
        obstacleMargin: 0.15,
        availableZ: [z],
        minDistBetweenEnteringPoints: 0.8 / q,
        obstacleRoutes: [
          {
            connectionName: "foreign-net",
            traceThickness: 0.15,
            viaDiameter: 0.3,
            route: [
              { x: -3.6 / q, y: 0.3 / q, z: 0 },
              { x: -3.6 / q, y: 0.3 / q, z: 1 },
            ],
            vias: [{ x: -3.6 / q, y: 0.3 / q }],
          },
        ],
      })
      const parent = createHdPeerNode(-4 / q, 0, z)
      const endpoint = createHdPeerNode(-3.2 / q, 0, z, parent)
      // The via spans both tested layers. At q=1 each endpoint is .5 from
      // its center, but edge copper gap is .3 - .15 - .075 = .075 < .1.
      expect(solver.cellStep).toBe(0.8 / q)
      expect(solver.obstacleSegments).toHaveLength(0)
      expect(solver.obstacleSegmentIndex).toBeNull()
      expect(solver.obstacleSegmentIndexByLayer.size).toBe(0)
      expect(solver.obstacleViaIndex).not.toBeNull()
      expect(solver.getPlanarObstacleQuery(endpoint)).toBeUndefined()
      expect(solver.isNodeTooCloseToObstacle(parent)).toBeFalse()
      expect(solver.isNodeTooCloseToObstacle(endpoint)).toBeFalse()
      expect(solver.doesPathToParentIntersectObstacle(endpoint)).toBe(
        scale !== undefined,
      )
      expect(
        solver
          .getNeighbors(parent)
          .some(
            (node: Node): boolean =>
              node.x === endpoint.x && node.y === endpoint.y && node.z === z,
          ),
      ).toBe(scale === undefined)
      const clear = createHdPeerNode(
        -3.2 / q,
        -0.2 / q,
        z,
        createHdPeerNode(-4 / q, -0.2 / q, z),
      )
      expect(solver.doesPathToParentIntersectObstacle(clear)).toBeFalse()
      if (scale !== undefined) {
        expect(
          solver.exploredNodes.has(solver.getNodeKey(endpoint)),
        ).toBeFalse()
      }
    }
  }
})
