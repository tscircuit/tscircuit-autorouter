import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("grow-shrink composes node-centered physical scales without changing copper width", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "physical-scale-node",
    center: { x: 3, y: -2 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: [
      { connectionName: "route-net", x: 2, y: -2, z: 0 },
      { connectionName: "route-net", x: 4, y: -2, z: 0 },
    ],
  }
  const originalNode = structuredClone(node)
  const index = new FixedCopperClearanceIndex({
    rectangles: [],
    layerCount: 2,
    minClearance: 0.1,
  })
  const params: ConstructorParameters<
    typeof GrowShrinkHighDensityIntraNodeSolver
  >[0] = {
    nodeWithPortPoints: node,
    traceWidth: 0.3,
    viaDiameter: 0.4,
    layerCount: 2,
    physicalClearanceContext: {
      traceClearanceIndex: index,
      viaClearanceIndex: index,
      traceToTraceClearance: 0.1,
      viaToTraceClearance: 0.1,
      canonicalNetIdByConnectionName: new Map([["route-net", "route-net"]]),
      solveToPhysicalTransform: { center: { x: 3, y: -2 }, scale: 0.5 },
    },
  }
  const solver = new GrowShrinkHighDensityIntraNodeSolver(params)
  solver.scaleFactor = 4
  solver.step()
  const portfolio = solver.activeSubSolver ?? solver.winningSolver
  if (!portfolio) throw new Error("Expected the existing inner portfolio")
  const innerParams = portfolio.constructorParams
  const innerContext = innerParams.physicalClearanceContext
  if (!innerContext) throw new Error("Expected the composed physical context")
  expect(innerContext.solveToPhysicalTransform).toEqual({
    center: { x: 3, y: -2 },
    scale: 0.125,
  })
  expect(innerContext.traceClearanceIndex).toBe(index)
  expect(innerContext.viaClearanceIndex).toBe(index)
  expect(innerParams.traceWidth).toBe(0.3)
  expect(innerParams.viaDiameter).toBe(0.4)
  expect(innerParams.nodeWithPortPoints.portPoints).toMatchObject([
    { x: -1, y: -2, z: 0 },
    { x: 7, y: -2, z: 0 },
  ])
  expect(params.physicalClearanceContext?.solveToPhysicalTransform.scale).toBe(
    0.5,
  )
  expect(node).toEqual(originalNode)
  expect((): void => {
    new GrowShrinkHighDensityIntraNodeSolver({
      ...params,
      physicalClearanceContext: {
        ...innerContext,
        solveToPhysicalTransform: { center: { x: 4, y: -2 }, scale: 0.5 },
      },
    })
  }).toThrow('node "physical-scale-node" requires a finite node-centered')
})
