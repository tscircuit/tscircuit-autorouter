import { expect, test } from "bun:test"
import { annotateImmutableCopperRegions } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/annotateImmutableCopperRegions"
import { createImmutableCopperRegionsFixture } from "../fixtures/immutableCopperRegions.fixture"

test("regional costs use the original declared physical gap independently of enlarged search margins", () => {
  const { graph, srj } = createImmutableCopperRegionsFixture()
  const originalSrj = structuredClone(srj)
  originalSrj.minTraceToPadEdgeClearance = 0.07
  originalSrj.defaultObstacleMargin = 0.9
  srj.minTraceToPadEdgeClearance = 0.4
  srj.defaultObstacleMargin = 1.2
  annotateImmutableCopperRegions({ graph, srj, originalSrj, immutableTraceIds: new Set(["certified-A"]) })
  expect(graph.regions[0]!.d!.fixedCopperSegments).toHaveLength(1)
  expect(graph.regions[0]!.d!.fixedCopperSegments[0].clearance).toBe(0.07)
  expect(graph.regions[0]!.d!.fixedCopperSegments[0].width).toBe(0.2)
})
