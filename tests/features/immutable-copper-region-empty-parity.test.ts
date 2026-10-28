import { expect, test } from "bun:test"
import { annotateImmutableCopperRegions } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/annotateImmutableCopperRegions"
import { createImmutableCopperRegionsFixture } from "../fixtures/immutableCopperRegions.fixture"

test("no certified branches leaves the serialized graph byte-identical and rejects stale provenance when activated", () => {
  const { graph, srj } = createImmutableCopperRegionsFixture()
  const before = JSON.stringify(graph)
  expect(annotateImmutableCopperRegions({ graph, srj, originalSrj: srj, immutableTraceIds: new Set() }))
    .toEqual({ regions: 0, segmentAssociations: 0 })
  expect(JSON.stringify(graph)).toBe(before)
  expect(() => annotateImmutableCopperRegions({ graph, srj, originalSrj: srj, immutableTraceIds: new Set(["not-a-real-trace"]) }))
    .toThrow("one source trace for every certified trace ID")
  expect(JSON.stringify(graph)).toBe(before)
})
