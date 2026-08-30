import { expect, test } from "bun:test"
import { findRouteGeometryViolations } from "@tscircuit/high-density-a01"
import {
  getInitialScaleFactorForHighPressureNode,
  HighDensitySolver,
} from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

const makeNode = ({
  pairCount,
  width,
  height,
  availableZ,
}: {
  pairCount: number
  width: number
  height: number
  availableZ?: number[]
}): NodeWithPortPoints => {
  const portPointsInPairs = Array.from({ length: pairCount }, (_, index) => {
    const connectionName = `connection_${index}`
    return [
      { connectionName, x: -width / 2, y: index, z: 0 },
      { connectionName, x: width / 2, y: index, z: 0 },
    ] as const
  })

  return {
    capacityMeshNodeId: "high_pressure_node",
    center: { x: 0, y: 0 },
    width,
    height,
    availableZ,
    portPoints: portPointsInPairs.flat(),
    portPointsInPairs: portPointsInPairs.map(([start, end]) => [start, end]),
  }
}

const makeForcedGrowthNode = (): NodeWithPortPoints => {
  const pairTuples = [
    [-2.96, -0.96, 0, -2.31, -0.96, 1, 0],
    [-2.31, -0.96, 1, -0.36, -0.96, 1, 0],
    [-0.36, -0.96, 1, 2.24, -0.96, 1, 0],
    [2.89, -0.96, 1, 3.11, 0.96, 0, 0],
    [-1.01, -0.96, 1, 4.42, -0.2, 1, 1],
    [-3.83, 0.96, 1, -3.61, -0.96, 1, 2],
    [3.54, -0.96, 0, 4.42, -0.54, 1, 3],
    [-1.98, 0.96, 0, -1.01, -0.96, 0, 4],
    [-1.01, -0.96, 0, 4.42, -0.37, 0, 4],
    [0.98, 0.96, 1, 0.29, -0.96, 1, 5],
    [3.54, 0.96, 1, 0.94, -0.96, 1, 6],
    [-0.36, -0.96, 0, -1.13, 0.96, 0, 7],
    [0.29, -0.96, 0, 0.98, 0.96, 0, 8],
    [-1.66, -0.96, 0, 3.98, 0.96, 0, 9],
  ] as const
  const portPointsInPairs: [PortPoint, PortPoint][] = pairTuples.map(
    ([x1, y1, z1, x2, y2, z2, rootIndex], index) => {
      const connectionName = `c${index}`
      const rootConnectionName = `r${rootIndex}`
      return [
        { connectionName, rootConnectionName, x: x1, y: y1, z: z1 },
        { connectionName, rootConnectionName, x: x2, y: y2, z: z2 },
      ]
    },
  )

  return {
    capacityMeshNodeId: "forced_growth_fixture",
    center: { x: 0, y: 0 },
    width: 8.83,
    height: 1.92,
    availableZ: [0, 1],
    portPoints: portPointsInPairs.flat(),
    portPointsInPairs,
  }
}

