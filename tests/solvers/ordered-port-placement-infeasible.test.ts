import { expect, test } from "bun:test"
import {
  type OrderedPhysicalPort,
  placeOrderedPortsInClearanceIntervals,
} from "lib/solvers/UniformPortDistributionSolver/placeOrderedPortsInClearanceIntervals"

test("incompatible closed intervals fail with the constrained port named", (): void => {
  const ports: OrderedPhysicalPort[] = [
    {
      allowedIntervals: [{ start: 0, end: 0 }],
      uniformTarget: 0,
      canonicalNetId: "first-net",
      copperDiameter: 1,
    },
    {
      allowedIntervals: [{ start: 0.5, end: 0.5 }],
      uniformTarget: 0.5,
      canonicalNetId: "second-net",
      copperDiameter: 1,
    },
  ]
  const originalPorts = structuredClone(ports)
  expect((): number[] => {
    const positions = placeOrderedPortsInClearanceIntervals({
      ports,
      traceGap: 0,
    })
    return positions
  }).toThrow(
    "placeOrderedPortsInClearanceIntervals: infeasible ordered placement at port 0",
  )
  expect(ports).toEqual(originalPorts)
})
