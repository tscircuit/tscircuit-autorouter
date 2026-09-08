import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import {
  createHdPeerClearanceOptions,
  createHdPeerNode,
} from "../fixtures/hdPeerClearance"

test("physical terminal departure preserves an exact legal copper gap despite a larger search point margin", (): void => {
  for (const scale of [undefined, 1, 0.25, 2]) {
    const q = scale ?? 1
    const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
      ...createHdPeerClearanceOptions(scale),
      bounds: { minX: 0, maxX: 8 / q, minY: -4 / q, maxY: 4 / q },
      A: { x: 0, y: 0, z: 0 },
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
            { x: 0, y: 0.25 / q, z: 0 },
            { x: 0.2 / q, y: 0.25 / q, z: 0 },
            { x: 0.2 / q, y: 2 / q, z: 0 },
          ],
          vias: [],
        },
      ],
    })
    const parent = createHdPeerNode(0, 0)
    const endpoint = createHdPeerNode(0.8 / q, 0, 0, parent)
    // Fixed terminals can start inside the unchanged search point envelope.
    // Full-edge copper gap .25 - .15 = .1 must still permit departure.
    expect(solver.failed).toBeFalse()
    expect(solver.candidates.peek()).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(solver.cellStep).toBe(0.8 / q)
    expect(solver.isNodeTooCloseToObstacle(parent)).toBeTrue()
    expect(solver.isNodeTooCloseToObstacle(endpoint)).toBeFalse()
    expect(solver.doesPathToParentIntersectObstacle(endpoint)).toBeFalse()
    expect(
      solver.doesPathToParentIntersectObstacle(
        endpoint,
        solver.getPlanarObstacleQuery(endpoint),
      ),
    ).toBeFalse()
    expect(
      solver
        .getNeighbors(parent)
        .some(
          (node: Node): boolean =>
            node.x === endpoint.x && node.y === endpoint.y && node.z === 0,
        ),
    ).toBeTrue()
  }
})
