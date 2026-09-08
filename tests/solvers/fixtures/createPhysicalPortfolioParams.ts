import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import type { IntraNodePhysicalClearanceContext } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

export type PhysicalPortfolioParams = ConstructorParameters<
  typeof PortfolioSingleIntraNodeSolver
>[0] & {
  physicalClearanceContext: IntraNodePhysicalClearanceContext
  layerCount: number
}

export const createPhysicalPortfolioParams = (): PhysicalPortfolioParams => {
  const traceClearanceIndex = new FixedCopperClearanceIndex({
    rectangles: [],
    layerCount: 2,
    minClearance: 0.1,
  })
  const viaClearanceIndex = new FixedCopperClearanceIndex({
    rectangles: [],
    layerCount: 2,
    minClearance: 0.15,
  })
  return {
    nodeWithPortPoints: {
      capacityMeshNodeId: "physical-portfolio-node",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints: [
        { connectionName: "signal", x: -1, y: 0, z: 0 },
        { connectionName: "signal", x: 1, y: 0, z: 0 },
      ],
    },
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.1,
    layerCount: 2,
    cacheProvider: null,
    physicalClearanceContext: {
      traceClearanceIndex,
      viaClearanceIndex,
      traceToTraceClearance: 0.1,
      viaToTraceClearance: 0.1,
      canonicalNetIdByConnectionName: new Map([["signal", "net-signal"]]),
      solveToPhysicalTransform: { center: { x: 0, y: 0 }, scale: 1 },
    },
  }
}
