import { expect, test } from "bun:test"
import { coarsenPipeline9OrdinaryNodes } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/coarsenPipeline9OrdinaryNodes"
import { createFlexibleBoundaryFixture } from "./flexibleBoundaryFixture"

test("ordinary-cell union removes only directed internal contacts and preserves terminals", (): void => {
  const nodes = createFlexibleBoundaryFixture()
  nodes[0]!.portPoints[0]!.prevPortPointId = "preceding-region"
  nodes[1]!.portPoints[1]!.nextPortPointId = "following-region"
  const original = structuredClone(nodes)
  const result = coarsenPipeline9OrdinaryNodes({ nodes, hasPreloadedTraces: false })
  expect(result.stats.mergedPairCount).toBe(1)
  expect(result.stats.removedPortCount).toBe(4)
  expect(result.nodes).toHaveLength(1)
  const merged = result.nodes[0]!
  expect(merged.center).toEqual({ x: 1, y: 0 })
  expect([merged.width, merged.height, merged.availableZ]).toEqual([2, 2, [0, 1]])
  expect(merged.portPointsInPairs?.map(([start, end]) => [
    start.portPointId, end.portPointId, start.nextPortPointId, end.prevPortPointId,
  ])).toEqual([
    ["left-0", "right-0", "right-0", "left-0"],
    ["right-1", "left-1", "left-1", "right-1"],
  ])
  expect(merged.portPoints[0]!.prevPortPointId).toBe("preceding-region")
  expect(merged.portPoints[1]!.nextPortPointId).toBe("following-region")
  expect(merged.portPoints.map((point) => ({
    ...point, prevPortPointId: undefined, nextPortPointId: undefined,
  }))).toEqual([
    original[0]!.portPoints[0]!, original[1]!.portPoints[1]!,
    original[1]!.portPoints[2]!, original[0]!.portPoints[3]!,
  ].map((point) => ({ ...point, prevPortPointId: undefined, nextPortPointId: undefined })))
  expect(nodes).toEqual(original)
  expect(coarsenPipeline9OrdinaryNodes({ nodes, hasPreloadedTraces: false })).toEqual(result)
})
