import { expect, test } from "bun:test"
import { redistributePortPointsWithFixedRoutes } from "lib/solvers/UniformPortDistributionSolver/redistributePortPointsWithFixedRoutes"
import type { PortPointWithOwnerPair, SharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"

test("allocation separates nonadjacent foreign copper when same-net crossings have unequal widths", () => {
  const sharedEdge: SharedEdge = {
    ownerNodeIds: ["lower", "upper"], ownerPairKey: "lower|upper", orientation: "horizontal",
    x1: 0, x2: 6, y1: 0, y2: 0, length: 6, center: { x: 3, y: 0 },
    nodeSideByOwnerId: { lower: "top", upper: "bottom" },
  }
  const points: PortPointWithOwnerPair[] = [1, 3, 5].map((x, index) => ({
    x, y: 0, z: 0, portPointId: `port-${index}`, connectionName: `trace-${index}`,
    ownerNodeIds: ["lower", "upper"], ownerPairKey: "lower|upper",
  }))
  const output = redistributePortPointsWithFixedRoutes({
    sharedEdge, portPoints: points, movablePortIds: new Set(["port-0", "port-2"]),
    fixedCopper: {
      routes: [{
        connectionName: "fixed", rootConnectionName: "a", traceThickness: 0.2, viaDiameter: 0.6, vias: [],
        route: [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }],
      }], clearance: 0.2,
      netByConnectionName: new Map([["trace-0", "a"], ["trace-1", "a"], ["trace-2", "b"], ["a", "a"]]),
      traceWidthByConnectionName: new Map([["trace-0", 4], ["trace-1", 0.1], ["trace-2", 4]]),
    },
  })
  expect(output[2]!.x - output[0]!.x).toBeGreaterThanOrEqual(4.2)
  expect(output[1]).toEqual(points[1]!)
  expect(output[2]!.x - output[1]!.x).toBeGreaterThanOrEqual(2.25)
})
