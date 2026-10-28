import { expect, test } from "bun:test"
import { annotateImmutableCopperRegions } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/annotateImmutableCopperRegions"
import { createImmutableCopperRegionsFixture } from "../fixtures/immutableCopperRegions.fixture"

test("manufactured through-via copper spans the board while explicit blind-via copper retains its declared span", () => {
  const { graph, srj } = createImmutableCopperRegionsFixture()
  srj.traces![0]!.route = [{ route_type: "via", x: 0, y: 0, from_layer: "inner1", to_layer: "inner2", via_diameter: 0.45 }]
  annotateImmutableCopperRegions({ graph, srj, originalSrj: srj, immutableTraceIds: new Set(["certified-A"]) })
  expect(graph.regions[0]!.d!.fixedCopperSegments.map((segment: { z: number }) => segment.z)).toEqual([0, 1, 2, 3])
  expect(graph.regions[0]!.d!.fixedCopperSegments.every((segment: { width: number; x1: number; x2: number }) =>
    segment.width === 0.45 && segment.x1 === 0 && segment.x2 === 0)).toBe(true)
  expect(graph.regions[2]!.d!.fixedCopperSegments.map((segment: { z: number }) => segment.z)).toEqual([3])
  srj.allowBlindAndBuriedVias = true
  annotateImmutableCopperRegions({ graph, srj, originalSrj: srj, immutableTraceIds: new Set(["certified-A"]) })
  expect(graph.regions[0]!.d!.fixedCopperSegments.map((segment: { z: number }) => segment.z)).toEqual([1, 2])
  expect(graph.regions[2]!.d!.fixedCopperSegments).toBeUndefined()
})
