import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import {
  AvailableSegmentPointSolver,
  type PhysicalCrampedPortContext,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { createAvailableNetAwareCrampedPorts } from "../fixtures/availableNetAwareCrampedPorts"

type PointQuery = Parameters<
  FixedCopperClearanceIndex["getAllowedNetIdsAtPoint"]
>[0]

class UnresolvedCrampedSiteIndex extends FixedCopperClearanceIndex {
  readonly queriedPoints: { x: number; y: number; z: number }[] = []

  constructor(context: PhysicalCrampedPortContext) {
    super({
      rectangles: context.rectangles,
      layerCount: context.layerCount,
      minClearance: context.padGap,
    })
  }

  override getAllowedNetIdsAtPoint(
    query: PointQuery,
  ): ReadonlySet<string> | null {
    this.queriedPoints.push({ ...query.point })
    const actual = super.getAllowedNetIdsAtPoint(query)
    // A stricter index models an unresolved represented point explicitly;
    // it cannot cause the producer to retry another site or publish a prefix.
    if (query.point.x === 0.25 && query.point.y === 0.3125) return new Set()
    return actual
  }
}

test("Available reports the exact unresolved edge and layer without inventing replacement ports", (): void => {
  const { input } = createAvailableNetAwareCrampedPorts()
  input.edges = [input.edges[1]!]
  const nodesBefore = structuredClone(input.nodes)
  const index = new UnresolvedCrampedSiteIndex(input.physicalCrampedPortContext)
  input.physicalCrampedPortContext = {
    ...input.physicalCrampedPortContext,
    clearanceIndex: index,
  }
  const solver = new AvailableSegmentPointSolver(input)
  expect((): void => solver.solve()).toThrow(
    'Physical cramped edge "left-turn" layer 0 is unresolved:',
  )
  expect(solver.error).toContain("packed-site-blocked-by-index")
  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  expect(solver.portPointMap.size).toBe(0)
  expect(index.queriedPoints).toEqual([
    { x: 0.25, y: 0.5, z: 0 },
    { x: 0.25, y: 0.5, z: 0 },
    { x: 0.25, y: 0.3125, z: 0 },
  ])
  expect(input.nodes).toEqual(nodesBefore)
})
