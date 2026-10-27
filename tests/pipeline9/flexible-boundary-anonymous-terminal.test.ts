import { expect, test } from "bun:test"
import { coarsenPipeline9OrdinaryNodes } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/coarsenPipeline9OrdinaryNodes"
import { createFlexibleBoundaryFixture } from "./flexibleBoundaryFixture"

test("ordinary-cell union retains physical seam terminals without PCB IDs", (): void => {
  const nodes = createFlexibleBoundaryFixture()
  const original = structuredClone(nodes)
  for (const x of [1, 1 + 5e-9]) {
    const physicalTerminals = [{ x, y: -0.4, z: 0 }]
    const before = structuredClone(physicalTerminals)
    const result = coarsenPipeline9OrdinaryNodes({
      nodes,
      hasPreloadedTraces: false,
      physicalTerminals,
    })
    expect(result.stats.mergedPairCount).toBe(0)
    expect(result.nodes).toEqual(original)
    expect(physicalTerminals).toEqual(before)
  }
  const otherLayer = coarsenPipeline9OrdinaryNodes({
    nodes,
    hasPreloadedTraces: false,
    physicalTerminals: [{ x: 1, y: -0.4, z: 1 }],
  })
  expect(otherLayer.stats.mergedPairCount).toBe(1)
  expect(nodes).toEqual(original)
})
