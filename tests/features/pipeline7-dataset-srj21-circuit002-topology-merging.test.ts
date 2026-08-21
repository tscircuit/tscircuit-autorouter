import { test } from "bun:test";
import { assertPipeline7DatasetSrj21TopologyMerging } from "../fixtures/assert-pipeline7-dataset-srj21-topology-merging";

test("pipeline7 merges topology for dataset-srj21 circuit002", async (): Promise<void> => {
  await assertPipeline7DatasetSrj21TopologyMerging({
    sampleNumber: 2,
    expectedComponentKinds: ["bga", "qfp"],
  });
});
