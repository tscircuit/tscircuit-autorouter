import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import {
  createHdPeerClearanceOptions,
  createHdPeerNode,
} from "../fixtures/hdPeerClearance"

test("expanded peer point queries use physical widths and physical explicit margins", (): void => {
  const peer: HighDensityIntraNodeRoute = {
    connectionName: "foreign-net",
    traceThickness: 0.2,
    viaDiameter: 0.6,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }
  const solver = new SingleHighDensityRouteSolver({
    ...createHdPeerClearanceOptions(0.25),
    obstacleRoutes: [peer],
  })
  const legacy = new SingleHighDensityRouteSolver({
    ...createHdPeerClearanceOptions(undefined),
    obstacleRoutes: [peer],
  })
  const blocked = createHdPeerNode(0, 0.8, 0, createHdPeerNode(-1, 0.8))
  const query = solver.getPlanarObstacleQuery(blocked)
  expect(query?.segmentIds).toEqual([0])
  expect(solver.isNodeTooCloseToObstacle(blocked)).toBeTrue()
  expect(
    solver.isNodeTooCloseToObstacle(blocked, undefined, false, query),
  ).toBeTrue()
  expect(legacy.isNodeTooCloseToObstacle(blocked)).toBeFalse()
  // At q=.25 the physical .2 trace threshold becomes .8 in solve space.
  const explicitMarginPoint = createHdPeerNode(0, 0.85)
  expect(solver.isNodeTooCloseToObstacle(explicitMarginPoint, 0)).toBeFalse()
  expect(solver.isNodeTooCloseToObstacle(explicitMarginPoint, 0.025)).toBeTrue()
  expect(
    solver.isNodeTooCloseToObstacle(createHdPeerNode(0, 1.6)),
  ).toBeFalse()
  expect(
    solver.isNodeTooCloseToObstacle(createHdPeerNode(0, 0.8, 1)),
  ).toBeFalse()
  expect(solver.traceThickness).toBe(0.2)
  expect(solver.obstacleMargin).toBe(0.1)
})
