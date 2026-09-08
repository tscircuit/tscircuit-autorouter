import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import {
  createHdPeerClearanceOptions,
  createHdPeerNode,
} from "../fixtures/hdPeerClearance"

test("V6 scales its hard future-via threshold without changing the existing formula or net exclusion", (): void => {
  for (const scale of [undefined, 1, 0.25, 2]) {
    const q = scale ?? 1
    const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
      ...createHdPeerClearanceOptions(scale),
      futureConnections: [
        {
          connectionName: "foreign-net",
          points: [
            { x: -4 / q, y: 0, z: 0 },
            { x: 4 / q, y: 0, z: 0 },
          ],
        },
        {
          connectionName: "route-net",
          points: [
            { x: -4 / q, y: 1 / q, z: 1 },
            { x: 4 / q, y: 1 / q, z: 1 },
          ],
        },
      ],
    })
    // .6/2 + .2/2 + .1 = .5 physical; a via spans the future trace's layer.
    const blocked = createHdPeerNode(0, 0.45 / q, 1)
    expect(solver.isViaTooCloseToFutureConnectionTrace(blocked)).toBeTrue()
    expect(solver.isNodeTooCloseToObstacle(blocked, 0, true)).toBeTrue()
    expect(solver.isNodeTooCloseToObstacle(blocked, 0, false)).toBeFalse()
    expect(
      solver.isViaTooCloseToFutureConnectionTrace(
        createHdPeerNode(0, 0.6 / q, 1),
      ),
    ).toBeFalse()
    expect(
      solver.isViaTooCloseToFutureConnectionTrace(
        createHdPeerNode(0, 1 / q, 1),
      ),
    ).toBeFalse()
    expect(solver.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE).toBe(0.1)
    expect(solver.NEARBY_SEGMENT_CLEARANCE).toBe(0.2)
  }
})
