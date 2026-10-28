import { expect, test } from "bun:test"
import { redistributePortPointsWithFixedRoutes } from "lib/solvers/UniformPortDistributionSolver/redistributePortPointsWithFixedRoutes"
import type { PortPointWithOwnerPair, SharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"

test("fixed-copper allocation reports an impossible edge without relocating copper or accepting overlap", () => {
  const sharedEdge: SharedEdge = {
    ownerNodeIds: ["left", "right"], ownerPairKey: "left|right", orientation: "vertical",
    x1: 0, x2: 0, y1: 0, y2: 1, length: 1, center: { x: 0, y: 0.5 },
    nodeSideByOwnerId: { left: "right", right: "left" },
  }
  const point: PortPointWithOwnerPair = {
    portPointId: "foreign-port", connectionName: "foreign", x: 0, y: 0.8, z: 0,
    ownerNodeIds: ["left", "right"], ownerPairKey: "left|right",
  }
  const fixedCopper = {
    routes: [{
      connectionName: "fixed", traceThickness: 0.8, viaDiameter: 0.6, vias: [],
      route: [{ x: -1, y: 0.5, z: 0 }, { x: 1, y: 0.5, z: 0 }],
    }],
    netByConnectionName: new Map([["fixed", "fixed-net"], ["foreign", "foreign-net"]]),
    traceWidthByConnectionName: new Map([["foreign", 0.2]]), clearance: 0.15,
  }
  const originalRoutes = structuredClone(fixedCopper.routes)
  expect(() => redistributePortPointsWithFixedRoutes({
    sharedEdge, portPoints: [point], movablePortIds: new Set(["foreign-port"]), fixedCopper,
  })).toThrow('Fixed-copper port allocation on edge "left|right" layer 0 has no space for port "foreign-port"')
  expect(fixedCopper.routes).toEqual(originalRoutes)
  expect(point.y).toBe(0.8)
})
