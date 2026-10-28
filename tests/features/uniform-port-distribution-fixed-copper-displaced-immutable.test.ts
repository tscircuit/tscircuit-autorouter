import { expect, test } from "bun:test"
import { redistributePortPointsWithFixedRoutes } from "lib/solvers/UniformPortDistributionSolver/redistributePortPointsWithFixedRoutes"
import type { PortPointWithOwnerPair, SharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"

test("immutable displaced crossings are checked at their actual coordinates and remain exact", () => {
  const sharedEdge: SharedEdge = {
    ownerNodeIds: ["lower", "upper"], ownerPairKey: "lower|upper", orientation: "horizontal",
    x1: 0, x2: 10, y1: 0, y2: 0, length: 10, center: { x: 5, y: 0 },
    nodeSideByOwnerId: { lower: "top", upper: "bottom" },
  }
  const point: PortPointWithOwnerPair = {
    portPointId: "immutable", connectionName: "foreign", x: 5, y: 2, z: 0,
    ownerNodeIds: ["lower", "upper"], ownerPairKey: "lower|upper",
  }
  const fixedCopper = {
    routes: [{
      connectionName: "fixed", traceThickness: 1, viaDiameter: 0.6, vias: [],
      route: [{ x: 4, y: 2, z: 0 }, { x: 6, y: 2, z: 0 }],
    }],
    netByConnectionName: new Map([["fixed", "fixed-net"], ["foreign", "foreign-net"]]),
    traceWidthByConnectionName: new Map([["foreign", 1]]), clearance: 0,
  }
  expect(() => redistributePortPointsWithFixedRoutes({
    sharedEdge, portPoints: [point], movablePortIds: new Set(), fixedCopper,
  })).toThrow('cannot preserve immutable port "immutable"')
  const safeCopper = { ...fixedCopper, routes: fixedCopper.routes.map((route) => ({
    ...route, route: route.route.map((position) => ({ ...position, y: 0 })),
  })) }
  expect(redistributePortPointsWithFixedRoutes({
    sharedEdge, portPoints: [point], movablePortIds: new Set(), fixedCopper: safeCopper,
  })).toEqual([point])
  expect(point).toMatchObject({ x: 5, y: 2 })
})
