import { expect, test } from "bun:test"
import {
  createFixedCopperNodeCutContext,
  getFixedCopperNodeCuts,
} from "lib/solvers/NodeDimensionSubdivisionSolver/getFixedCopperNodeCuts"
import type { PhysicalNodeCutContext } from "lib/solvers/NodeDimensionSubdivisionSolver/physicalNodeCuts"
import { createPhysicalNodeCutFixture } from "tests/fixtures/createPhysicalNodeCutFixture"

test("physical node cut context validates spatial inputs before indexing and copies source values", (): void => {
  const { node, context } = createPhysicalNodeCutFixture()
  const invalid: PhysicalNodeCutContext[] = [
    { ...context, traceWidth: Number.NaN },
    { ...context, traceWidth: Number.MIN_VALUE },
    { ...context, traceGap: -1 },
    { ...context, padGap: Number.POSITIVE_INFINITY },
    { ...context, layerCount: 0 },
    { ...context, routableNetIds: new Set() },
    { ...context, protectedPoints: [{ x: 0, y: Number.NaN }] },
    { ...context, rectangles: [{ ...context.rectangles[0]!, width: Number.NaN }] },
    { ...context, rectangles: [{ ...context.rectangles[0]!, zLayers: [2] }] },
    {
      ...context,
      rectangles: [{ ...context.rectangles[0]!, ownerNetIds: new Set([""]) }],
    },
  ]
  for (const input of invalid) {
    expect((): void => {
      createFixedCopperNodeCutContext(input)
    }).toThrow("Physical node cuts")
  }
  const mutableCenter = { x: 1.5, y: 0 }
  const mutableOwners = new Set(["foreign-pad"])
  const mutableLayers = [1]
  const prepared = createFixedCopperNodeCutContext({
    ...context,
    rectangles: [
      {
        ...context.rectangles[0]!,
        center: mutableCenter,
        ownerNetIds: mutableOwners,
        zLayers: mutableLayers,
      },
    ],
  })
  mutableCenter.x = 100
  mutableOwners.add("route-a")
  mutableLayers[0] = 0
  expect(getFixedCopperNodeCuts({ node, context: prepared }).cuts).toHaveLength(3)
  expect((): void => {
    getFixedCopperNodeCuts({
      node: { ...node, center: { x: Number.NaN, y: 0 } },
      context: prepared,
    })
  }).toThrow("Physical node cuts have invalid node")
})
