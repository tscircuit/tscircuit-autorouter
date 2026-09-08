import { expect, test } from "bun:test"
import { placeOrderedPortsInClearanceIntervals } from "lib/solvers/UniformPortDistributionSolver/placeOrderedPortsInClearanceIntervals"

test("a singleton anchor remains fixed while both neighboring ports keep clearance", (): void => {
  const positions = placeOrderedPortsInClearanceIntervals({
    ports: [
      {
        allowedIntervals: [{ start: 0, end: 10 }],
        uniformTarget: 5,
        canonicalNetId: "left-net",
        copperDiameter: 1,
      },
      {
        allowedIntervals: [{ start: 5, end: 5 }],
        uniformTarget: 9,
        canonicalNetId: "fixed-net",
        copperDiameter: 2,
      },
      {
        allowedIntervals: [{ start: 0, end: 10 }],
        uniformTarget: 5,
        canonicalNetId: "right-net",
        copperDiameter: 1,
      },
    ],
    traceGap: 0.5,
  })
  expect(positions).toEqual([3, 5, 7])
  expect(positions[1]).toBe(5)
  expect(positions[1] - positions[0]).toBe(2)
  expect(positions[2] - positions[1]).toBe(2)
})
