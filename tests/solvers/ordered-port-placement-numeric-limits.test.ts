import { expect, test } from "bun:test"
import { placeOrderedPortsInClearanceIntervals } from "lib/solvers/UniformPortDistributionSolver/placeOrderedPortsInClearanceIntervals"

test("exact singleton bounds survive subnormal and signed-zero arithmetic while overflow fails", (): void => {
  const subnormalSpacing = 2 * Number.MIN_VALUE
  const subnormalPositions = placeOrderedPortsInClearanceIntervals({
    ports: [
      {
        allowedIntervals: [{ start: 0, end: 0 }],
        uniformTarget: 0,
        canonicalNetId: "first-net",
        copperDiameter: subnormalSpacing,
      },
      {
        allowedIntervals: [{ start: subnormalSpacing, end: subnormalSpacing }],
        uniformTarget: subnormalSpacing,
        canonicalNetId: "second-net",
        copperDiameter: subnormalSpacing,
      },
    ],
    traceGap: 0,
  })
  expect(subnormalPositions).toEqual([0, subnormalSpacing])
  const signedZeroPositions = placeOrderedPortsInClearanceIntervals({
    ports: [
      {
        allowedIntervals: [{ start: -0, end: -0 }],
        uniformTarget: -0,
        canonicalNetId: "shared-net",
        copperDiameter: 1,
      },
      {
        allowedIntervals: [{ start: -0, end: -0 }],
        uniformTarget: -0,
        canonicalNetId: "shared-net",
        copperDiameter: 1,
      },
    ],
    traceGap: 0,
  })
  expect(Object.is(signedZeroPositions[0], -0)).toBe(true)
  expect(Object.is(signedZeroPositions[1], -0)).toBe(true)
  expect((): number[] => {
    const positions = placeOrderedPortsInClearanceIntervals({
      ports: [
        {
          allowedIntervals: [{ start: -Number.MAX_VALUE, end: 0 }],
          uniformTarget: 0,
          canonicalNetId: "first-net",
          copperDiameter: 1,
        },
        {
          allowedIntervals: [
            { start: -Number.MAX_VALUE, end: -Number.MAX_VALUE },
          ],
          uniformTarget: -Number.MAX_VALUE,
          canonicalNetId: "second-net",
          copperDiameter: 1,
        },
      ],
      traceGap: 0,
    })
    return positions
  }).toThrow(
    "placeOrderedPortsInClearanceIntervals cannot represent a directed bound",
  )
})
