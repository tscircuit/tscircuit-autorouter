import { expect, test } from "bun:test"
import { filterPipeline9OriginalViaPlacementErrorsAgainstBaseline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { addPipeline9OriginalViaPlacementMetadata } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9OriginalViaPlacementDrcErrors"
import { makeOriginalViaPlacementMetadataFixture } from "./fixtures/pipeline9OriginalViaPlacementMetadata"

test("baseline filtering follows typed trace and exact copper geometry across changing via ordinals", (): void => {
  const scenarios = [
    makeOriginalViaPlacementMetadataFixture("board", { viaId: "via_0", traceId: "original_preload" }),
    makeOriginalViaPlacementMetadataFixture("board", { viaId: "via_9", traceId: "prepared_preload",
      layers: ["top", "inner1", "inner2", "bottom"] }),
    makeOriginalViaPlacementMetadataFixture("board", { viaId: "via_0", traceId: "new_route" }),
    makeOriginalViaPlacementMetadataFixture("board", { viaId: "via_0", traceId: "prepared_preload", x: 0.5 }),
    makeOriginalViaPlacementMetadataFixture("board", { viaId: "via_0", traceId: "prepared_preload", diameter: 0.4 }),
  ]
  const enriched = scenarios.map((fixture) => addPipeline9OriginalViaPlacementMetadata({
    errors: fixture.errors, circuitJson: fixture.circuitJson })[0]!)
  expect(enriched.every((error) => error.viaPlacementGeometry !== undefined)).toBe(true)
  const filtered = filterPipeline9OriginalViaPlacementErrorsAgainstBaseline({
    errors: enriched.slice(1), baselineErrors: [enriched[0]!],
    originalTraceIdByPreparedTraceId: new Map([["prepared_preload", "original_preload"]]),
    checkOriginalViaPlacement: true,
  })
  expect(filtered).toEqual(enriched.slice(2))
})
