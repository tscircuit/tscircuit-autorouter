import { expect, test } from "bun:test"
import { getPipeline9OriginalViaPlacementDrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9OriginalViaPlacementDrcErrors"
import { makeOriginalViaPlacementMetadataFixture } from "./fixtures/pipeline9OriginalViaPlacementMetadata"

test("original via-placement checks require one original board and an explicit valid pad rule", (): void => {
  const fixture = makeOriginalViaPlacementMetadataFixture("board")
  const board = fixture.circuitJson.find((element) => element.type === "pcb_board")!
  expect(getPipeline9OriginalViaPlacementDrcErrors({ circuitJson: fixture.circuitJson,
    minViaEdgeToPadEdgeClearance: 0.1 })).toHaveLength(1)
  expect(getPipeline9OriginalViaPlacementDrcErrors({ circuitJson: fixture.circuitJson,
    minViaEdgeToPadEdgeClearance: 0 })).toHaveLength(1)
  for (const circuitJson of [fixture.circuitJson.filter((element) => element.type !== "pcb_board"),
    [...fixture.circuitJson, structuredClone(board)]]) {
    expect(() => getPipeline9OriginalViaPlacementDrcErrors({ circuitJson,
      minViaEdgeToPadEdgeClearance: 0.1 })).toThrow()
  }
  for (const clearance of [undefined, NaN, Infinity, -0.01]) {
    expect(() => getPipeline9OriginalViaPlacementDrcErrors({ circuitJson: fixture.circuitJson,
      minViaEdgeToPadEdgeClearance: clearance as number })).toThrow()
  }
})
