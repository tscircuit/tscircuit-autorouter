import { expect, test } from "bun:test"
import { getFixedRouteBlockedIntervals } from "lib/solvers/UniformPortDistributionSolver/getFixedRouteBlockedIntervals"
import type { SharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"

test("declared decimal parallel contact remains legal without moving coordinates or hiding real penetration", () => {
  const sharedEdge: SharedEdge = { ownerNodeIds: ["lower", "upper"], ownerPairKey: "lower|upper", orientation: "horizontal",
    x1: -32.98749999999999, x2: -31.900000000000002, y1: 21.975, y2: 21.975,
    length: -31.900000000000002 - -32.98749999999999, center: { x: -32.44375, y: 21.975 }, nodeSideByOwnerId: {} }
  const intervalAt = (y: number) => getFixedRouteBlockedIntervals({ sharedEdge, z: 0, netId: "foreign", traceWidth: 0.15, clearance: 0.15,
    netByConnectionName: new Map([["fixed", "owner"]]),
    fixedRoutes: [{ connectionName: "fixed", traceThickness: 0.2, viaDiameter: 0.3, vias: [], route: [
      { x: -33.063, y, z: 0 }, { x: -31.212, y, z: 0 },
    ] }],
  })
  expect(Math.abs(22.3 - 21.975)).toBeLessThan((0.2 + 0.15) / 2 + 0.15)
  expect(intervalAt(22.3)).toEqual([])
  expect(intervalAt(22.29999999)).toHaveLength(1)
  expect(intervalAt(22.30000001)).toEqual([])
})
