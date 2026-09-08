import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import {
  createHdPeerClearanceOptions,
  createHdPeerNode,
} from "../fixtures/hdPeerClearance"

test("physical V6 edges enforce actual copper rules while legacy edges retain their original margin", (): void => {
  for (const scale of [undefined, 1, 0.25, 2]) {
    const q = scale ?? 1
    const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
      ...createHdPeerClearanceOptions(scale),
      obstacleRoutes: [
        {
          connectionName: "foreign-net",
          traceThickness: 0.2,
          viaDiameter: 0.6,
          route: [
            { x: -0.2 / q, y: 0, z: 0 },
            { x: 0.2 / q, y: 0, z: 0 },
          ],
          vias: [],
        },
      ],
    })
    expect(solver.NEARBY_SEGMENT_CLEARANCE).toBe(0.2)
    for (const physicalSeparation of [0.18, 0.22, 0.35]) {
      const parent = createHdPeerNode(-2 / q, physicalSeparation / q)
      const endpoint = createHdPeerNode(
        2 / q,
        physicalSeparation / q,
        0,
        parent,
      )
      const query = solver.getPlanarObstacleQuery(endpoint)
      const blocked =
        physicalSeparation === 0.18 ||
        (scale !== undefined && physicalSeparation === 0.22)
      expect(solver.isNodeTooCloseToObstacle(parent)).toBeFalse()
      expect(solver.isNodeTooCloseToObstacle(endpoint)).toBeFalse()
      expect(solver.doesPathToParentIntersectObstacle(endpoint)).toBe(blocked)
      expect(solver.doesPathToParentIntersectObstacle(endpoint, query)).toBe(
        blocked,
      )
      if (blocked) {
        expect(query?.segmentIds).toEqual([0])
      }
    }
  }
})
