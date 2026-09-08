import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import {
  createHdPeerClearanceOptions,
  createHdPeerNode,
} from "../fixtures/hdPeerClearance"

test("physical border margins preserve only the existing trace terminal exception", (): void => {
  for (const scale of [undefined, 1, 0.25, 2]) {
    const q = scale ?? 1
    const solver = new SingleHighDensityRouteSolver({
      ...createHdPeerClearanceOptions(scale),
      A: { x: -10 / q, y: 0, z: 0 },
      B: { x: 10 / q, y: 0, z: 0 },
    })
    const nearBorder = createHdPeerNode(-9.96 / q, 2 / q)
    const nearTerminal = createHdPeerNode(-9.96 / q, 0.02 / q)
    expect(solver.isNodeTooCloseToEdge(nearBorder, false)).toBeTrue()
    expect(solver.isNodeTooCloseToEdge(nearTerminal, false)).toBeFalse()
    expect(solver.isNodeTooCloseToEdge(nearTerminal, true)).toBeTrue()
    expect(
      solver.isNodeTooCloseToEdge(createHdPeerNode(-9.94 / q, 2 / q), false),
    ).toBeFalse()
    expect(
      solver.isNodeTooCloseToEdge(createHdPeerNode(-9.7 / q, 2 / q), true),
    ).toBeTrue()
    expect(
      solver.isNodeTooCloseToEdge(createHdPeerNode(-9.6 / q, 2 / q), true),
    ).toBeFalse()
  }
})
