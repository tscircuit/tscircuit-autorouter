import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import {
  createHdPeerClearanceOptions,
  createHdPeerNode,
} from "../fixtures/hdPeerClearance"

test("peer scaling leaves fixed-pad queries and emitted copper diameters physical", (): void => {
  const index = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        zLayers: [0, 1],
        ownerNetIds: new Set(["foreign-net"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.05,
  })
  for (const q of [0.25, 2]) {
    const solver = new SingleHighDensityRouteSolver({
      ...createHdPeerClearanceOptions(q),
      A: { x: -2 / q, y: 2 / q, z: 0 },
      B: { x: 2 / q, y: 2 / q, z: 1 },
      physicalClearanceContext: {
        traceClearanceIndex: index,
        viaClearanceIndex: index,
        traceToTraceClearance: 0.1,
        viaToTraceClearance: 0.1,
        canonicalNetId: "route-net",
        solveToPhysicalTransform: { center: { x: 0, y: 0 }, scale: q },
      },
    })
    const parent = createHdPeerNode(0.35 / q, 0)
    const nearPad = createHdPeerNode(0.35 / q, 0, 1, parent)
    expect(solver.isNodeTooCloseToObstacle(nearPad)).toBeFalse()
    expect(solver.isNodeTooCloseToObstacle(nearPad, undefined, true)).toBeTrue()
    expect(
      solver.isNodeTooCloseToObstacle(
        createHdPeerNode(0.5 / q, 0, 1, createHdPeerNode(0.5 / q, 0)),
        undefined,
        true,
      ),
    ).toBeFalse()

    // Exercise output materialization directly, not search-scale invariance.
    const start = createHdPeerNode(solver.A.x, solver.A.y)
    const viaStart = createHdPeerNode(0, 2 / q, 0, start)
    const viaEnd = createHdPeerNode(0, 2 / q, 1, viaStart)
    solver.setSolvedPath(viaEnd)
    expect(solver.solvedPath?.traceThickness).toBe(0.2)
    expect(solver.solvedPath?.viaDiameter).toBe(0.6)
    expect(solver.solvedPath?.vias).toEqual([{ x: 0, y: 2 / q }])
    expect(solver.solvedPath?.route).toEqual([
      solver.A,
      { x: 0, y: 2 / q, z: 0 },
      { x: 0, y: 2 / q, z: 1 },
      solver.B,
    ])
  }
})
