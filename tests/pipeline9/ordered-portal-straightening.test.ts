import { expect, test } from "bun:test"
import { slidePipeline9OrderedPortals } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/slidePipeline9OrderedPortals"
import { createOrderedPortalFixture } from "./orderedPortalFixture"

test("shared portals slide jointly to taut crossings while preserving both owners and physical contacts", (): void => {
  const nodes = createOrderedPortalFixture()
  const before = structuredClone(nodes)
  const result = slidePipeline9OrderedPortals({ nodes, obstacles: [], physicalTerminals: [], layerCount: 2, traceWidth: 0.1, clearance: 0.15 })
  expect(result.stats.sharedSeamCount).toBe(1)
  expect(result.stats.movedPortalCount).toBe(2)
  expect(result.stats.acceptedRunCount).toBe(1)
  expect(result.stats.straightLengthAfter).toBeCloseTo(4, 12)
  expect(result.stats.straightLengthBefore).toBeGreaterThan(4)
  expect(result.stats.totalPairLengthAfter).toBeCloseTo(4, 12)
  expect(result.stats.totalPairLengthAfter).toBeLessThan(result.stats.totalPairLengthBefore)
  for (const node of result.nodes) for (const point of [...node.portPoints, ...node.portPointsInPairs!.flat()]) {
    const original = before.flatMap((node) => node.portPoints).find((entry) => entry.portPointId === point.portPointId)!
    if (point.portPointId!.startsWith("seam")) expect(point.y).toBeCloseTo(point.connectionName.endsWith("0") ? -0.6 : 0.6, 12)
    else expect(point).toEqual(original)
  }
  expect(nodes).toEqual(before)
  expect(slidePipeline9OrderedPortals({ nodes, obstacles: [], physicalTerminals: [], layerCount: 2, traceWidth: 0.1, clearance: 0.15 })).toEqual(result)
})
