import { test } from "bun:test"
import { assertPipeline7DatasetSrj21TopologyMerging } from "../fixtures/assert-pipeline7-dataset-srj21-topology-merging"

test("pipeline7 merges topology for dataset-srj21 circuit007", async (): Promise<void> => {
  await assertPipeline7DatasetSrj21TopologyMerging({
    sampleNumber: 7,
    expectedComponentKinds: ["qfp", "soic"],
  })
})
