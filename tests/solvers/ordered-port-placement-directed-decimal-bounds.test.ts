import { expect, test } from "bun:test"
import {
  type OrderedPhysicalPort,
  placeOrderedPortsInClearanceIntervals,
} from "lib/solvers/UniformPortDistributionSolver/placeOrderedPortsInClearanceIntervals"

test("directed decimal bounds preserve feasible spacing without a tolerance", (): void => {
  const cases = [
    {
      firstInterval: { start: 0.7, end: 0.7 },
      secondInterval: { start: 0.7, end: 1 },
      target: 0.7,
      expected: [0.7, 0.8],
    },
    {
      firstInterval: { start: 0, end: 0.8 },
      secondInterval: { start: 0.8, end: 0.8 },
      target: 0.8,
      expected: [0.7, 0.8],
    },
    {
      firstInterval: { start: -1, end: -0.7 },
      secondInterval: { start: -0.7, end: -0.7 },
      target: -0.7,
      expected: [-0.8, -0.7],
    },
    {
      firstInterval: { start: -0.8, end: -0.8 },
      secondInterval: { start: -0.8, end: 0 },
      target: -0.8,
      expected: [-0.8, -0.7],
    },
  ]
  for (const testCase of cases) {
    const ports: OrderedPhysicalPort[] = [
      {
        allowedIntervals: [testCase.firstInterval],
        uniformTarget: testCase.target,
        canonicalNetId: "first-net",
        copperDiameter: 0.1,
      },
      {
        allowedIntervals: [testCase.secondInterval],
        uniformTarget: testCase.target,
        canonicalNetId: "second-net",
        copperDiameter: 0.1,
      },
    ]
    const originalPorts = structuredClone(ports)
    const positions = placeOrderedPortsInClearanceIntervals({
      ports,
      traceGap: 0,
    })
    expect(positions).toEqual(testCase.expected)
    expect(positions[1] - positions[0]).toBeGreaterThanOrEqual(0.1)
    expect(ports).toEqual(originalPorts)
  }
})
