// As a PCB designer, I want Pipeline 7 to length-match copper before
// power expansion while preserving legacy single-hop coupled matching.
import { test } from "bun:test"
import { checkPipeline7PostProcessingBeforePowerExpansion } from "./fixtures/check-pipeline7-post-processing-before-power-expansion"

test("Pipeline7 runs post-processing before default power expansion", (): void => {
  checkPipeline7PostProcessingBeforePowerExpansion()
})