test("high-pressure nodes start grow/shrink routing at 2x", () => {
  const noCrossings = {
    numSameLayerCrossings: 0,
    numEntryExitLayerChanges: 0,
    numTransitionPairCrossings: 0,
  }
  const extremeCrossings = {
    ...noCrossings,
    numSameLayerCrossings: 30,
  }

  const highPfNode = makeNode({ pairCount: 9, width: 6, height: 6 })
  expect(
    getInitialScaleFactorForHighPressureNode(
      highPfNode,
      1,
      noCrossings,
    ),
  ).toBe(2)

  const denseNode = makeNode({ pairCount: 14, width: 4, height: 4 })
  expect(
    getInitialScaleFactorForHighPressureNode(denseNode, 0.7, noCrossings),
  ).toBe(2)

  const roomyNode = makeNode({ pairCount: 16, width: 5.5, height: 4 })
  expect(
    getInitialScaleFactorForHighPressureNode(roomyNode, 0.9, {
      ...noCrossings,
      numSameLayerCrossings: 13,
      numEntryExitLayerChanges: 6,
      numTransitionPairCrossings: 2,
    }),
  ).toBe(1)

  const twoLayerNode = makeNode({
    pairCount: 18,
    width: 10,
    height: 10,
    availableZ: [0, 1],
  })
  expect(
    getInitialScaleFactorForHighPressureNode(
      twoLayerNode,
      0.2,
      extremeCrossings,
    ),
  ).toBe(2)

  const sixLayerNode = { ...twoLayerNode, availableZ: [0, 1, 2, 3, 4, 5] }
  expect(
    getInitialScaleFactorForHighPressureNode(
      sixLayerNode,
      0.2,
      extremeCrossings,
    ),
  ).toBe(1)

  const transitionHeavyRoomyNode = makeNode({
    pairCount: 30,
    width: 50,
    height: 50,
    availableZ: [0, 1],
  })
  expect(
    getInitialScaleFactorForHighPressureNode(transitionHeavyRoomyNode, 0.5, {
      ...noCrossings,
      numEntryExitLayerChanges: 30,
    }),
  ).toBe(1)

  const transitionHeavyLowPfNode = makeNode({
    pairCount: 30,
    width: 5,
    height: 5,
    availableZ: [0, 1],
  })
  expect(
    getInitialScaleFactorForHighPressureNode(transitionHeavyLowPfNode, 0.1, {
      ...noCrossings,
      numEntryExitLayerChanges: 30,
    }),
  ).toBe(1)

  const transitionOnlyNode = makeNode({
    pairCount: 30,
    width: 10,
    height: 10,
    availableZ: [0, 1],
  })
  expect(
    getInitialScaleFactorForHighPressureNode(transitionOnlyNode, 0.3, {
      ...noCrossings,
      numEntryExitLayerChanges: 30,
    }),
  ).toBe(1)

  const growShrinkSolver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: highPfNode,
    initialScaleFactor: 2,
  })
  expect(growShrinkSolver.scaleFactor).toBe(2)
  expect(growShrinkSolver.growthAttempts).toBe(1)

  const fractionalLimitSolver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: highPfNode,
    initialScaleFactor: 2,
    maxGrowthAttempts: 0.5,
  })
  expect(fractionalLimitSolver.maxGrowthAttempts).toBe(0)
  expect(fractionalLimitSolver.scaleFactor).toBe(1)

  const negativeLimitSolver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: highPfNode,
    initialScaleFactor: 2,
    maxGrowthAttempts: -1,
  })
  expect(negativeLimitSolver.maxGrowthAttempts).toBe(0)
  expect(negativeLimitSolver.scaleFactor).toBe(1)

  const highDensitySolver = new HighDensitySolver({
    nodePortPoints: [highPfNode],
    nodePfById: new Map([[highPfNode.capacityMeshNodeId, 1]]),
    useGrowShrinkHighDensityIntraNodeSolver: true,
    preGrowHighPressureNodes: true,
  })
  highDensitySolver.step()
  expect(
    (highDensitySolver.activeSubSolver as GrowShrinkHighDensityIntraNodeSolver)
      .scaleFactor,
  ).toBe(2)

  const forcedGrowthNode = makeForcedGrowthNode()
  const forcedGrowthParams = {
    nodeWithPortPoints: forcedGrowthNode,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    layerCount: 2,
    obstacles: [],
    effort: 1,
    maxGrowthAttempts: 1,
    fallbackToInvalidGeometryOnFailure: false,
    cacheProvider: null,
  }
  const ordinarySolver = new GrowShrinkHighDensityIntraNodeSolver(
    forcedGrowthParams,
  )
  ordinarySolver.solve()
  const preGrownSolver = new GrowShrinkHighDensityIntraNodeSolver({
    ...forcedGrowthParams,
    initialScaleFactor: 2,
  })
  preGrownSolver.solve()

  expect(ordinarySolver.solved).toBe(true)
  expect(ordinarySolver.growthAttempts).toBe(1)
  expect(ordinarySolver.failedSolvers).toHaveLength(1)
  expect(preGrownSolver.solved).toBe(true)
  expect(preGrownSolver.growthAttempts).toBe(1)
  expect(preGrownSolver.failedSolvers).toHaveLength(0)
  expect(preGrownSolver.solvedRoutes).toHaveLength(14)
  expect(preGrownSolver.solvedRoutes).toEqual(ordinarySolver.solvedRoutes)
  expect(findRouteGeometryViolations(ordinarySolver.solvedRoutes)).toHaveLength(
    0,
  )
  expect(findRouteGeometryViolations(preGrownSolver.solvedRoutes)).toHaveLength(
    0,
  )
})
