import { test } from "bun:test"
import { assertPipeline7DatasetSrj21TopologyMerging } from "../fixtures/assert-pipeline7-dataset-srj21-topology-merging"

test("pipeline7 merges topology for dataset-srj21 circuit008", async (): Promise<void> => {
  await assertPipeline7DatasetSrj21TopologyMerging({
    sampleNumber: 8,
    expectedComponentKinds: ["qfp_thermalpad", "qfp_thermalpad"],
  })
})
