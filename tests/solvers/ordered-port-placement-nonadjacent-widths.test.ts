import { expect, test } from "bun:test"
import {
  type OrderedPhysicalPort,
  placeOrderedPortsInClearanceIntervals,
} from "lib/solvers/UniformPortDistributionSolver/placeOrderedPortsInClearanceIntervals"

test("a narrow same-net neighbor does not hide a wider nonadjacent port", (): void => {
  const ports: OrderedPhysicalPort[] = [
    {
      allowedIntervals: [{ start: 0, end: 0 }],
      uniformTarget: 0,
      canonicalNetId: "first-net",
      copperDiameter: 4,
    },
    {
      allowedIntervals: [{ start: 1, end: 1 }],
      uniformTarget: 1,
      canonicalNetId: "first-net",
      copperDiameter: 0.5,
    },
    {
      allowedIntervals: [{ start: 1, end: 5 }],
      uniformTarget: 1.75,
      canonicalNetId: "second-net",
      copperDiameter: 0.5,
    },
  ]
  const originalPorts = structuredClone(ports)
  const positions = placeOrderedPortsInClearanceIntervals({
    ports,
    traceGap: 0.25,
  })
  expect(positions).toEqual([0, 1, 2.5])
  expect(positions[2] - positions[0]).toBe(2 + 0.25 + 0.25)
  expect(positions[2] - positions[1]).toBeGreaterThanOrEqual(0.75)
  expect(ports).toEqual(originalPorts)
})
