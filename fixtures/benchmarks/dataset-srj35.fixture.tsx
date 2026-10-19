import { dataset } from "@shibosoftwaredev/dataset-srj35-sitara"
import {
  DatasetBenchmarkFixture,
  type DatasetCircuit,
} from "./DatasetBenchmarkFixture"

const circuits: DatasetCircuit[] = Object.entries(dataset).map(
  ([sampleName, srj]) => ({
    id: sampleName.replace("sample", ""),
    srj,
  }),
)

export default () => (
  <DatasetBenchmarkFixture datasetLabel="dataset-srj35-sitara" circuits={circuits} />
)
