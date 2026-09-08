import { expect, test } from "bun:test"
import { placeOrderedPortsInClearanceIntervals } from "lib/solvers/UniformPortDistributionSolver/placeOrderedPortsInClearanceIntervals"

test("closed singleton equality and same-net coincidence remain legal", (): void => {
  const positions = placeOrderedPortsInClearanceIntervals({
    ports: [
      {
        allowedIntervals: [{ start: 0, end: 0 }],
        uniformTarget: 0,
        canonicalNetId: "shared-net",
        copperDiameter: 1,
      },
      {
        allowedIntervals: [{ start: 0, end: 0 }],
        uniformTarget: 1,
        canonicalNetId: "shared-net",
        copperDiameter: 2,
      },
      {
        allowedIntervals: [{ start: 1.5, end: 1.5 }],
        uniformTarget: 1,
        canonicalNetId: "other-net",
        copperDiameter: 1,
      },
    ],
    traceGap: 0,
  })
  expect(positions).toEqual([0, 0, 1.5])
  expect(positions[2] - positions[1]).toBe(1.5)
  const tiedPosition = placeOrderedPortsInClearanceIntervals({
    ports: [
      {
        allowedIntervals: [
          { start: 2, end: 2 },
          { start: 0, end: 0 },
        ],
        uniformTarget: 1,
        canonicalNetId: "single-net",
        copperDiameter: 1,
      },
    ],
    traceGap: 0,
  })
  expect(tiedPosition).toEqual([0])
})
