import { expect, test } from "bun:test"
import { placeOrderedPortsInClearanceIntervals } from "lib/solvers/UniformPortDistributionSolver/placeOrderedPortsInClearanceIntervals"

test("the backward reservation preserves a feasible suffix before choosing targets", (): void => {
  const positions = placeOrderedPortsInClearanceIntervals({
    ports: [
      {
        allowedIntervals: [
          { start: 3, end: 4 },
          { start: 0, end: 1 },
        ],
        uniformTarget: 4,
        canonicalNetId: "first-net",
        copperDiameter: 1,
      },
      {
        allowedIntervals: [{ start: 2, end: 3 }],
        uniformTarget: 3,
        canonicalNetId: "second-net",
        copperDiameter: 1,
      },
      {
        allowedIntervals: [{ start: 4, end: 4 }],
        uniformTarget: 4,
        canonicalNetId: "third-net",
        copperDiameter: 1,
      },
    ],
    traceGap: 1,
  })
  expect(positions).toEqual([0, 2, 4])
  expect(positions[1] - positions[0]).toBe(2)
  expect(positions[2] - positions[1]).toBe(2)
})
