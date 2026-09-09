import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import {
  createHdPeerClearanceOptions,
  createHdPeerNode,
} from "../fixtures/hdPeerClearance"

test("physical point defaults route a minimum-clearance corridor on the native small grid", (): void => {
  for (const Solver of [
    SingleHighDensityRouteSolver,
    SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
  ]) {
    for (const scale of [undefined, 1, 0.25, 2]) {
      const q = scale ?? 1
      const solver = new Solver({
        ...createHdPeerClearanceOptions(scale),
        bounds: {
          minX: -4 / q,
          maxX: 4 / q,
          minY: -4 / q,
          maxY: 4 / q,
        },
        A: { x: 0, y: 0, z: 0 },
        B: { x: 2 / q, y: 0, z: 0 },
        traceThickness: 0.15,
        viaDiameter: 0.3,
        obstacleMargin: 0.15,
        availableZ: [0],
        minDistBetweenEnteringPoints: 0.05,
        obstacleRoutes: [-1, 1].map(
          (side: number): HighDensityIntraNodeRoute => ({
            connectionName: `foreign-net-${side}`,
            traceThickness: 0.15,
            viaDiameter: 0.3,
            route: [
              { x: -3 / q, y: (side * 0.25) / q, z: 0 },
              { x: 3 / q, y: (side * 0.25) / q, z: 0 },
            ],
            vias: [],
          }),
        ),
      })
      const parent = createHdPeerNode(0, 0)
      const endpoint = createHdPeerNode(0.05, 0, 0, parent)
      const query = solver.getPlanarObstacleQuery(endpoint)
      expect(solver.cellStep).toBe(0.05)
      expect(solver.failed).toBeFalse()
      expect(solver.isNodeTooCloseToObstacle(endpoint)).toBe(
        scale === undefined,
      )
      expect(
        solver.isNodeTooCloseToObstacle(endpoint, undefined, false, query),
      ).toBe(scale === undefined)
      // Explicit physical margin overrides keep their existing meaning.
      expect(solver.isNodeTooCloseToObstacle(endpoint, 0.15)).toBeTrue()
      expect(solver.isNodeTooCloseToObstacle(endpoint, 0.1)).toBeFalse()
      expect(solver.doesPathToParentIntersectObstacle(endpoint)).toBeFalse()
      expect(
        solver.doesPathToParentIntersectObstacle(endpoint, query),
      ).toBeFalse()
      const neighbors = solver.getNeighbors(parent)
      expect(
        neighbors.some(
          (node: Node): boolean =>
            node.x === endpoint.x && node.y === 0 && node.z === 0,
        ),
      ).toBe(scale !== undefined)
      if (scale === undefined) {
        expect(neighbors).toHaveLength(0)
        solver.solve()
        expect(solver.solved).toBeFalse()
        expect(solver.failed).toBeTrue()
        expect(solver.error).toBe("Ran out of candidate nodes to explore")
        continue
      }

      solver.solve()
      expect(solver.failed).toBeFalse()
      expect(solver.error).toBeNull()
      expect(solver.solved).toBeTrue()
      const route = solver.solvedPath
      if (route === null) throw new Error("Expected a solved corridor route")
      expect(route.route[0]).toEqual(solver.A)
      expect(route.route.at(-1)).toEqual(solver.B)
      expect(route.route.length).toBeGreaterThan(2)
      expect(route.traceThickness).toBe(0.15)
      expect(route.viaDiameter).toBe(0.3)
      expect(route.vias).toEqual([])
      for (const point of route.route) {
        expect(point.z).toBe(0)
        expect(point.y).toBe(0)
        expect(point.x).toBeGreaterThanOrEqual(0)
        expect(point.x).toBeLessThanOrEqual(2 / q)
        // All route edges are horizontal inside both peer spans, so their
        // whole-segment copper gaps equal these exact endpoint gaps.
        for (const side of [-1, 1]) {
          expect(
            Math.abs(point.y * q - side * 0.25) - route.traceThickness,
          ).toBe(0.1)
        }
      }
    }
  }
})
