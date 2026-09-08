import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import {
  createHdPeerClearanceOptions,
  createHdPeerNode,
} from "../fixtures/hdPeerClearance"

test("peer and own-route vias retain their distinct physical clearance formulas", (): void => {
  for (const scale of [undefined, 1, 0.25, 2]) {
    const q = scale ?? 1
    const peerSolver = new SingleHighDensityRouteSolver({
      ...createHdPeerClearanceOptions(scale),
      obstacleRoutes: [
        {
          connectionName: "foreign-net",
          traceThickness: 0.2,
          viaDiameter: 0.6,
          route: [
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
          ],
          vias: [{ x: 0, y: 0 }],
        },
      ],
    })
    // Existing peer threshold is via/2 + trace/2 + margin = .5 physical.
    expect(
      peerSolver.isNodeTooCloseToObstacle(createHdPeerNode(0.4 / q, 0)),
    ).toBeTrue()
    expect(
      peerSolver.isNodeTooCloseToObstacle(createHdPeerNode(0.6 / q, 0)),
    ).toBeFalse()

    const ownSolver = new SingleHighDensityRouteSolver(
      createHdPeerClearanceOptions(scale),
    )
    const viaStart = createHdPeerNode(0, 0)
    const viaEnd = createHdPeerNode(0, 0, 1, viaStart)
    const parent = createHdPeerNode(2 / q, 0, 1, viaEnd)
    const blocked = createHdPeerNode(0.35 / q, 0, 0, parent)
    expect(ownSolver.getViasInNodePath(parent)).toEqual([{ x: 0, y: 0 }])
    // Existing own threshold is via/2 + margin = .4 physical, not .5.
    expect(ownSolver.isNodeTooCloseToObstacle(blocked, 0.1, true)).toBeTrue()
    expect(ownSolver.isNodeTooCloseToObstacle(blocked, 0, true)).toBeFalse()
    expect(ownSolver.isNodeTooCloseToObstacle(blocked, 0.1, false)).toBeFalse()
    expect(
      ownSolver.isNodeTooCloseToObstacle(
        createHdPeerNode(0.45 / q, 0, 0, parent),
        0.1,
        true,
      ),
    ).toBeFalse()
  }
})
