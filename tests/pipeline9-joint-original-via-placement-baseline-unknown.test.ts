import { expect, test } from "bun:test"
import { filterPipeline9OriginalViaPlacementErrorsAgainstBaseline } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { addPipeline9OriginalViaPlacementMetadata } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9OriginalViaPlacementDrcErrors"
import { makeOriginalViaPlacementMetadataFixture } from "./fixtures/pipeline9OriginalViaPlacementMetadata"

test("unattributed or malformed board findings cannot be removed as inherited baseline errors", (): void => {
  const fixture = makeOriginalViaPlacementMetadataFixture("board")
  const baseline = addPipeline9OriginalViaPlacementMetadata({ errors: fixture.errors, circuitJson: fixture.circuitJson })
  const geometry = baseline[0]!.viaPlacementGeometry as Record<string, unknown>
  const unknown = { ...fixture.errors[0]!, pcb_placement_error_id: "out_of_board_unknown_via" }
  const malformed = { ...baseline[0]!, viaPlacementGeometry: { ...geometry, x: NaN } }
  const errors = [fixture.errors[0]!, unknown, malformed]
  const filtered = filterPipeline9OriginalViaPlacementErrorsAgainstBaseline({
    errors, baselineErrors: [...baseline, unknown, malformed], checkOriginalViaPlacement: true,
  })
  expect(filtered).toEqual(errors)
})
