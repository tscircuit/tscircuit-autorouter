import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import {
  createHdPeerClearanceOptions,
  createHdPeerNode,
} from "../fixtures/hdPeerClearance"

test("contraction scales peer thresholds down while unit scale retains legacy predicates", (): void => {
  for (const scale of [undefined, 1, 2]) {
    const solver = new SingleHighDensityRouteSolver({
      ...createHdPeerClearanceOptions(scale),
      nearbySegmentClearance: 0.25,
      obstacleRoutes: [
        {
          connectionName: "foreign-net",
          traceThickness: 0.2,
          viaDiameter: 0.6,
          route: [
            { x: -2, y: 0, z: 0 },
            { x: 2, y: 0, z: 0 },
          ],
          vias: [],
        },
      ],
    })
    expect(
      [0.1, 0.2, 0.4].map((y: number): boolean =>
        solver.isNodeTooCloseToObstacle(createHdPeerNode(0, y)),
      ),
    ).toEqual(scale === 2 ? [true, false, false] : [true, true, false])
    const edge = createHdPeerNode(1, 0.2, 0, createHdPeerNode(-1, 0.2))
    const query = solver.getPlanarObstacleQuery(edge)
    expect(solver.doesPathToParentIntersectObstacle(edge)).toBe(scale !== 2)
    expect(solver.doesPathToParentIntersectObstacle(edge, query)).toBe(
      scale !== 2,
    )
    expect(
      solver.isNodeTooCloseToObstacle(edge, undefined, false, query),
    ).toBe(scale !== 2)
    expect(solver.traceThickness).toBe(0.2)
    expect(solver.viaDiameter).toBe(0.6)
  }
})
