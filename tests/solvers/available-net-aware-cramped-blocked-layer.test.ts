import { expect, test } from "bun:test"
import {
  FixedCopperClearanceIndex,
  type FixedCopperRectangle,
} from "lib/data-structures/FixedCopperClearanceIndex"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { createAvailableNetAwareCrampedPorts } from "../fixtures/availableNetAwareCrampedPorts"

test("a completely blocked cramped layer contributes no site while its clear layer keeps the exact midpoint", (): void => {
  const { input } = createAvailableNetAwareCrampedPorts()
  input.edges = [input.edges[1]!]
  const context = input.physicalCrampedPortContext
  const rectangles: FixedCopperRectangle[] = [
    {
      kind: "fixed-rectangle",
      center: { x: 0.25, y: 0.5 },
      width: 2,
      height: 2,
      zLayers: [0],
      ownerNetIds: new Set(["unrelated-fixed-copper"]),
    },
  ]
  input.physicalCrampedPortContext = {
    ...context,
    rectangles,
    clearanceIndex: new FixedCopperClearanceIndex({
      rectangles,
      layerCount: context.layerCount,
      minClearance: context.padGap,
    }),
  }
  const before = structuredClone(rectangles)
  const solver = new AvailableSegmentPointSolver(input)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.getOutput()).toHaveLength(1)
  expect(solver.getOutput()[0]!.portPoints).toEqual([
    {
      segmentPortPointId: "left-turn_pp0_z1_cramped",
      x: 0.25,
      y: 0.5,
      availableZ: [1],
      nodeIds: ["gap-left", "gap-mid"],
      edgeId: "left-turn",
      connectionName: null,
      distToCentermostPortOnZ: 0,
      cramped: true,
    },
  ])
  expect(solver.portPointMap.size).toBe(1)
  expect(rectangles).toEqual(before)
})
