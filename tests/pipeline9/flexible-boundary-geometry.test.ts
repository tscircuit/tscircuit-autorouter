import { expect, test } from "bun:test"
import { coarsenPipeline9OrdinaryNodes } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/coarsenPipeline9OrdinaryNodes"
import { createFlexibleBoundaryFixture } from "./flexibleBoundaryFixture"

test("ordinary-cell union preserves concave geometry, layer restrictions and preloaded inputs", (): void => {
  const concave = createFlexibleBoundaryFixture()
  concave[1]!.height = 1
  const gap = createFlexibleBoundaryFixture()
  gap[1]!.center.x += 0.1
  const overlap = createFlexibleBoundaryFixture()
  overlap[1]!.center.x -= 0.1
  const restrictedLayers = createFlexibleBoundaryFixture()
  restrictedLayers[1]!.availableZ = [0]
  for (const nodes of [concave, gap, overlap, restrictedLayers]) {
    const result = coarsenPipeline9OrdinaryNodes({
      nodes,
      hasPreloadedTraces: false,
      physicalTerminals: [],
    })
    expect(result.stats.mergedPairCount).toBe(0)
    expect(result.nodes).toEqual(nodes)
  }
  const nodes = createFlexibleBoundaryFixture()
  const before = structuredClone(nodes)
  const result = coarsenPipeline9OrdinaryNodes({
    nodes,
    hasPreloadedTraces: true,
    physicalTerminals: [],
  })
  expect(result.stats.mergedPairCount).toBe(0)
  expect(result.nodes).toEqual(before)
  expect(nodes).toEqual(before)
})
