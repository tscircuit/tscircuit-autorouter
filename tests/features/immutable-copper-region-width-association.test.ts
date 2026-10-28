import { expect, test } from "bun:test"
import { annotateImmutableCopperRegions } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/annotateImmutableCopperRegions"
import { createImmutableCopperRegionsFixture } from "../fixtures/immutableCopperRegions.fixture"

test("finite-width copper near a region remains visible while a distant diagonal bounding box adds no interior", () => {
  const { graph, srj } = createImmutableCopperRegionsFixture()
  srj.traces![0]!.route = [
    { route_type: "wire", x: -2, y: 1.1, layer: "top", width: 0.2 },
    { route_type: "wire", x: 2, y: 1.1, layer: "top", width: 0.2 },
  ]
  annotateImmutableCopperRegions({ graph, srj, originalSrj: srj, immutableTraceIds: new Set(["certified-A"]) })
  expect(graph.regions[0]!.d!.fixedCopperSegments).toHaveLength(1)
  expect(graph.regions[0]!.d!.fixedCopperSegments[0].y1).toBe(1.1)
  srj.connections[0]!.nominalTraceWidth = 0.8
  srj.traces![0]!.route = [
    { route_type: "wire", x: -2, y: 1.35, layer: "top", width: 0.2 },
    { route_type: "wire", x: 2, y: 1.35, layer: "top", width: 0.2 },
  ]
  annotateImmutableCopperRegions({ graph, srj, originalSrj: srj, immutableTraceIds: new Set(["certified-A"]) })
  expect(graph.regions[0]!.d!.fixedCopperSegments).toHaveLength(1)
  expect(graph.regions[0]!.d!.fixedCopperSegments[0].y1).toBe(1.35)
  srj.traces![0]!.route = [
    { route_type: "wire", x: -4, y: 0, layer: "top", width: 0.2 },
    { route_type: "wire", x: 0, y: 4, layer: "top", width: 0.2 },
  ]
  const stats = annotateImmutableCopperRegions({ graph, srj, originalSrj: srj, immutableTraceIds: new Set(["certified-A"]) })
  expect(stats).toEqual({ regions: 0, segmentAssociations: 0 })
  expect(graph.regions.every((region) => region.d!.fixedCopperSegments === undefined)).toBe(true)
})
