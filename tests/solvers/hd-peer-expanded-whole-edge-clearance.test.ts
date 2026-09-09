import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import {
  createHdPeerClearanceOptions,
  createHdPeerNode,
} from "../fixtures/hdPeerClearance"

test("expanded whole-edge clearance includes an interior peer outside the old broad phase", (): void => {
  const solver = new SingleHighDensityRouteSolver({
    ...createHdPeerClearanceOptions(0.25),
    nearbySegmentClearance: 0.25,
    obstacleRoutes: [
      {
        connectionName: "foreign-net",
        traceThickness: 0.2,
        viaDiameter: 0.6,
        route: [
          { x: -0.1, y: 0.6, z: 0 },
          { x: 0.1, y: 0.6, z: 0 },
        ],
        vias: [],
      },
    ],
  })
  const parent = createHdPeerNode(-2, 0)
  const blocked = createHdPeerNode(2, 0, 0, parent)
  const query = solver.getPlanarObstacleQuery(blocked)
  expect(solver.isNodeTooCloseToObstacle(parent)).toBeFalse()
  expect(solver.isNodeTooCloseToObstacle(blocked)).toBeFalse()
  expect(query?.segmentIds).toEqual([0])
  expect(solver.doesPathToParentIntersectObstacle(blocked)).toBeTrue()
  expect(solver.doesPathToParentIntersectObstacle(blocked, query)).toBeTrue()
  const clear = createHdPeerNode(2, -0.8, 0, createHdPeerNode(-2, -0.8))
  expect(solver.doesPathToParentIntersectObstacle(clear)).toBeFalse()
  expect(
    solver.doesPathToParentIntersectObstacle(
      clear,
      solver.getPlanarObstacleQuery(clear),
    ),
  ).toBeFalse()
  expect(solver.NEARBY_SEGMENT_CLEARANCE).toBe(0.25)
})
