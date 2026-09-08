import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { createAvailableNetAwareCrampedPorts } from "../fixtures/availableNetAwareCrampedPorts"
import { createAvailablePhysicalCutInput } from "../fixtures/tinygraph/createAvailablePhysicalCutInput"

test("Available leaves useful midpoint and excluded edge domains on their original paths", (): void => {
  for (const variant of [
    "offboard-edge",
    "offboard-node",
    "virtual-node",
    "target-node",
    "no-cramped-output",
    "ordinary-long-edge",
    "zero-length",
    "useful-owner",
    "empty-copper",
  ]) {
    const { input } = createAvailableNetAwareCrampedPorts()
    input.edges = [input.edges[1]!]
    const first = input.nodes.find(
      (node): boolean => node.capacityMeshNodeId === "gap-left",
    )!
    const second = input.nodes.find(
      (node): boolean => node.capacityMeshNodeId === "gap-mid",
    )!
    if (variant === "offboard-edge") input.edges[0]!.isOffboardEdge = true
    if (variant === "offboard-node") {
      first._offBoardConnectionId = "external-link"
    }
    if (variant === "virtual-node") second._isVirtualOffboard = true
    if (variant === "target-node") first._containsTarget = true
    if (variant === "no-cramped-output") {
      input.shouldReturnCrampedPortPoints = false
    }
    if (variant === "ordinary-long-edge") {
      first.height = 2
      second.height = 2
    }
    if (variant === "zero-length") second.center.y = 1
    if (variant === "useful-owner" || variant === "empty-copper") {
      const context = input.physicalCrampedPortContext
      const rectangles =
        variant === "useful-owner" ? context.rectangles.slice(0, 1) : []
      input.physicalCrampedPortContext = {
        ...context,
        rectangles,
        clearanceIndex: new FixedCopperClearanceIndex({
          rectangles,
          layerCount: context.layerCount,
          minClearance: context.padGap,
        }),
      }
    }
    const legacy = new AvailableSegmentPointSolver({
      ...input,
      physicalCrampedPortContext: undefined,
    })
    const physical = new AvailableSegmentPointSolver(input)
    legacy.solve()
    physical.solve()
    expect(physical.solved).toBeTrue()
    expect(physical.failed).toBeFalse()
    expect(physical.getOutput()).toEqual(legacy.getOutput())
  }

  // Existing physical-cut resources retain their distinct finite-site policy.
  const cutInput = createAvailablePhysicalCutInput()
  const context = cutInput.physicalNodeCuts.context
  const legacyCut = new AvailableSegmentPointSolver(cutInput)
  const physicalCut = new AvailableSegmentPointSolver({
    ...cutInput,
    physicalCrampedPortContext: {
      ...context,
      clearanceIndex: new FixedCopperClearanceIndex({
        rectangles: context.rectangles,
        layerCount: context.layerCount,
        minClearance: context.padGap,
      }),
    },
  })
  legacyCut.solve()
  physicalCut.solve()
  expect(physicalCut.getOutput()).toEqual(legacyCut.getOutput())
  expect(physicalCut.portPointMap.size).toBe(7)
  expect(
    [...physicalCut.portPointMap.values()].every(
      (port): boolean =>
        port.physicalCutId === "finite-shared-cut" && !port.cramped,
    ),
  ).toBeTrue()
})
